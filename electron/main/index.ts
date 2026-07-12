import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type WebFrameMain,
  type WebContents,
} from "electron";
import { release } from "node:os";
import { join } from "node:path";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pool from "tiny-async-pool";
import { z } from "zod";
import type {
  BatchProgress,
  BatchTranslationRequest,
} from "../../src/types/electron-api";
import {
  createTranslationCacheDocument,
  splitIntoChunk,
  parseSubtitle,
  parseTranslationCache,
  translateSubtitleChunk,
  saveTranslated,
  analyzeSubtitlesForContext,
  getSubtitleCues,
  getTranslatedPreviewText,
} from "./utils/translate";
import { fetchAvailableModels } from "./utils/models";
import { RequestRateLimiter } from "./utils/request-rate-limiter";
import type {
  ParsedSubtitle,
  SubtitleCue,
  SubtitleFileExtension,
  TranslationCacheDocument,
} from "./utils/translate";

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.js    > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.DIST_ELECTRON = join(__dirname, "../");
process.env.DIST = join(process.env.DIST_ELECTRON, "../dist");
process.env.PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? join(process.env.DIST_ELECTRON, "../public")
  : process.env.DIST;

// Disable GPU Acceleration for Windows 7
if (release().startsWith("6.1")) app.disableHardwareAcceleration();

// Set application name for Windows 10+ notifications
if (process.platform === "win32") app.setAppUserModelId(app.getName());

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Remove electron security warnings
// This warning only shows in development mode
// Read more on https://www.electronjs.org/docs/latest/tutorial/security
// process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

let win: BrowserWindow | null = null;
// Here, you can also use other preload
const preload = join(__dirname, "../preload/index.js");
const url = process.env.VITE_DEV_SERVER_URL;
const indexHtml = join(process.env.DIST, "index.html");
const packagedIndexUrl = pathToFileURL(indexHtml).href;
const supportedExtensions = new Set<SubtitleFileExtension>([
  "ass",
  "ssa",
  "srt",
  "vtt",
]);
const supportedInputExtensions = new Set<string>([
  ...supportedExtensions,
  "json",
]);
const allowedExternalHosts = new Set([
  "github.com",
  "www.github.com",
  "www.buymeacoffee.com",
]);
const MAX_AUTOMATIC_TRANSLATION_ATTEMPTS = 3;

const subtitleFileSchema = z
  .object({
    path: z.string().min(1),
    name: z.string().min(1),
  })
  .refine(({ path: filePath }) => isSupportedInputPath(filePath), {
    message: "Unsupported translation input file",
  });

const translationParamsSchema = z.object({
  apiKeys: z
    .array(z.string())
    .refine((keys) => keys.some((key) => key.trim().length > 0), {
      message: "At least one API key is required",
    }),
  apiHost: z.string().min(1),
  model: z.string().min(1),
  prompt: z.string(),
  lang: z.string(),
  additional: z.string(),
  temperature: z.number().finite().min(0).max(2),
  multiLangSave: z.enum(["none", "translate+original", "original+translate"]),
  delay: z.number().finite().min(0),
  requestsPerMinute: z
    .number()
    .finite()
    .safe()
    .int()
    .min(1)
    .max(100_000)
    .default(60),
  outputDirectory: z.string().optional(),
  contextSize: z.number().int().min(0).max(100).optional(),
});

const batchTranslationRequestSchema = z.object({
  files: z.array(subtitleFileSchema).min(1).max(100),
  params: translationParamsSchema,
});

function isSupportedInputPath(filePath: string): boolean {
  return supportedInputExtensions.has(
    path.extname(filePath).slice(1).toLowerCase()
  );
}

function assertTranslationInputFile(filePath: string): void {
  if (!isSupportedInputPath(filePath)) {
    throw new Error("不支援的翻譯輸入檔案");
  }

  const fileInfo = fs.statSync(filePath);
  if (!fileInfo.isFile()) {
    throw new Error("翻譯輸入路徑不是檔案");
  }
}

