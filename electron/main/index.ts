import { app, BrowserWindow, shell, ipcMain } from "electron";
import { release } from "node:os";
import { join } from "node:path";
import fs from "node:fs";
import path from "node:path";
import pool from "tiny-async-pool";
import {
  splitIntoChunk,
  parseSubtitle,
  translateSubtitleChunk,
  translateSubtitleSingle,
  saveTranslated,
  analyzeSubtitlesForContext,
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

async function createWindow() {
  win = new BrowserWindow({
    title: "Main window",
    icon: join(process.env.PUBLIC, "favicon.ico"),
    minWidth: 800,
    minHeight: 640,
    webPreferences: {
      preload,
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      nodeIntegration: true,
      contextIsolation: false,
    },
    ...(process.platform === "darwin"
      ? {
          vibrancy: "fullscreen-ui",
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 10, y: 12 },
        }
      : {
          titleBarOverlay: true,
          autoHideMenuBar: true, // on Windows 11
          backgroundMaterial: "mica", // on Windows 11
        }),
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    // electron-vite-vue#298
    win.loadURL(url);
    // Open devTool if the app is not packaged
    // win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml);
  }

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(createWindow);

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

// New window example arg: new windows url
ipcMain.handle("open-win", (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${url}#${arg}`);
  } else {
    childWindow.loadFile(indexHtml, { hash: arg });
  }
});

ipcMain.on("batch-progress", (event, data) => {
  // Optional: log or handle progress if needed
  console.log("Batch progress:", data);
});

// Cache analysis per file so renderer can fetch it on demand
const analysisCache = new Map<string, any>();

async function retryTranslate(fn, params, maxRetries = 5, delay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn(params);
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      // 判斷是否可重試（涵蓋 schema 不符、未產生物件 等訊息）
      const errObj: any = error || {};
      const msgParts = [
        errObj.message,
        typeof errObj.toString === "function" ? errObj.toString() : "",
        errObj.cause?.message,
      ].filter(Boolean);
      const errorMessage = msgParts.join(" | ");
      const status = errObj.status || errObj.response?.status;
      const name = errObj.name || errObj.cause?.name;
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
}

ipcMain.handle("batch-translate", async (event, { files, params }) => {
  const processFile = async (file) => {
    try {
      event.sender.send("batch-progress", {
        filePath: file.path,
        progress: 0,
        status: "translating",
        totalCues: 0,
      });
      const ext = path.extname(file.path).slice(1).toLowerCase();
      const content = fs.readFileSync(file.path, "utf8");
      let parsed = parseSubtitle(content, ext);
      let subtitle;
      if (Array.isArray(parsed)) {
        subtitle = parsed.filter((line: any) => line.type === "cue");
      } else if (parsed.events) {
        subtitle = parsed.events;
      } else {
        subtitle = parsed;
      }
      const totalCues = subtitle.length;

      // 建立原始索引對照，供後續「上下文視窗」策略使用
      const indexMap = new Map<any, number>();
      subtitle.forEach((cue: any, idx: number) => indexMap.set(cue, idx));

      event.sender.send("batch-progress", {
        filePath: file.path,
        progress: 1,
        status: "analyzing",
        totalCues,
        currentCue: 0,
      });

      // Prepare output path early so we can write partial updates during translation
      const outputPath = path.join(
        path.dirname(file.path),
        file.name.replace(/\.[^/.]+$/, "") + ".translated." + ext
      );

      // Build analysis context (plot summary + glossary) and attach to all requests
      const allTexts = subtitle
        .map((cue: any) => (cue && cue.data ? cue.data.text : ""))
        .filter((t: string) => t && t.length > 0);

      let combinedAdditional = params.additional || "";
      let analysisData: any = null;
      try {
        const analysis = await analyzeSubtitlesForContext(allTexts, {
          apiKeys: params.apiKeys || [],
          apiHost: params.apiHost || "https://api.openai.com/v1",

          model: params.model || "",
          lang: params.lang || "",
          temperature: 0.3,
        });
        combinedAdditional = `${
          combinedAdditional ? combinedAdditional + "\n\n" : ""
        }[Context]\n${analysis}`;

        analysisData = analysis;
        // Save in cache for renderer retrieval
        analysisCache.set(file.path, analysis);
        // Notify renderer with analysis result so UI can display it
        event.sender.send("batch-progress", {
          filePath: file.path,
          progress: 4,
          status: "analyzing",
          totalCues,
          currentCue: 0,
          analysis,
        });
      } catch (analysisErr) {
        console.warn(
          "Context analysis failed, continue without it:",
          analysisErr
        );
      }

      event.sender.send("batch-progress", {
        filePath: file.path,
        progress: 5,
        status: "translating",
        totalCues,
        currentCue: 0,
        analysis: analysisData,
      });

      // Translate
      let chunks = splitIntoChunk(subtitle, 20);

      let completedCues = 0;

      const chunkProcessor = async (block) => {
        // 以原始索引建立「核心段」和「上下文視窗」
        const contextSize =
          typeof params.contextSize === "number" ? params.contextSize : 5;

        const coreIndices = block
          .map((cue: any) => indexMap.get(cue) as number)
          .filter((n: number) => typeof n === "number")
          .sort((a: number, b: number) => a - b);

        if (coreIndices.length === 0) return;

        const coreStart = coreIndices[0];
        const coreEnd = coreIndices[coreIndices.length - 1];

        const contextStart = Math.max(0, coreStart - contextSize);
        const contextEnd = Math.min(subtitle.length - 1, coreEnd + contextSize);

        const windowCues = subtitle.slice(contextStart, contextEnd + 1);
        const windowText = windowCues.map((c: any) =>
          c && c.data ? String(c.data.text).replaceAll(/\n/g, " ").trim() : ""
        );

        // 多次嘗試整塊翻譯（利用隨機性），若三次仍未對齊，改用逐句翻譯（僅針對核心段）
        let translatedWindow: string[] | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          const baseTemp =
            typeof params.temperature === "number" ? params.temperature : 1;
          const attemptTemp = Math.max(
            0.1,
            Math.min(2, baseTemp + (Math.random() - 0.5) * 0.4)
          );
          const attemptResult = await retryTranslate(
            async (chunkText) =>
              translateSubtitleChunk(chunkText, {
                ...params,
                apiKeys: params.apiKeys || [],
                apiHost: params.apiHost || "https://api.openai.com/v1",
                model: params.model || "",
                prompt: params.prompt || "",
                lang: params.lang || "",
                additional: combinedAdditional || "",
                temperature: attemptTemp,
              }),
            windowText
          );
          if (attempt > 1) {
            console.log(
              `Chunk attempt ${attempt} (context window) done, temp=${attemptTemp}`
            );
          }
          if (
            Array.isArray(attemptResult) &&
            attemptResult.length === windowText.length
          ) {
            translatedWindow = attemptResult;
            break;
          }
        }

        // 逐句 fallback：僅翻譯核心行，並填回對應視窗位置
        if (!translatedWindow) {
          translatedWindow = new Array(windowText.length).fill(null);
          for (let i = 0; i < coreIndices.length; i++) {
            const idx = coreIndices[i];
            const lineText =
              subtitle[idx] && subtitle[idx].data ? subtitle[idx].data.text : "";
            const single = await retryTranslate(
              async (singleText) =>
                translateSubtitleSingle(singleText, {
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
                }),
              lineText
            );
            translatedWindow[idx - contextStart] = single;
          }
        }

        // 只回寫核心段的翻譯（丟棄上下文前後行），以避免割裂感
        let chunkCompleted = 0;
        for (const cue of block) {
          const idx = indexMap.get(cue) as number;
          if (typeof idx !== "number") continue;
          const offset = idx - contextStart;
          const t =
            translatedWindow &&
            translatedWindow[offset] != null &&
            typeof translatedWindow[offset] === "string"
              ? translatedWindow[offset]
              : "";
          if (cue && cue.data) {
            cue.data.translatedText = t;
            chunkCompleted++;
          }
        }

        completedCues += chunkCompleted;
        const progress = 10 + (completedCues / totalCues) * 90;
        const currentCue = Math.min(completedCues, totalCues);
        event.sender.send("batch-progress", {
          filePath: file.path,
          progress: Math.min(progress, 90),
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
            ext,
            params.multiLangSave || "none"
          );
        } catch (e) {
          console.warn("Failed to write partial translated file:", e);
        }
      };

      for await (const _ of pool(10, chunks, chunkProcessor)) {
        // Process chunks in parallel with concurrency 2
      }

      // Fallback for untranslated
      const untranslated = subtitle.filter(
        (line: any) => !line.data.translatedText
      );
      for (let k = 0; k < untranslated.length; k++) {
        const cue = untranslated[k];
        if (cue && cue.data) {
          cue.data.translatedText = await retryTranslate(
            async (singleText) =>
              translateSubtitleSingle(singleText, {
                ...params,
                apiKeys: params.apiKeys || [],
                apiHost: params.apiHost || "https://api.openai.com/v1",
                model: params.model || "",
                prompt: params.prompt || "",
                lang: params.lang || "",
                additional: combinedAdditional || "",
                temperature: params.temperature || 1,
              }),
            cue.data.text
          );
          const currentCueIndex = subtitle.findIndex((c: any) => c === cue);
          if (currentCueIndex !== -1) {
            completedCues++;
            const progress =
              90 +
              ((completedCues - subtitle.length + untranslated.length) /
                untranslated.length) *
                10;
            const currentCue = completedCues;
            event.sender.send("batch-progress", {
              filePath: file.path,
              progress: Math.min(100, progress),
              status: "translating",
              totalCues,
              currentCue,
              analysis: analysisData,
            });

            // Write partial translated file after single-line fallback updates
            try {
              saveTranslated(
                outputPath,
                parsed,
                ext,
                params.multiLangSave || "none"
              );
            } catch (e) {
              console.warn(
                "Failed to write partial translated file (fallback):",
                e
              );
            }
          }
        }
      }

      // Final write
      saveTranslated(outputPath, parsed, ext, params.multiLangSave || "none");
      console.log(`Saved translated file to: ${outputPath}`);
      event.sender.send("batch-progress", {
        filePath: file.path,
        progress: 100,
        status: "done",
        totalCues,
        currentCue: totalCues,
        analysis: analysisData,
      });
    } catch (e) {
      console.error(`Batch translation error for ${file.path}:`, e);
      event.sender.send("batch-progress", {
        filePath: file.path,
        progress: 0,
        status: "error",
        error: e.message,
      });
    }
  };

  for await (const _ of pool(3, files, processFile)) {
    // Process all files in parallel with concurrency 3
  }
  return { success: true };
});

