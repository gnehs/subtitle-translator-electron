import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions,
  type WebFrameMain,
  type WebContents,
} from "electron";
import { translationErrorCodes } from "../shared/translation-error-codes";
import { release } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import fs, { type Stats } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import pool from "tiny-async-pool";
import { z } from "zod";
import { APICallError, NoObjectGeneratedError } from "ai";
import {
  type BatchProgress,
  type BatchTranslationRequest,
} from "../../src/types/electron-api";
import {
  createTranslationCacheDocument,
  parseSubtitle,
  parseTranslationCache,
  translateSubtitleChunk,
  saveTranslated,
  analyzeSubtitlesForContext,
  getSubtitleCues,
} from "./utils/translate";
import { createSubtitlePreview } from "./utils/subtitle-preview";
import { shouldAnalyzeSubtitles } from "./utils/subtitle-sampling";
import { fetchAvailableModels } from "./utils/models";
import { RequestRateLimiter } from "./utils/request-rate-limiter";
import { isAllowedApiHost } from "./utils/api-host";
import {
  isSubtitleCueComplete,
  splitIntoChunk,
} from "./utils/subtitle-chunks";
import { getRetryAfterMsFromHeaders } from "./utils/retry-after";
import {
  getPathClaimKey,
  hasPathClaimConflict,
} from "./utils/path-claims";
import {
  createTranslationConfigFingerprint,
  getTranslationCheckpointCandidates,
  getTranslationCheckpointResumeMetadata,
  hasMatchingCheckpointSource,
  type TranslationSourceFingerprint,
} from "./utils/translation-checkpoint";
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
let aboutWindow: BrowserWindow | null = null;
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
const MIN_CUES_FOR_CONTEXT_ANALYSIS = 40;
const DEFAULT_CONTEXT_SIZE = 5;
const applicationLocaleSchema = z.enum(["en-US", "zh-TW", "zh-CN"]);
type ApplicationLocale = z.infer<typeof applicationLocaleSchema>;
let applicationLocale: ApplicationLocale | undefined;
const activeTranslationPathClaims = new Set<string>();
const activeTranslationControllers = new Map<string, Set<AbortController>>();

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
  apiHost: z.string().trim().min(1).refine(isAllowedApiHost, {
    message: "API host must use HTTPS unless it is a local server",
  }),
  model: z.string().min(1),
  prompt: z.string(),
  lang: z.string(),
  additional: z.string(),
  temperature: z.number().finite().min(0).max(2),
  multiLangSave: z.enum(["none", "translate+original", "original+translate"]),
  concurrency: z
    .union([
      z.literal(1),
      z.literal(2),
      z.literal(5),
      z.literal(10),
    ])
    .default(10),
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

const subtitlePreviewRequestSchema = z.object({
  filePath: z.string().min(1),
  outputPath: z
    .string()
    .min(1)
    .refine(path.isAbsolute, { message: "Output path must be absolute" })
    .optional(),
});

function isSupportedInputPath(filePath: string): boolean {
  return supportedInputExtensions.has(
    path.extname(filePath).slice(1).toLowerCase()
  );
}