function isTrustedSender(frame: WebFrameMain | null): boolean {
  if (!frame) return false;

  try {
    if (url) {
      return new URL(frame.url).origin === new URL(url).origin;
    }

    const actualUrl = new URL(frame.url);
    const expectedUrl = new URL(packagedIndexUrl);
    return (
      actualUrl.protocol === expectedUrl.protocol &&
      actualUrl.pathname === expectedUrl.pathname
    );
  } catch {
    return false;
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedSender(event.senderFrame)) {
    throw new Error("Untrusted IPC sender");
  }
}

function isAllowedExternalUrl(target: string): boolean {
  try {
    const parsed = new URL(target);
    return parsed.protocol === "https:" && allowedExternalHosts.has(parsed.hostname);
  } catch {
    return false;
  }
}

function getTranslatedPath(
  filePath: string,
  outputDirectory?: string,
  sourceName = path.basename(filePath),
  sourceExtension = path.extname(filePath).slice(1).toLowerCase()
): string {
  const basename = path.basename(sourceName, path.extname(sourceName));
  return path.join(
    outputDirectory ?? path.dirname(filePath),
    `${basename}.translated.${sourceExtension}`
  );
}

function getTranslationCachePath(
  filePath: string,
  sourceName = path.basename(filePath)
): string {
  if (path.extname(filePath).toLowerCase() === ".json") {
    return filePath;
  }

  const basename = path.basename(sourceName, path.extname(sourceName));
  return path.join(
    path.dirname(filePath),
    `${basename}.translation.json`
  );
}

function getValidatedOutputDirectory(
  outputDirectory?: string
): string | undefined {
  if (!outputDirectory) return undefined;
  if (!path.isAbsolute(outputDirectory)) {
    throw new Error("Output directory must be an absolute path");
  }

  const directoryInfo = fs.statSync(outputDirectory);
  if (!directoryInfo.isDirectory()) {
    throw new Error("Output path is not a directory");
  }

  return outputDirectory;
}

interface TranslationInput {
  parsed: ParsedSubtitle;
  sourceName: string;
  sourceExtension: SubtitleFileExtension;
  analysis?: string;
  cacheDocument?: TranslationCacheDocument;
}

function readTranslationInput(filePath: string): TranslationInput {
  assertTranslationInputFile(filePath);
  const extension = path.extname(filePath).slice(1).toLowerCase();

  if (extension === "json") {
    const cacheDocument = parseTranslationCache(fs.readFileSync(filePath, "utf8"));
    return {
      parsed: cacheDocument.subtitle,
      sourceName: path.basename(cacheDocument.source.name),
      sourceExtension: cacheDocument.format,
      analysis: cacheDocument.analysis,
      cacheDocument,
    };
  }

  if (!supportedExtensions.has(extension as SubtitleFileExtension)) {
    throw new Error("不支援的字幕格式");
  }

  return {
    parsed: parseSubtitle(fs.readFileSync(filePath, "utf8"), extension),
    sourceName: path.basename(filePath),
    sourceExtension: extension as SubtitleFileExtension,
  };
}

function isTranslatedCue(cue: SubtitleCue): boolean {
  return typeof cue.data.translatedText === "string" && cue.data.translatedText.length > 0;
}

function createCheckpointWriter(
  checkpointPath: string,
  createDocument: () => TranslationCacheDocument
): { write: () => Promise<void>; wait: () => Promise<void> } {
  let pending = Promise.resolve();

  const write = () => {
    pending = pending
      .catch(() => undefined)
      .then(async () => {
        const temporaryPath = `${checkpointPath}.${process.pid}.tmp`;
        const content = `${JSON.stringify(createDocument(), null, 2)}\n`;
        await fs.promises.writeFile(temporaryPath, content, "utf8");
        try {
          await fs.promises.rename(temporaryPath, checkpointPath);
        } catch {
          await fs.promises.writeFile(checkpointPath, content, "utf8");
          await fs.promises.unlink(temporaryPath).catch(() => undefined);
        }
      });

    return pending;
  };

  return {
    write,
    wait: () => pending,
  };
}