// Allow renderer to fetch cached analysis for a file (in case progress event missed)
ipcMain.handle("get-analysis", async (event, filePath: string) => {
  try {
    return analysisCache.get(filePath) || null;
  } catch {
    return null;
  }
});

ipcMain.handle("get-translated-content", async (event, filePath) => {
  const translatedPath =
    filePath.replace(/\.[^/.]+$/, "") +
    ".translated." +
    path.extname(filePath).slice(1).toLowerCase();
  if (fs.existsSync(translatedPath)) {
    return fs.readFileSync(translatedPath, "utf8");
  }
  throw new Error("Translated file not found");
});

ipcMain.handle("get-subtitle-preview", async (event, filePath) => {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const content = fs.readFileSync(filePath, "utf8");
  let parsed = parseSubtitle(content, ext);
  let subtitle;
  if (Array.isArray(parsed)) {
    subtitle = parsed.filter((line: any) => line.type === "cue");
  } else if (parsed.events) {
    subtitle = parsed.events;
  } else {
    subtitle = parsed;
  }

  const translatedPath =
    filePath.replace(/\.[^/.]+$/, "") + ".translated." + ext;

  // Prefer time-based alignment to avoid index drift; fallback to index-based if needed
  let translatedCuesArray: string[] | null = null;
  let translatedMap: Map<string, string> | null = null;

  const makeKey = (start: any, end: any) => {
    const norm = (v: any) =>
      typeof v === "number" ? Math.round(v) : String(v).trim();
    return `${norm(start)}|${norm(end)}`;
  };

  if (fs.existsSync(translatedPath)) {
    const translatedContent = fs.readFileSync(translatedPath, "utf8");
    let translatedParsed = parseSubtitle(translatedContent, ext);
    let translatedSubtitle;
    if (Array.isArray(translatedParsed)) {
      translatedSubtitle = translatedParsed.filter(
        (line: any) => line.type === "cue"
      );
    } else if (translatedParsed.events) {
      translatedSubtitle = translatedParsed.events;
    } else {
      translatedSubtitle = translatedParsed;
    }

    translatedCuesArray = translatedSubtitle.map(
      (c: any) => c.data.translatedText || c.data.text
    );

    translatedMap = new Map<string, string>();
    translatedSubtitle.forEach((c: any) => {
      const key = makeKey(c.data.start, c.data.end);
      translatedMap!.set(key, c.data.translatedText || c.data.text);
    });
  }

  const cues = subtitle.map((cue: any, index: number) => {
    const key = makeKey(cue.data.start, cue.data.end);
    const byTime = translatedMap ? translatedMap.get(key) : undefined;
    const byIndex = translatedCuesArray
      ? translatedCuesArray[index]
      : undefined;
    return {
      text: cue.data.text,
      translatedText: byTime ?? byIndex,
      start: cue.data.start,
      end: cue.data.end,
    };
  });

  return { cues };
});
