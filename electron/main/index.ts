import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions,
  type Session,
  type WebFrameMain,
  type WebContents,
} from "electron";
import { translationErrorCodes } from "../shared/translation-error-codes";
import { release } from "node:os";
import { join } from "node:path";
import fs, { type Stats } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import pool from "tiny-async-pool";
import { z } from "zod";
import { APICallError } from "ai";
import {
  type BatchProgress,
  type BatchTranslationRequest,
  type TranslationMode,
} from "../../src/types/electron-api";
import {
  parseSubtitle,
  parseTranslationCache,
  getSubtitleCues,
} from "./utils/translate";
import {
  createAdaptiveSubtitlePreview,
  createSubtitlePreview,
} from "./utils/subtitle-preview";
import { formatTranslationBrief } from "./utils/adaptive/brief";
import {
  hasMatchingAdaptiveCheckpointSource,
  parseAdaptiveCheckpoint,
} from "./utils/adaptive/checkpoint";
import type { AdaptiveTranslationCheckpointV3 } from "./utils/adaptive/types";
import { normalizeAssFontName } from "./utils/ass-bilingual";
import {
  getSubtitleOutputFileSuffix,
  subtitleOutputFormats,
  type SubtitleOutputFormat,
} from "./utils/subtitle-output";
import { fetchAvailableModels } from "./utils/models";
import { RequestRateLimiter } from "./utils/request-rate-limiter";
import { isAllowedApiHost } from "./utils/api-host";
import { getRetryAfterMsFromHeaders } from "./utils/retry-after";
import { getErrorDetails } from "./utils/error-details";
import { getAdaptiveInputValidationError } from "./utils/adaptive/input-validation";
import { processAdaptiveTranslationFile } from "./process-adaptive-translation-file";
import {
  processStrictTranslationFile,
  type StrictTranslationInput,
} from "./process-strict-translation-file";
import { createUsageSummary } from "./utils/adaptive/usage";
import type { StageUsage } from "./utils/adaptive/types";
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
  mode: z
    .enum(["strict", "adaptive"] as [TranslationMode, TranslationMode])
    .default("strict"),
  lang: z.string(),
  additional: z.string(),
  temperature: z.number().finite().min(0).max(2),
  outputFormat: z.enum(subtitleOutputFormats),
  assFonts: z
    .object({
      translationFont: z.string().max(100).transform(normalizeAssFontName),
      originalFont: z.string().max(100).transform(normalizeAssFontName),
    })
    .default({ translationFont: "", originalFont: "" }),
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
  jobId: z.string().uuid(),
  files: z
    .array(subtitleFileSchema)
    .min(1)
    .max(100)
    .refine(
      (files) =>
        new Set(files.map((file) => getPathClaimKey(file.path))).size ===
        files.length,
      { message: "Duplicate translation input path" }
    ),
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

function getInputExtension(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase();
}

function assertAdaptiveTranslationInput(
  filePath: string,
  outputFormat: SubtitleOutputFormat
): void {
  const extension = getInputExtension(filePath);
  let checkpointHeader:
    | { version?: unknown; kind?: unknown; format?: unknown }
    | undefined;
  if (extension === "json") {
    let value: unknown;
    try {
      value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    } catch {
      throw new Error(translationErrorCodes.adaptiveInvalidCheckpoint);
    }
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      checkpointHeader = {
        version: record.version,
        kind: record.kind,
        format: record.format,
      };
    }
  }

  const errorCode = getAdaptiveInputValidationError({
    extension,
    outputFormat,
    checkpointHeader,
  });
  if (errorCode) throw new Error(errorCode);
}

function getAdaptiveSourceMetadata(filePath: string): {
  sourceName: string;
  sourceExtension: "srt" | "vtt";
  sourceFingerprint?: TranslationSourceFingerprint;
} {
  const extension = getInputExtension(filePath);
  if (extension === "srt" || extension === "vtt") {
    const fileInfo = fs.statSync(filePath);
    return {
      sourceName: path.basename(filePath),
      sourceExtension: extension,
      sourceFingerprint: { size: fileInfo.size, mtimeMs: fileInfo.mtimeMs },
    };
  }

  const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  const record = value as Record<string, unknown>;
  const source = record.source as Record<string, unknown> | undefined;
  const sourceName =
    typeof source?.name === "string" && source.name.trim().length > 0
      ? path.basename(source.name)
      : path.basename(filePath);
  const sourceExtension = record.format === "vtt" ? "vtt" : "srt";
  const fingerprint = source?.fingerprint as
    | TranslationSourceFingerprint
    | undefined;
  return { sourceName, sourceExtension, sourceFingerprint: fingerprint };
}