function getErrorDetails(error: unknown): {
  message: string;
  name?: string;
  status?: number;
} {
  const errorRecord =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const cause =
    typeof errorRecord.cause === "object" && errorRecord.cause !== null
      ? (errorRecord.cause as Record<string, unknown>)
      : {};
  const messages = [
    error instanceof Error ? error.message : undefined,
    typeof error === "string" ? error : undefined,
    typeof errorRecord.message === "string" ? errorRecord.message : undefined,
    typeof cause.message === "string" ? cause.message : undefined,
  ].filter((message): message is string => Boolean(message));
  const response =
    typeof errorRecord.response === "object" && errorRecord.response !== null
      ? (errorRecord.response as Record<string, unknown>)
      : {};

  return {
    message: messages.join(" | ") || "Unknown error",
    name:
      typeof errorRecord.name === "string"
        ? errorRecord.name
        : typeof cause.name === "string"
          ? cause.name
          : undefined,
    status:
      typeof errorRecord.status === "number"
        ? errorRecord.status
        : typeof response.status === "number"
          ? response.status
          : typeof cause.status === "number"
            ? cause.status
            : undefined,
  };
}

function getErrorMessage(error: unknown): string {
  return getErrorDetails(error).message;
}

function sendProgress(sender: WebContents, progress: BatchProgress): void {
  sender.send("batch-progress", progress);
}

function createWindow() {
  win = new BrowserWindow({
    title: "Main window",
    icon: join(process.env.PUBLIC, "favicon.ico"),
    minWidth: 800,
    minHeight: 640,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    ...(process.platform === "darwin"
      ? {
          vibrancy: "fullscreen-ui",
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 10, y: 20 },
        }
      : {
          titleBarOverlay: true,
          autoHideMenuBar: true, // on Windows 11
          backgroundMaterial: "mica", // on Windows 11
        }),
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(url);
    // Open devTool if the app is not packaged
    // win.webContents.openDevTools()
  } else {
    void win.loadFile(indexHtml);
  }

  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isAllowedExternalUrl(targetUrl)) {
      void shell.openExternal(targetUrl);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, navigationUrl) => {
    let isAllowed = false;
    try {
      if (url) {
        isAllowed =
          new URL(navigationUrl).origin === new URL(url).origin;
      } else {
        const actualUrl = new URL(navigationUrl);
        const expectedUrl = new URL(packagedIndexUrl);
        isAllowed =
          actualUrl.protocol === expectedUrl.protocol &&
          actualUrl.pathname === expectedUrl.pathname;
      }
    } catch {
      isAllowed = false;
    }

    if (!isAllowed) event.preventDefault();
  });
}

app.whenReady().then(createWindow).catch((error: unknown) => {
  console.error("Failed to create application window:", error);
});

app.on("window-all-closed", () => {
  win = null;
  if (process.platform !== "darwin") app.quit();
});

app.on("second-instance", () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("activate", () => {
  const allWindows = BrowserWindow.getAllWindows();
  if (allWindows.length) {
    allWindows[0].focus();
  } else {
    createWindow();
  }
});

// Cache analysis per file so renderer can fetch it on demand
const analysisCache = new Map<string, string>();

ipcMain.handle("open-external", (event, target: unknown) => {
  assertTrustedSender(event);

  if (typeof target !== "string" || !isAllowedExternalUrl(target)) {
    throw new Error("External URL is not allowed");
  }

  return shell.openExternal(target);
});

ipcMain.handle("select-directory", async (event, defaultPath: unknown) => {
  assertTrustedSender(event);

  const validatedDefaultPath = z.string().min(1).optional().parse(defaultPath);
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    ...(validatedDefaultPath ? { defaultPath: validatedDefaultPath } : {}),
  });

  return canceled ? null : filePaths[0] ?? null;
});

ipcMain.handle("list-models", async (event, request: unknown) => {
  assertTrustedSender(event);

  const { apiKey, apiHost } = z
    .object({
      apiKey: z.string().min(1),
      apiHost: z.string().url(),
    })
    .parse(request);

  return fetchAvailableModels({ apiKey, apiHost });
});