function assertTranslationInputFile(filePath: string): Stats {
  if (!isSupportedInputPath(filePath)) {
    throw new Error(translationErrorCodes.unsupportedInputFile);
  }

  const fileInfo = fs.statSync(filePath);
  if (!fileInfo.isFile()) {
    throw new Error(translationErrorCodes.inputPathNotFile);
  }

  return fileInfo;
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

function assertTrustedSender(event: { senderFrame: WebFrameMain | null }): void {
  if (!isTrustedSender(event.senderFrame)) {
    throw new Error("Untrusted IPC sender");
  }
}

function registerTranslationController(
  filePath: string,
  controller: AbortController
): () => void {
  const controllers = activeTranslationControllers.get(filePath) || new Set();
  controllers.add(controller);
  activeTranslationControllers.set(filePath, controllers);

  return () => {
    controllers.delete(controller);
    if (controllers.size === 0) {
      activeTranslationControllers.delete(filePath);
    }
  };
}

function cancelTranslation(filePath: string): void {
  for (const controller of activeTranslationControllers.get(filePath) || []) {
    controller.abort();
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
  const candidates = getTranslationCheckpointCandidates(filePath, sourceName);
  return (
    candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
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

function claimTranslationPaths(
  pathsToClaim: readonly string[],
  batchPathClaims: Set<string>
): () => void {
  const keys = pathsToClaim.map((filePath) => {
    const canonicalDirectory = fs.realpathSync.native(path.dirname(filePath));
    return getPathClaimKey(
      path.join(canonicalDirectory, path.basename(filePath))
    );
  });
  if (
    hasPathClaimConflict(
      keys,
      batchPathClaims,
      activeTranslationPathClaims
    )
  ) {
    throw new Error(translationErrorCodes.outputPathConflict);
  }

  for (const key of keys) {
    batchPathClaims.add(key);
    activeTranslationPathClaims.add(key);
  }
  return () => {
    for (const key of keys) activeTranslationPathClaims.delete(key);
  };
}

interface TranslationInput {
  parsed: ParsedSubtitle;
  sourceName: string;
  sourceExtension: SubtitleFileExtension;
  analysis?: string;
  cacheDocument?: TranslationCacheDocument;
  sourceFingerprint?: TranslationSourceFingerprint;
  checkpointPath: string;
  shouldBackupCheckpoint: boolean;
}

function readMatchingCheckpoint(
  checkpointPath: string,
  sourceName: string,
  sourceExtension: SubtitleFileExtension,
  sourceFingerprint: TranslationSourceFingerprint
): TranslationCacheDocument | undefined {
  try {
    const checkpoint = parseTranslationCache(
      fs.readFileSync(checkpointPath, "utf8")
    );
    return hasMatchingCheckpointSource(
      checkpoint,
      sourceName,
      sourceExtension,
      sourceFingerprint
    )
      ? checkpoint
      : undefined;
  } catch (error: unknown) {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (errorCode !== "ENOENT") {
      console.warn("Ignoring an invalid translation checkpoint:", error);
    }
    return undefined;
  }
}

function readTranslationInput(
  filePath: string,
  configFingerprint?: string
): TranslationInput {
  const fileInfo = assertTranslationInputFile(filePath);
  const extension = path.extname(filePath).slice(1).toLowerCase();

  if (extension === "json") {
    const cacheDocument = parseTranslationCache(
      fs.readFileSync(filePath, "utf8")
    );
    const resumeMetadata = getTranslationCheckpointResumeMetadata(
      cacheDocument,
      configFingerprint
    );

    return {
      parsed: cacheDocument.subtitle,
      sourceName: path.basename(cacheDocument.source.name),
      sourceExtension: cacheDocument.format,
      analysis: resumeMetadata.analysis,
      cacheDocument,
      sourceFingerprint: cacheDocument.source.fingerprint,
      checkpointPath: filePath,
      // Explicitly selected v1 checkpoints remain resumable, but keep a copy
      // before migrating them to the configuration-bound v2 format.
      shouldBackupCheckpoint: resumeMetadata.shouldBackupCheckpoint,
    };
  }

  if (!supportedExtensions.has(extension as SubtitleFileExtension)) {
    throw new Error(translationErrorCodes.unsupportedSubtitleFormat);
  }

  const sourceName = path.basename(filePath);
  const sourceExtension = extension as SubtitleFileExtension;
  const sourceFingerprint = {
    size: fileInfo.size,
    mtimeMs: fileInfo.mtimeMs,
  };
  const checkpointPath = getTranslationCachePath(filePath, sourceName);
  const checkpoint = readMatchingCheckpoint(
    checkpointPath,
    sourceName,
    sourceExtension,
    sourceFingerprint
  );
  const resumeMetadata = checkpoint
    ? getTranslationCheckpointResumeMetadata(checkpoint, configFingerprint)
    : undefined;

  return checkpoint
    ? {
        parsed: checkpoint.subtitle,
        sourceName,
        sourceExtension,
        analysis: resumeMetadata?.analysis,
        cacheDocument: checkpoint,
        sourceFingerprint,
        checkpointPath,
        shouldBackupCheckpoint:
          resumeMetadata?.shouldBackupCheckpoint ?? false,
      }
    : {
        parsed: parseSubtitle(fs.readFileSync(filePath, "utf8"), extension),
        sourceName,
        sourceExtension,
        sourceFingerprint,
        checkpointPath,
        shouldBackupCheckpoint: fs.existsSync(checkpointPath),
      };
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
        const temporaryPath = `${checkpointPath}.${process.pid}.${randomUUID()}.tmp`;
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

async function backupTranslationCheckpoint(
  checkpointPath: string
): Promise<string> {
  const backupPath = `${checkpointPath}.${Date.now()}.${randomUUID()}.backup.json`;
  await fs.promises.rename(checkpointPath, backupPath);
  return backupPath;
}

async function removeTranslationCheckpoint(checkpointPath: string): Promise<void> {
  try {
    await fs.promises.unlink(checkpointPath);
  } catch (error: unknown) {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (errorCode !== "ENOENT") {
      console.warn("Failed to remove translation checkpoint:", error);
    }
  }
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
      typeof errorRecord.statusCode === "number"
        ? errorRecord.statusCode
        : typeof errorRecord.status === "number"
        ? errorRecord.status
        : typeof response.status === "number"
          ? response.status
          : typeof cause.status === "number"
            ? cause.status
            : undefined,
  };
}

function getRetryAfterMs(error: unknown): number {
  if (!APICallError.isInstance(error) || !error.responseHeaders) return 0;
  return getRetryAfterMsFromHeaders(error.responseHeaders);
}

function isRetryableTranslationError(error: unknown): boolean {
  if (APICallError.isInstance(error)) return error.isRetryable;
  if (NoObjectGeneratedError.isInstance(error)) return true;

  const { message, status } = getErrorDetails(error);
  if (status === 429 || (typeof status === "number" && status >= 500)) {
    return true;
  }

  return (
    message.includes(translationErrorCodes.incompleteModelOutput) ||
    /network|timeout|timed out|econnreset|econnrefused|enotfound|socket hang up/i.test(
      message
    )
  );
}

function getErrorMessage(error: unknown): string {
  return getErrorDetails(error).message;
}

function sendProgress(sender: WebContents, progress: BatchProgress): void {
  sender.send("batch-progress", progress);
}

function getApplicationLocale(): ApplicationLocale {
  if (applicationLocale) return applicationLocale;

  const parsedLocale = applicationLocaleSchema.safeParse(app.getLocale());
  applicationLocale = parsedLocale.success ? parsedLocale.data : "en-US";
  return applicationLocale;
}

function getAboutLabel(): string {
  switch (getApplicationLocale()) {
    case "zh-TW":
      return "關於 Subtitle Translator";
    case "zh-CN":
      return "关于 Subtitle Translator";
    default:
      return "About Subtitle Translator";
  }
}

function getHelpLabel(): string {
  switch (getApplicationLocale()) {
    case "zh-TW":
      return "說明";
    case "zh-CN":
      return "帮助";
    default:
      return "Help";
  }
}

function setApplicationLocale(locale: unknown): void {
  const nextLocale = applicationLocaleSchema.parse(locale);
  if (applicationLocale === nextLocale) return;

  applicationLocale = nextLocale;
  createApplicationMenu();
}

function loadRenderer(browserWindow: BrowserWindow, hash?: string): void {
  if (url) {
    void browserWindow.loadURL(hash ? `${url}#${hash}` : url);
  } else if (hash) {
    void browserWindow.loadFile(indexHtml, { hash });
  } else {
    void browserWindow.loadFile(indexHtml);
  }
}

function configureWindowNavigation(browserWindow: BrowserWindow): void {
  browserWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isAllowedExternalUrl(targetUrl)) {
      void shell.openExternal(targetUrl);
    }
    return { action: "deny" };
  });

  browserWindow.webContents.on("will-navigate", (event, navigationUrl) => {
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

function createAboutWindow(): void {
  const nextAboutWindow = new BrowserWindow({
    title: getAboutLabel(),
    icon: join(process.env.PUBLIC, "favicon.ico"),
    width: 600,
    height: 720,
    resizable: false,
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "default",
        }
      : {
          titleBarOverlay: true,
          autoHideMenuBar: true,
          backgroundMaterial: "mica",
        }),
  });

  aboutWindow = nextAboutWindow;
  nextAboutWindow.on("closed", () => {
    if (aboutWindow === nextAboutWindow) aboutWindow = null;
  });

  configureWindowNavigation(nextAboutWindow);
  loadRenderer(nextAboutWindow, "/about");
  nextAboutWindow.once("ready-to-show", () => nextAboutWindow.show());
}

function openAboutWindow(): void {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    if (aboutWindow.isMinimized()) aboutWindow.restore();
    aboutWindow.focus();
    return;
  }

  createAboutWindow();
}

function createApplicationMenu(): void {
  const aboutLabel = getAboutLabel();
  const helpLabel = getHelpLabel();
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.getName(),
      submenu: [
        { label: aboutLabel, click: openAboutWindow },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push(
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" }
  );

  if (process.platform !== "darwin") {
    template.push({
      label: helpLabel,
      submenu: [{ label: aboutLabel, click: openAboutWindow }],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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

  loadRenderer(win);
  // Open devTool if the app is not packaged
  // win.webContents.openDevTools()
  configureWindowNavigation(win);
}

app.whenReady()
  .then(() => {
    createApplicationMenu();
    createWindow();
  })
  .catch((error: unknown) => {
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

ipcMain.handle("set-menu-locale", (event, locale: unknown) => {
  assertTrustedSender(event);
  setApplicationLocale(locale);
});

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
      apiHost: z.string().trim().min(1).refine(isAllowedApiHost, {
        message: "API host must use HTTPS unless it is a local server",
      }),
    })
    .parse(request);

  return fetchAvailableModels({ apiKey, apiHost });
});

async function retryTranslate<TInput, TResult>(
  fn: (input: TInput) => Promise<TResult>,
  input: TInput,
  delay = 1000,
  abortSignal?: AbortSignal
): Promise<TResult> {
  for (
    let attempt = 1;
    attempt <= MAX_AUTOMATIC_TRANSLATION_ATTEMPTS;
    attempt++
  ) {
    abortSignal?.throwIfAborted();
    try {
      return await fn(input);
    } catch (error: unknown) {
      if (abortSignal?.aborted) throw error;
      if (attempt === MAX_AUTOMATIC_TRANSLATION_ATTEMPTS) {
        throw error;
      }
      if (!isRetryableTranslationError(error)) throw error;

      const { message: errorMessage, name } = getErrorDetails(error);
      const exponentialBackoff =
        Math.max(0, delay) * 2 ** (attempt - 1) +
        Math.floor(Math.random() * 250);
      const backoff = Math.max(exponentialBackoff, getRetryAfterMs(error));
      console.warn(
        `Translation attempt ${attempt} failed: ${errorMessage || name || "unknown error"}. Retrying in ${backoff}ms...`
      );
      await sleep(backoff, undefined, { signal: abortSignal });
    }
  }

  throw new Error("Automatic translation retry loop exited unexpectedly");
}

ipcMain.on("cancel-translation", (event, filePath: unknown) => {
  if (!isTrustedSender(event.senderFrame)) return;
  const parsedFilePath = z.string().min(1).safeParse(filePath);
  if (!parsedFilePath.success) return;
  cancelTranslation(parsedFilePath.data);
});

ipcMain.handle("batch-translate", async (event, request: unknown) => {
  assertTrustedSender(event);
  const { files, params } = batchTranslationRequestSchema.parse(request);
  const translationConfigFingerprint = createTranslationConfigFingerprint({
    apiHost: params.apiHost,
    model: params.model,
    prompt: params.prompt,
    lang: params.lang,
    additional: params.additional,
    temperature: params.temperature,
    contextSize: params.contextSize ?? DEFAULT_CONTEXT_SIZE,
  });
  const requestRateLimiter = new RequestRateLimiter({
    requestsPerMinute: params.requestsPerMinute,
    minimumIntervalMs: params.delay,
  });
  const translationControllersByPath = new Map<string, AbortController>();
  const unregisterTranslationControllers: Array<() => void> = [];
  for (const file of files) {
    if (translationControllersByPath.has(file.path)) continue;
    const controller = new AbortController();
    translationControllersByPath.set(file.path, controller);
    unregisterTranslationControllers.push(
      registerTranslationController(file.path, controller)
    );
  }
  // Keep these claims for the whole request so later files cannot silently
  // overwrite an earlier file after its active write lock has been released.
  const batchPathClaims = new Set<string>();
  const processFile = async (file: BatchTranslationRequest["files"][number]) => {
    const abortSignal = translationControllersByPath.get(file.path)?.signal;
    if (!abortSignal) return;
    let outputPath: string | undefined;
    let releasePathClaims: (() => void) | undefined;
    try {
      abortSignal.throwIfAborted();
      const input = readTranslationInput(
        file.path,
        translationConfigFingerprint
      );
      const parsed = input.parsed;
      const subtitle = getSubtitleCues(parsed);
      const totalCues = subtitle.length;
      let completedCues = subtitle.filter(isSubtitleCueComplete).length;

      // 建立原始索引對照，供後續「上下文視窗」策略使用
      const indexMap = new Map<SubtitleCue, number>();
      subtitle.forEach((cue, idx) => indexMap.set(cue, idx));

      const outputDirectory = getValidatedOutputDirectory(
        params.outputDirectory
      );
      const translatedOutputPath = getTranslatedPath(
        file.path,
        outputDirectory,
        input.sourceName,
        input.sourceExtension
      );
      outputPath = translatedOutputPath;
      let analysisData = input.analysis;
      analysisCache.delete(file.path);
      const checkpointPath = input.checkpointPath;
      releasePathClaims = claimTranslationPaths(
        [translatedOutputPath, checkpointPath],
        batchPathClaims
      );
      if (input.shouldBackupCheckpoint) {
        abortSignal.throwIfAborted();
        const backupPath = await backupTranslationCheckpoint(checkpointPath);
        console.warn(
          `Preserved an incompatible translation checkpoint at: ${backupPath}`
        );
      }
      const checkpointWriter = createCheckpointWriter(
        checkpointPath,
        () =>
          createTranslationCacheDocument({
            subtitle: parsed,
            sourceName: input.sourceName,
            format: input.sourceExtension,
            configFingerprint: translationConfigFingerprint,
            analysis: analysisData,
            sourceFingerprint: input.sourceFingerprint,
          })
      );
      const persistCheckpoint = async () => {
        try {
          await checkpointWriter.write();
        } catch (error: unknown) {
          console.warn("Failed to write translation checkpoint:", error);
        }
      };

      await persistCheckpoint();
      abortSignal.throwIfAborted();

      const chunks = splitIntoChunk(subtitle, 20);
      if (chunks.length === 0) {
        abortSignal.throwIfAborted();
        saveTranslated(
          translatedOutputPath,
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
          outputPath: translatedOutputPath,
          previewCues: createSubtitlePreview(subtitle, subtitle),
        });
        await removeTranslationCheckpoint(checkpointPath);
        return;
      }

      // Build analysis context (plot summary + glossary) and attach to all requests
      const allTexts = subtitle
        .map((cue) => cue.data.text)
        .filter((t: string) => t && t.length > 0);

      const shouldAnalyze = shouldAnalyzeSubtitles(
        analysisData,
        allTexts.length,
        MIN_CUES_FOR_CONTEXT_ANALYSIS
      );
      if (shouldAnalyze) {
        abortSignal.throwIfAborted();
        sendProgress(event.sender, {
          filePath: file.path,
          progress: totalCues > 0 ? (completedCues / totalCues) * 100 : 0,
          status: "analyzing",
          totalCues,
          currentCue: completedCues,
          analysis: null,
          outputPath: translatedOutputPath,
        });
      }

      let combinedAdditional = params.additional || "";
      if (analysisData) {
        combinedAdditional = `${
          combinedAdditional ? combinedAdditional + "\n\n" : ""
        }[Context]\n${analysisData}`;
        analysisCache.set(file.path, analysisData);
      } else if (shouldAnalyze) {
        try {
          const analysis = await retryTranslate(
            (texts) =>
              analyzeSubtitlesForContext(texts, {
                apiKeys: params.apiKeys || [],
                apiHost: params.apiHost || "https://api.openai.com/v1",
                model: params.model || "",
                lang: params.lang || "",
                temperature: 0.3,
                requestRateLimiter,
                abortSignal,
              }),
            allTexts,
            params.delay,
            abortSignal
          );
          if (analysis) {
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
              outputPath: translatedOutputPath,
            });
          }
        } catch (analysisErr) {
          abortSignal.throwIfAborted();
          console.warn(
            "Context analysis failed, continue without it:",
            analysisErr
          );
        }
      }

      abortSignal.throwIfAborted();
      sendProgress(event.sender, {
        filePath: file.path,
        progress: totalCues > 0 ? (completedCues / totalCues) * 100 : 0,
        status: "translating",
        totalCues,
        currentCue: completedCues,
        analysis: analysisData ?? null,
        outputPath: translatedOutputPath,
      });

      // Translate
      const chunkProcessor = async (block: SubtitleCue[]) => {
        abortSignal.throwIfAborted();
        // 以原始索引建立「核心段」和「上下文視窗」
        const contextSize =
          typeof params.contextSize === "number"
            ? params.contextSize
            : DEFAULT_CONTEXT_SIZE;

        const coreIndices = block
          .map((cue) => indexMap.get(cue))
          .filter((n): n is number => typeof n === "number")
          .sort((a: number, b: number) => a - b);

        if (coreIndices.length === 0) return;

        const coreStart = coreIndices[0];
        const coreEnd = coreIndices[coreIndices.length - 1];

        const contextStart = Math.max(0, coreStart - contextSize);
        const contextEnd = Math.min(subtitle.length - 1, coreEnd + contextSize);

        const normalizeCueText = (cue: SubtitleCue) =>
          cue.data.text.replaceAll(/\n/g, " ").trim();
        const translationChunk = {
          before: subtitle.slice(contextStart, coreStart).map(normalizeCueText),
          core: block.map(normalizeCueText),
          after: subtitle
            .slice(coreEnd + 1, contextEnd + 1)
            .map(normalizeCueText),
        };

        // 每個區塊最多自動嘗試三次；失敗後直接交由使用者手動重試。
        const translatedWindow = await retryTranslate(
          async (chunkInput) => {
            const result = await translateSubtitleChunk(chunkInput, {
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
              abortSignal,
            });

            if (!Array.isArray(result) || result.length !== block.length) {
              throw new Error(
                `Translation output validation failed: expected ${block.length} subtitles, got ${Array.isArray(result) ? result.length : "a non-array result"}`
              );
            }

            return result;
          },
          translationChunk,
          1000,
          abortSignal
        );

        abortSignal.throwIfAborted();
        // The model receives surrounding context but returns only the core block.
        let chunkCompleted = 0;
        for (const [index, cue] of block.entries()) {
          cue.data.translatedText = translatedWindow[index] ?? "";
          chunkCompleted++;
        }

        abortSignal.throwIfAborted();
        completedCues += chunkCompleted;
        const progress = totalCues > 0 ? (completedCues / totalCues) * 100 : 100;
        const currentCue = Math.min(completedCues, totalCues);
        sendProgress(event.sender, {
          filePath: file.path,
          progress,
          status: "translating",
          totalCues,
          currentCue,
          analysis: analysisData ?? null,
          outputPath: translatedOutputPath,
        });

        // 寫入部分成果供即時預覽
        try {
          saveTranslated(
            translatedOutputPath,
            parsed,
            input.sourceExtension,
            params.multiLangSave || "none"
          );
        } catch (e) {
          console.warn("Failed to write partial translated file:", e);
        }

        await persistCheckpoint();
      };

      const activeChunkProcessors = new Set<Promise<void>>();
      const trackedChunkProcessor = (block: SubtitleCue[]) => {
        const processing = chunkProcessor(block).finally(() => {
          activeChunkProcessors.delete(processing);
        });
        activeChunkProcessors.add(processing);
        return processing;
      };

      try {
        for await (const _ of pool(
          params.concurrency,
          chunks,
          trackedChunkProcessor
        )) {
          // Process chunks with the configured per-file concurrency.
        }
      } catch (error: unknown) {
        await Promise.allSettled([...activeChunkProcessors]);
        await checkpointWriter.wait().catch(() => undefined);
        throw error;
      }

      // Final write
      abortSignal.throwIfAborted();
      saveTranslated(
        translatedOutputPath,
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
        analysis: analysisData ?? null,
        outputPath: translatedOutputPath,
        previewCues: createSubtitlePreview(subtitle, subtitle),
      });
      await removeTranslationCheckpoint(checkpointPath);
      console.log(`Saved translated file to: ${translatedOutputPath}`);
    } catch (e: unknown) {
      if (abortSignal.aborted) return;
      console.error(`Batch translation error for ${file.path}:`, e);
      sendProgress(event.sender, {
        filePath: file.path,
        progress: 0,
        status: "error",
        error: getErrorMessage(e),
        outputPath,
      });
    } finally {
      releasePathClaims?.();
    }
  };

  try {
    for await (const _ of pool(3, files, processFile)) {
      // Process all files in parallel with concurrency 3
    }
  } finally {
    for (const unregister of unregisterTranslationControllers) unregister();
  }
  return { success: true };
});

