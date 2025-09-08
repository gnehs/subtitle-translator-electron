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

async function retryTranslate(fn, params, maxRetries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn(params);
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      // Check if error is retryable (e.g., network, rate limit, AI validation)
      const errorMessage = error.message || error.toString();
      const isRetryable =
        errorMessage.includes("network") ||
        errorMessage.includes("timeout") ||
        (error.status && (error.status >= 429 || error.status >= 500)) ||
        error.name === "NoObjectGeneratedError" ||
        (error.cause && error.cause.name === "TypeValidationError") ||
        errorMessage.includes("AI_NoObjectGeneratedError") ||
        errorMessage.includes("validation");
      if (isRetryable) {
        console.warn(
          `Translation attempt ${attempt} failed: ${errorMessage}. Retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw error; // Non-retryable error
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
      event.sender.send("batch-progress", {
        filePath: file.path,
        progress: 0,
        status: "translating",
        totalCues,
        currentCue: 0,
      });

      // Translate
      let chunks = splitIntoChunk(
        subtitle,
        Math.round(Math.random() * 10 + 20)
      );
      let cueProgressPerChunk = 90 / totalCues;

      let completedCues = 0;

      const chunkProcessor = async (block) => {
        const text = block.map((line: any) =>
          line ? (line.data ? line.data.text : "") : ""
        );
        const translatedText = await retryTranslate(
          async (chunkText) =>
            translateSubtitleChunk(chunkText, {
              ...params,
              apiKeys: params.apiKeys || [],
              apiHost: params.apiHost || "https://api.openai.com/v1",
              apiHeaders: params.apiHeaders || [],
              model: params.model || "",
              prompt: params.prompt || "",
              lang: params.lang || "",
              additional: params.additional || "",
              temperature: params.temperature || 1,
              compatibility: params.compatibility || false,
            }),
          text
        );
        let chunkCompleted = 0;
        for (
          let j = 0;
          j < Math.min(translatedText.length, block.length);
          j++
        ) {
          if (block[j] && block[j].data) {
            block[j].data.translatedText = translatedText[j] || "";
            const currentCueIndex = subtitle.findIndex(
              (cue: any) => cue === block[j]
            );
            if (currentCueIndex !== -1) {
              chunkCompleted++;
            }
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
        });
      };

      for await (const _ of pool(2, chunks, chunkProcessor)) {
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
                apiHeaders: params.apiHeaders || [],
                model: params.model || "",
                prompt: params.prompt || "",
                lang: params.lang || "",
                additional: params.additional || "",
                temperature: params.temperature || 1,
                compatibility: params.compatibility || false,
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
            });
          }
        }
      }

      const outputPath = path.join(
        path.dirname(file.path),
        file.name.replace(/\.[^/.]+$/, "") + ".translated." + ext
      );
      saveTranslated(outputPath, parsed, ext, params.multiLangSave || "none");
      console.log(`Saved translated file to: ${outputPath}`);
      event.sender.send("batch-progress", {
        filePath: file.path,
        progress: 100,
        status: "done",
        totalCues,
        currentCue: totalCues,
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
  let translatedCues = null;
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
    translatedCues = translatedSubtitle.map(
      (c: any) => c.data.translatedText || c.data.text
    );
  }

  const cues = subtitle.map((cue: any, index: number) => ({
    text: cue.data.text,
    translatedText: translatedCues ? translatedCues[index] : undefined,
    start: cue.data.start,
    end: cue.data.end,
  }));

  return { cues };
});