async function retryTranslate<TInput, TResult>(
  fn: (input: TInput) => Promise<TResult>,
  input: TInput,
  delay = 1000
): Promise<TResult> {
  for (
    let attempt = 1;
    attempt <= MAX_AUTOMATIC_TRANSLATION_ATTEMPTS;
    attempt++
  ) {
    try {
      return await fn(input);
    } catch (error: unknown) {
      if (attempt === MAX_AUTOMATIC_TRANSLATION_ATTEMPTS) {
        throw error;
      }
      // 判斷是否可重試（涵蓋 schema 不符、未產生物件 等訊息）
      const { message: errorMessage, name, status } = getErrorDetails(error);
      const msgLower = (errorMessage || "").toLowerCase();

      const isRetryable =
        msgLower.includes("network") ||
        msgLower.includes("timeout") ||
        msgLower.includes("rate limit") ||
        msgLower.includes("no object generated") ||
        msgLower.includes("did not match schema") ||
        msgLower.includes("match schema") ||
        msgLower.includes("validation") ||
        name === "NoObjectGeneratedError" ||
        name === "TypeValidationError" ||
        (typeof status === "number" && (status >= 429 || status >= 500));

      if (isRetryable) {
        // 指數退避 + 輕微抖動
        const backoff =
          Math.max(0, delay) * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250);
        console.warn(
          `Translation attempt ${attempt} failed: ${errorMessage || name || "unknown error"}. Retrying in ${backoff}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      } else {
        throw error; // 不可重試錯誤，直接拋出
      }
    }
  }

  throw new Error("Automatic translation retry loop exited unexpectedly");
}

ipcMain.handle("batch-translate", async (event, request: unknown) => {
  assertTrustedSender(event);
  const { files, params } = batchTranslationRequestSchema.parse(request);
  const requestRateLimiter = new RequestRateLimiter({
    requestsPerMinute: params.requestsPerMinute,
    minimumIntervalMs: params.delay,
  });

  const processFile = async (file: BatchTranslationRequest["files"][number]) => {
    try {
      const input = readTranslationInput(file.path);
      const parsed = input.parsed;
      const subtitle = getSubtitleCues(parsed);
      const totalCues = subtitle.length;
      let completedCues = subtitle.filter(isTranslatedCue).length;

      // 建立原始索引對照，供後續「上下文視窗」策略使用
      const indexMap = new Map<SubtitleCue, number>();
      subtitle.forEach((cue, idx) => indexMap.set(cue, idx));

      const outputDirectory = getValidatedOutputDirectory(
        params.outputDirectory
      );
      const outputPath = getTranslatedPath(
        file.path,
        outputDirectory,
        input.sourceName,
        input.sourceExtension
      );
      let analysisData = input.analysis;
      const checkpointPath = getTranslationCachePath(
        file.path,
        input.sourceName
      );
      const checkpointWriter = createCheckpointWriter(
        checkpointPath,
        () =>
          createTranslationCacheDocument(
            parsed,
            input.sourceName,
            input.sourceExtension,
            analysisData
          )
      );
      const persistCheckpoint = async () => {
        try {
          await checkpointWriter.write();
        } catch (error: unknown) {
          console.warn("Failed to write translation checkpoint:", error);
        }
      };

      await persistCheckpoint();

      const chunks = splitIntoChunk(subtitle, 20);
      if (chunks.length === 0) {
        saveTranslated(
          outputPath,
          parsed,
          input.sourceExtension,
          params.multiLangSave || "none"
        );
        await checkpointWriter.wait().catch((error: unknown) => {
          console.warn("Failed to finish translation checkpoint:", error);
        });
        sendProgress(event.sender, {
          filePath: file.path,
          progress: 100,
          status: "done",
          totalCues,
          currentCue: totalCues,
          analysis: analysisData,
        });
        return;
      }

      sendProgress(event.sender, {
        filePath: file.path,
        progress: totalCues > 0 ? (completedCues / totalCues) * 100 : 0,
        status: "analyzing",
        totalCues,
        currentCue: completedCues,
      });

      // Build analysis context (plot summary + glossary) and attach to all requests
      const allTexts = subtitle
        .map((cue) => cue.data.text)
        .filter((t: string) => t && t.length > 0);

      let combinedAdditional = params.additional || "";
      if (analysisData) {
        combinedAdditional = `${
          combinedAdditional ? combinedAdditional + "\n\n" : ""
        }[Context]\n${analysisData}`;
        analysisCache.set(file.path, analysisData);
      } else {
        try {
          const analysis = await analyzeSubtitlesForContext(allTexts, {
            apiKeys: params.apiKeys || [],
            apiHost: params.apiHost || "https://api.openai.com/v1",

            model: params.model || "",
            lang: params.lang || "",
            temperature: 0.3,
            requestRateLimiter,
          });
          combinedAdditional = `${
            combinedAdditional ? combinedAdditional + "\n\n" : ""
          }[Context]\n${analysis}`;

          analysisData = analysis;
          analysisCache.set(file.path, analysis);
          await persistCheckpoint();
          sendProgress(event.sender, {
            filePath: file.path,
            progress: totalCues > 0 ? (completedCues / totalCues) * 100 : 0,
            status: "analyzing",
            totalCues,
            currentCue: completedCues,
            analysis,
          });
        } catch (analysisErr) {
          console.warn(
            "Context analysis failed, continue without it:",
            analysisErr
          );
        }
      }

      sendProgress(event.sender, {
        filePath: file.path,
        progress: totalCues > 0 ? (completedCues / totalCues) * 100 : 0,
        status: "translating",
        totalCues,
        currentCue: completedCues,
        analysis: analysisData,
      });

      // Translate
      const chunkProcessor = async (block) => {
        // 以原始索引建立「核心段」和「上下文視窗」
        const contextSize =
          typeof params.contextSize === "number" ? params.contextSize : 5;

        const coreIndices = block
          .map((cue) => indexMap.get(cue))
          .filter((n): n is number => typeof n === "number")
          .sort((a: number, b: number) => a - b);

        if (coreIndices.length === 0) return;

        const coreStart = coreIndices[0];
        const coreEnd = coreIndices[coreIndices.length - 1];

        const contextStart = Math.max(0, coreStart - contextSize);
        const contextEnd = Math.min(subtitle.length - 1, coreEnd + contextSize);

        const windowCues = subtitle.slice(contextStart, contextEnd + 1);
        const windowText = windowCues.map((cue) =>
          cue.data.text.replaceAll(/\n/g, " ").trim()
        );

        // 每個區塊最多自動嘗試三次；失敗後直接交由使用者手動重試。
        const translatedWindow = await retryTranslate(
          async (chunkText) => {
            const result = await translateSubtitleChunk(chunkText, {
              ...params,
              apiKeys: params.apiKeys || [],
              apiHost: params.apiHost || "https://api.openai.com/v1",
              model: params.model || "",
              prompt: params.prompt || "",
              lang: params.lang || "",
              additional: combinedAdditional || "",
              temperature:
                typeof params.temperature === "number"
                  ? params.temperature
                  : 1,
              requestRateLimiter,
            });

            if (!Array.isArray(result) || result.length !== windowText.length) {
              throw new Error(
                `Translation output validation failed: expected ${windowText.length} subtitles, got ${Array.isArray(result) ? result.length : "a non-array result"}`
              );
            }

            return result;
          },
          windowText
        );

        // 只回寫核心段的翻譯（丟棄上下文前後行），以避免割裂感
        let chunkCompleted = 0;
        for (const cue of block) {
          const idx = indexMap.get(cue);
          if (typeof idx !== "number") continue;
          const offset = idx - contextStart;
          const t = translatedWindow[offset] ?? "";
          cue.data.translatedText = t;
          chunkCompleted++;
        }

        completedCues += chunkCompleted;
        const progress = totalCues > 0 ? (completedCues / totalCues) * 100 : 100;
        const currentCue = Math.min(completedCues, totalCues);
        sendProgress(event.sender, {
          filePath: file.path,
          progress,
          status: "translating",
          totalCues,
          currentCue,
          analysis: analysisData,
        });

        // 寫入部分成果供即時預覽
        try {
          saveTranslated(
            outputPath,
            parsed,
            input.sourceExtension,
            params.multiLangSave || "none"
          );
        } catch (e) {
          console.warn("Failed to write partial translated file:", e);
        }

        await persistCheckpoint();
      };

      for await (const _ of pool(10, chunks, chunkProcessor)) {
        // Process chunks in parallel with concurrency 2
      }

      // Final write
      saveTranslated(
        outputPath,
        parsed,
        input.sourceExtension,
        params.multiLangSave || "none"
      );
      await checkpointWriter.wait().catch((error: unknown) => {
        console.warn("Failed to finish translation checkpoint:", error);
      });
      console.log(`Saved translated file to: ${outputPath}`);
      sendProgress(event.sender, {
        filePath: file.path,
        progress: 100,
        status: "done",
        totalCues,
        currentCue: totalCues,
        analysis: analysisData,
      });
    } catch (e: unknown) {
      console.error(`Batch translation error for ${file.path}:`, e);
      sendProgress(event.sender, {
        filePath: file.path,
        progress: 0,
        status: "error",
        error: getErrorMessage(e),
      });
    }
  };

  for await (const _ of pool(3, files, processFile)) {
    // Process all files in parallel with concurrency 3
  }
  return { success: true };
});

// Allow renderer to fetch cached analysis for a file (in case progress event missed)
ipcMain.handle("get-analysis", async (event, filePath: unknown) => {
  assertTrustedSender(event);
  const validatedPath = z.string().min(1).parse(filePath);
  return analysisCache.get(validatedPath) ?? null;
});

ipcMain.handle("get-subtitle-preview", async (event, filePath: unknown) => {
  assertTrustedSender(event);
  const validatedPath = z.string().min(1).parse(filePath);
  const input = readTranslationInput(validatedPath);
  const parsed = input.parsed;
  const subtitle = getSubtitleCues(parsed);

  const makeKey = (
    start: number | string | undefined,
    end: number | string | undefined
  ) => {
    const norm = (value: number | string | undefined) =>
      typeof value === "number" ? Math.round(value) : String(value ?? "").trim();
    return `${norm(start)}|${norm(end)}`;
  };

  const makePreview = (translatedSubtitle?: SubtitleCue[]) => {
    const translatedCuesArray = translatedSubtitle?.map(
      (cue) => cue.data.translatedText || cue.data.text
    );
    const translatedMap = translatedSubtitle
      ? new Map(
          translatedSubtitle.map((cue) => [
            makeKey(cue.data.start, cue.data.end),
            cue.data.translatedText || cue.data.text,
          ])
        )
      : null;

    return subtitle.map((cue, index) => {
      const key = makeKey(cue.data.start, cue.data.end);
      const savedTranslation =
        translatedMap?.get(key) ?? translatedCuesArray?.[index];
      return {
        text: cue.data.text,
        translatedText:
          typeof savedTranslation === "string"
            ? getTranslatedPreviewText(savedTranslation, cue.data.text)
            : undefined,
        start: cue.data.start,
        end: cue.data.end,
      };
    });
  };

  if (input.cacheDocument) {
    return { cues: makePreview(subtitle) };
  }

  const checkpointPath = getTranslationCachePath(
    validatedPath,
    input.sourceName
  );
  let translatedSubtitle: SubtitleCue[] | undefined;
  if (fs.existsSync(checkpointPath)) {
    try {
      const checkpoint = parseTranslationCache(
        fs.readFileSync(checkpointPath, "utf8")
      );
      if (checkpoint.format === input.sourceExtension) {
        translatedSubtitle = getSubtitleCues(checkpoint.subtitle);
      }
    } catch {
      // Ignore an invalid checkpoint and fall back to the translated subtitle.
    }
  }

  if (!translatedSubtitle) {
    const translatedPath = getTranslatedPath(
      validatedPath,
      undefined,
      input.sourceName,
      input.sourceExtension
    );

    if (fs.existsSync(translatedPath)) {
      const translatedContent = fs.readFileSync(translatedPath, "utf8");
      const translatedParsed: ParsedSubtitle = parseSubtitle(
        translatedContent,
        input.sourceExtension
      );
      translatedSubtitle = getSubtitleCues(translatedParsed);
    }
  }

  return { cues: makePreview(translatedSubtitle) };
});