// Allow renderer to fetch cached analysis for a file (in case progress event missed)
ipcMain.handle("get-analysis", async (event, filePath: unknown) => {
  assertTrustedSender(event);
  const validatedPath = z.string().min(1).parse(filePath);
  return analysisCache.get(validatedPath) ?? null;
});

ipcMain.handle("get-subtitle-preview", async (event, request: unknown) => {
  assertTrustedSender(event);
  const { filePath: validatedPath, outputPath } =
    subtitlePreviewRequestSchema.parse(request);
  const input = readTranslationInput(validatedPath);
  if (
    outputPath &&
    path.extname(outputPath).slice(1).toLowerCase() !== input.sourceExtension
  ) {
    throw new Error(translationErrorCodes.unsupportedFileExtension);
  }
  const parsed = input.parsed;
  const subtitle = getSubtitleCues(parsed);

  if (input.cacheDocument) {
    return { cues: createSubtitlePreview(subtitle, subtitle) };
  }

  const checkpointPath = getTranslationCachePath(
    validatedPath,
    input.sourceName
  );
  let translatedSubtitle: SubtitleCue[] | undefined;
  const matchingCheckpoint = input.sourceFingerprint
    ? readMatchingCheckpoint(
        checkpointPath,
        input.sourceName,
        input.sourceExtension,
        input.sourceFingerprint
      )
    : undefined;
  if (matchingCheckpoint) {
    translatedSubtitle = getSubtitleCues(matchingCheckpoint.subtitle);
  }

  if (!translatedSubtitle) {
    const translatedPath =
      outputPath ??
      getTranslatedPath(
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

  return { cues: createSubtitlePreview(subtitle, translatedSubtitle) };
});