interface AdaptivePreviewDocument {
  checkpoint: AdaptiveTranslationCheckpointV3;
  source: ParsedSubtitle;
}

function hasAdaptiveCheckpointHeader(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.version === 3 || record.kind === "adaptive";
}

function parseAdaptiveCheckpointFile(filePath: string): AdaptiveTranslationCheckpointV3 | undefined {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error: unknown) {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (errorCode === "ENOENT") return undefined;
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    throw new Error(translationErrorCodes.adaptiveInvalidCheckpoint);
  }
  if (!hasAdaptiveCheckpointHeader(value)) return undefined;
  try {
    return parseAdaptiveCheckpoint(content);
  } catch {
    throw new Error(translationErrorCodes.adaptiveInvalidCheckpoint);
  }
}

/**
 * Locate an Adaptive v3 project either directly or as a source sidecar. A
 * matching source fingerprint is required before a sidecar can contribute
 * preview/analysis data; otherwise strict preview must never masquerade as an
 * Adaptive result.
 */
function readAdaptivePreviewDocument(
  filePath: string
): AdaptivePreviewDocument | undefined {
  const extension = getInputExtension(filePath);
  if (extension === "json") {
    const checkpoint = parseAdaptiveCheckpointFile(filePath);
    return checkpoint
      ? { checkpoint, source: checkpoint.subtitle }
      : undefined;
  }
  if (extension !== "srt" && extension !== "vtt") return undefined;

  const fileInfo = fs.statSync(filePath);
  const sourceName = path.basename(filePath);
  const sourceFingerprint = { size: fileInfo.size, mtimeMs: fileInfo.mtimeMs };
  const checkpointPath = getTranslationCachePath(filePath, sourceName);
  const checkpoint = parseAdaptiveCheckpointFile(checkpointPath);
  if (!checkpoint) return undefined;
  if (
    !hasMatchingAdaptiveCheckpointSource(
      checkpoint,
      sourceName,
      extension,
      sourceFingerprint
    )
  ) {
    throw new Error(translationErrorCodes.adaptiveIncompatibleCheckpoint);
  }

  const source = parseSubtitle(fs.readFileSync(filePath, "utf8"), extension);
  return { checkpoint, source };
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

function isTrustedApplicationUrl(frameUrl: string): boolean {
  try {
    if (url) {
      return new URL(frameUrl).origin === new URL(url).origin;
    }

    const actualUrl = new URL(frameUrl);
    const expectedUrl = new URL(packagedIndexUrl);
    return (
      actualUrl.protocol === expectedUrl.protocol &&
      actualUrl.pathname === expectedUrl.pathname
    );
  } catch {
    return false;
  }
}

function isTrustedSender(frame: WebFrameMain | null): boolean {
  return frame !== null && isTrustedApplicationUrl(frame.url);
}

function assertTrustedSender(event: { senderFrame: WebFrameMain | null }): void {
  if (!isTrustedSender(event.senderFrame)) {
    throw new Error("Untrusted IPC sender");
  }
}

function registerTranslationController(
  filePath: string,
  jobId: string,
  controller: AbortController
): () => void {
  const key = `${jobId}\0${filePath}`;
  const controllers = activeTranslationControllers.get(key) || new Set();
  controllers.add(controller);
  activeTranslationControllers.set(key, controllers);

  return () => {
    controllers.delete(controller);
    if (controllers.size === 0) {
      activeTranslationControllers.delete(key);
    }
  };
}

function cancelTranslation(filePath: string, jobId: string): void {
  const key = `${jobId}\0${filePath}`;
  const controllers = activeTranslationControllers.get(key);
  if (!controllers || controllers.size === 0) return;
  for (const controller of controllers) {
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
  outputFormat: SubtitleOutputFormat,
  outputDirectory?: string,
  sourceName = path.basename(filePath)
): string {
  const basename = path.basename(sourceName, path.extname(sourceName));
  return path.join(
    outputDirectory ?? path.dirname(filePath),
    `${basename}.${getSubtitleOutputFileSuffix(outputFormat)}`
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

type TranslationInput = StrictTranslationInput;

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

function getRetryAfterMs(error: unknown): number {
  if (!APICallError.isInstance(error) || !error.responseHeaders) return 0;
  return getRetryAfterMsFromHeaders(error.responseHeaders);
}

function isRetryableTranslationError(error: unknown): boolean {
  if (APICallError.isInstance(error)) return error.isRetryable;

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
  const details = getErrorDetails(error);
  return details.code &&
    (details.code.startsWith("ERR_") || details.code.startsWith("adaptive."))
    ? details.code
    : details.message;
}

function sendProgress(sender: WebContents, progress: BatchProgress): void {
  if (sender.isDestroyed()) return;
  try {
    void Promise.resolve(sender.send("batch-progress", progress)).catch(
      () => undefined
    );
  } catch {
    // Closing or reloading the renderer must not turn a translation into a
    // failed job. The checkpoint remains the source of truth for resuming.
  }
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

function configureSessionPermissions(applicationSession: Session): void {
  const isTrustedLocalFontsRequest = (
    permission: string,
    requestingUrl: string | undefined
  ) =>
    permission === "local-fonts" &&
    typeof requestingUrl === "string" &&
    isTrustedApplicationUrl(requestingUrl);

  applicationSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) =>
      isTrustedLocalFontsRequest(
        permission,
        details.requestingUrl || webContents?.getURL() || requestingOrigin
      )
  );
  applicationSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        isTrustedLocalFontsRequest(
          permission,
          details.requestingUrl || webContents.getURL()
        )
      );
    }
  );
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

  configureSessionPermissions(win.webContents.session);

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

ipcMain.on("cancel-translation", (event, request: unknown) => {
  if (!isTrustedSender(event.senderFrame)) return;
  const parsedRequest = z
    .object({ filePath: z.string().min(1), jobId: z.string().uuid() })
    .safeParse(request);
  if (!parsedRequest.success) return;
  cancelTranslation(parsedRequest.data.filePath, parsedRequest.data.jobId);
});

ipcMain.handle("batch-translate", async (event, request: unknown) => {
  assertTrustedSender(event);
  const { jobId, files, params } = batchTranslationRequestSchema.parse(request);
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
      registerTranslationController(file.path, jobId, controller)
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
    let usageRecords: StageUsage[] = [];
    let lastProgress: BatchProgress | undefined;
    const sendFileProgress = (progress: BatchProgress): void => {
      const jobProgress = { ...progress, jobId };
      lastProgress = jobProgress;
      sendProgress(event.sender, jobProgress);
    };
    const sendStrictProgress = (progress: BatchProgress): void => {
      sendFileProgress({
        ...progress,
        mode: "strict",
        usageSummary: createUsageSummary(usageRecords),
      });
    };
    try {
      abortSignal.throwIfAborted();

      if (params.mode === "adaptive") {
        assertAdaptiveTranslationInput(file.path, params.outputFormat);
        const adaptiveMetadata = getAdaptiveSourceMetadata(file.path);
        const outputDirectory = getValidatedOutputDirectory(
          params.outputDirectory
        );
        const adaptiveOutputPath = getTranslatedPath(
          file.path,
          params.outputFormat,
          outputDirectory,
          adaptiveMetadata.sourceName
        );
        const adaptiveCheckpointPath =
          getInputExtension(file.path) === "json"
            ? file.path
            : getTranslationCachePath(file.path, adaptiveMetadata.sourceName);
        outputPath = adaptiveOutputPath;
        releasePathClaims = claimTranslationPaths(
          [adaptiveOutputPath, adaptiveCheckpointPath],
          batchPathClaims
        );

        await processAdaptiveTranslationFile({
          file,
          params,
          abortSignal,
          requestRateLimiter,
          outputPath: adaptiveOutputPath,
          checkpointPath: adaptiveCheckpointPath,
          sourceName: adaptiveMetadata.sourceName,
          sourceExtension: adaptiveMetadata.sourceExtension,
          sourceFingerprint: adaptiveMetadata.sourceFingerprint,
          retryRequest: (fn, delay, signal) =>
            retryTranslate(() => fn(), undefined, delay, signal),
          sendProgress: sendFileProgress,
        });
        return;
      }

      const input = readTranslationInput(
        file.path,
        translationConfigFingerprint
      );
      usageRecords = [...(input.cacheDocument?.usage ?? [])];

      const outputDirectory = getValidatedOutputDirectory(
        params.outputDirectory
      );
      const translatedOutputPath = getTranslatedPath(
        file.path,
        params.outputFormat,
        outputDirectory,
        input.sourceName
      );
      outputPath = translatedOutputPath;
      const checkpointPath = input.checkpointPath;
      analysisCache.delete(file.path);
      releasePathClaims = claimTranslationPaths(
        [translatedOutputPath, checkpointPath],
        batchPathClaims
      );
      await processStrictTranslationFile({
        file,
        params,
        abortSignal,
        requestRateLimiter,
        translationConfigFingerprint,
        input,
        outputPath: translatedOutputPath,
        usageRecords,
        analysisCache,
        retryRequest: (fn, delay, signal) =>
          retryTranslate(() => fn(), undefined, delay, signal),
        sendProgress: sendFileProgress,
      });
    } catch (e: unknown) {
      if (abortSignal.aborted) return;
      const details = getErrorDetails(e);
      console.error(
        `Batch translation error for ${file.path}: ${details.code || details.message || details.name || "unknown error"}`
      );
      const errorProgress: BatchProgress = {
        ...lastProgress,
        filePath: file.path,
        progress: lastProgress?.progress ?? 0,
        status: "error",
        mode: params.mode,
        error: getErrorMessage(e),
        outputPath: outputPath ?? lastProgress?.outputPath,
      };
      sendFileProgress(errorProgress);
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
  const adaptiveDocument = readAdaptivePreviewDocument(validatedPath);
  if (adaptiveDocument) {
    return adaptiveDocument.checkpoint.brief
      ? formatTranslationBrief(adaptiveDocument.checkpoint.brief)
      : null;
  }
  return analysisCache.get(validatedPath) ?? null;
});

ipcMain.handle("get-subtitle-preview", async (event, request: unknown) => {
  assertTrustedSender(event);
  const { filePath: validatedPath, outputPath } =
    subtitlePreviewRequestSchema.parse(request);
  const requestedOutputExtension = outputPath
    ? path.extname(outputPath).slice(1).toLowerCase()
    : undefined;
  if (
    requestedOutputExtension &&
    !supportedExtensions.has(requestedOutputExtension as SubtitleFileExtension)
  ) {
    throw new Error(translationErrorCodes.unsupportedFileExtension);
  }
  const adaptiveDocument = readAdaptivePreviewDocument(validatedPath);
  if (adaptiveDocument) {
    return {
      cues: createAdaptiveSubtitlePreview(
        adaptiveDocument.source,
        adaptiveDocument.checkpoint.scenes
      ),
    };
  }

  const input = readTranslationInput(validatedPath);
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
    const outputCandidates = subtitleOutputFormats.map((format) =>
      getTranslatedPath(validatedPath, format, undefined, input.sourceName)
    );
    const translatedPath =
      outputPath ??
      outputCandidates.find((candidate) => fs.existsSync(candidate)) ??
      outputCandidates[0];

    if (fs.existsSync(translatedPath)) {
      const translatedContent = fs.readFileSync(translatedPath, "utf8");
      const translatedExtension = path
        .extname(translatedPath)
        .slice(1)
        .toLowerCase();
      const translatedParsed: ParsedSubtitle = parseSubtitle(
        translatedContent,
        translatedExtension
      );
      translatedSubtitle = getSubtitleCues(translatedParsed);
    }
  }

  return { cues: createSubtitlePreview(subtitle, translatedSubtitle) };
});
