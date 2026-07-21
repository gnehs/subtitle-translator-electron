import { useEffect, useRef, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { toast } from "sonner";
import useFile from "@/hooks/useFile";
import useModel from "@/hooks/useModel";
import usePrompt from "@/hooks/usePrompt";
import useDelay from "@/hooks/useDelay";
import useRPM from "@/hooks/useRPM";
import useTranslationConcurrency from "@/hooks/useTranslationConcurrency";
import useTranslationSuccessCount, {
  TRANSLATION_SUCCESS_THRESHOLD,
} from "@/hooks/useTranslationSuccessCount";
import { useTranslation } from "@/i18n";
import { useAPIHost, useAPIKeys, useTemperature } from "@/hooks/useOpenAI";
import { getFilePath } from "@/utils/filePath";
import BuyMeACoffee from "@/components/BuyMeACoffee";
import type {
  AvailableModel,
  BatchProgress,
  SubtitleCuePreview,
  SubtitleFile,
  TranslationParams,
} from "@/types/electron-api";
import { translationErrorCodes } from "@/types/electron-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Eye,
  FileAudio,
  FilePlus2,
  FileStack,
  FolderOpen,
  LoaderCircle,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import MarkdownContent from "@/components/MarkdownContent";

type FileProgress = Pick<BatchProgress, "progress" | "status"> &
  Partial<Omit<BatchProgress, "progress" | "status">> & {
    model?: string;
    targetLanguage?: string;
  };

type ModelLoadStatus = "idle" | "loading" | "success" | "error";
type PreviewLoadStatus = "idle" | "loading" | "success" | "error";

type TranslatorPanelProps = {
  addTaskRequest: number;
};

const supportedExtensions = [".ass", ".ssa", ".srt", ".vtt", ".json"];
const DEFAULT_CONTEXT_SIZE = 5;
const MAX_CONTEXT_SIZE = 100;

function normalizeContextSize(value: unknown): number {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) return DEFAULT_CONTEXT_SIZE;
  return Math.min(MAX_CONTEXT_SIZE, Math.max(0, Math.round(numericValue)));
}

type Translate = (id: string, values?: Record<string, unknown>) => string;

const translationErrorMessageIds: Record<string, string> = {
  [translationErrorCodes.unsupportedInputFile]: "error.unsupportedInputFile",
  [translationErrorCodes.inputPathNotFile]: "error.inputPathNotFile",
  [translationErrorCodes.unsupportedSubtitleFormat]: "error.unsupportedSubtitleFormat",
  [translationErrorCodes.invalidCheckpoint]: "error.invalidCheckpoint",
  [translationErrorCodes.incompatibleCheckpoint]: "error.incompatibleCheckpoint",
  [translationErrorCodes.noValidApiKeys]: "error.noValidApiKeys",
  [translationErrorCodes.unsupportedFileExtension]: "error.unsupportedFileExtension",
  [translationErrorCodes.outputPathConflict]: "error.outputPathConflict",
  [translationErrorCodes.repetitiveModelOutput]: "error.repetitiveModelOutput",
  [translationErrorCodes.incompleteModelOutput]: "error.incompleteModelOutput",
};

function getLocalizedError(error: unknown, fallbackId: string, t: Translate): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const messageId = translationErrorMessageIds[message];
  return messageId ? t(messageId) : message || t(fallbackId);
}

function getStatusVariant(status: BatchProgress["status"]) {
  if (status === "error") return "destructive" as const;
  if (status === "done") return "outline" as const;
  if (status === "translating" || status === "analyzing") return "default" as const;
  return "secondary" as const;
}

function getParentFolder(filePath: string, fallback: string) {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts.at(-2) || fallback;
}

function formatCueTime(value: SubtitleCuePreview["start"]): string {
  if (typeof value === "string") {
    return value.trim() || "—";
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "—";
  }

  const totalMilliseconds = Math.round(value);
  const milliseconds = totalMilliseconds % 1000;
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  const wholeSeconds = [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return `${wholeSeconds}.${String(milliseconds).padStart(3, "0")}`;
}

function formatCueTimeRange(cue: SubtitleCuePreview): string {
  return `${formatCueTime(cue.start)}–${formatCueTime(cue.end)}`;
}

export default function TranslatorPanel({ addTaskRequest }: TranslatorPanelProps) {
  const { i18n, t } = useTranslation();
  const [files, setFiles] = useFile();
  const [lang, setLang] = useLocalStorage("translate_lang", "");
  const [additional, setAdditional] = useLocalStorage("translate_additional", "");
  const [contextSize, setContextSize] = useLocalStorage(
    "translate_context_size",
    DEFAULT_CONTEXT_SIZE
  );
  const normalizedContextSize = normalizeContextSize(contextSize);
  const [model, setModel] = useModel();
  const [prompt] = usePrompt();
  const [delay] = useDelay();
  const [keys] = useAPIKeys();
  const [apiHost] = useAPIHost();
  const [temperature] = useTemperature();
  const apiKey = keys.find((key) => key.trim().length > 0)?.trim() || "";
  const normalizedApiHost = apiHost.trim();
  const [requestsPerMinute] = useRPM();
  const [concurrency] = useTranslationConcurrency();
  const [translationSuccessCount, incrementTranslationSuccessCount] =
    useTranslationSuccessCount();
  const [multiLangSave, setMultiLangSave] = useLocalStorage<TranslationParams["multiLangSave"]>(
    "multi_language_save",
    "none"
  );
  const [outputDirectory, setOutputDirectory] = useLocalStorage(
    "translate_output_directory",
    ""
  );
  const [taskModel, setTaskModel] = useState(model);
  const [isChoosingOutputDirectory, setIsChoosingOutputDirectory] = useState(false);
  const [batchProgress, setBatchProgress] = useState<Record<string, FileProgress>>({});
  const [pendingFiles, setPendingFiles] = useState<SubtitleFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<SubtitleFile | null>(null);
  const [cues, setCues] = useState<SubtitleCuePreview[]>([]);
  const [previewLoadStatus, setPreviewLoadStatus] =
    useState<PreviewLoadStatus>("idle");
  const [previewLoadError, setPreviewLoadError] = useState("");
  const [selectedAnalysis, setSelectedAnalysis] = useState<string | undefined>();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeTranslationCount, setActiveTranslationCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [modelLoadStatus, setModelLoadStatus] = useState<ModelLoadStatus>("idle");
  const [modelLoadError, setModelLoadError] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const isTranslating = activeTranslationCount > 0;
  const statusCopy: Record<BatchProgress["status"], string> = {
    pending: t("task.status.pending"),
    analyzing: t("task.status.analyzing"),
    translating: t("task.status.translating"),
    done: t("task.status.done"),
    error: t("task.status.error"),
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastPreviewUpdateRef = useRef(0);
  const previewRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const handledAddTaskRequestRef = useRef(0);

  useEffect(() => {
    if (!window.electronAPI?.onBatchProgress) return;
    const unsubscribe = window.electronAPI.onBatchProgress((data) => {
      setBatchProgress((previous) => ({
        ...previous,
        [data.filePath]: {
          ...previous[data.filePath],
          ...data,
          analysis:
            data.analysis === undefined
              ? previous[data.filePath]?.analysis
              : data.analysis ?? undefined,
        },
      }));

      if (
        selectedFile?.path === data.filePath &&
        data.analysis !== undefined
      ) {
        setSelectedAnalysis(data.analysis ?? undefined);
      }

      const now = Date.now();
      if (
        detailOpen &&
        selectedFile?.path === data.filePath &&
        previewLoadStatus === "success" &&
        (data.status === "translating" || data.status === "done") &&
        now - lastPreviewUpdateRef.current > 800
      ) {
        lastPreviewUpdateRef.current = now;
        void loadCues(data.filePath, false, data.outputPath);
      }

      if (data.status === "error") {
        toast.error(
          t("toast.translationFailed", {
            error: getLocalizedError(data.error || data.filePath, "toast.unknownError", t),
          })
        );
      }
      if (data.status === "done") {
        incrementTranslationSuccessCount();
        toast.success(
          t("toast.translationCompleted", {
            file: data.filePath.split(/[\\/]/).at(-1) || data.filePath,
          })
        );
      }
    });

    return unsubscribe;
  }, [
    detailOpen,
    i18n.locale,
    incrementTranslationSuccessCount,
    previewLoadStatus,
    selectedFile,
  ]);

  useEffect(() => {
    if (!addDialogOpen) {
      setModelPickerOpen(false);
      setModelSearch("");
      return;
    }

    const controller = new AbortController();
    if (!apiKey || !normalizedApiHost) {
      setAvailableModels([]);
      setModelLoadStatus("idle");
      setModelLoadError("");
      return () => controller.abort();
    }

    if (typeof window.electronAPI?.listModels !== "function") {
      setAvailableModels([]);
      setModelLoadStatus("error");
      setModelLoadError(t("toast.modelListUnavailable"));
      return () => controller.abort();
    }

    setModelLoadStatus("loading");
    setModelLoadError("");
    setAvailableModels([]);

    void window.electronAPI
      .listModels({ apiKey, apiHost: normalizedApiHost })
      .then((models) => {
        if (controller.signal.aborted) return;

        const uniqueModels = Array.from(
          new Map(models.map((modelInfo) => [modelInfo.id, modelInfo])).values()
        ).sort((left, right) => left.id.localeCompare(right.id));
        setAvailableModels(uniqueModels);
        setModelLoadStatus("success");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;

        setAvailableModels([]);
        setModelLoadStatus("error");
        setModelLoadError(getLocalizedError(error, "toast.modelListFailed", t));
      });

    return () => controller.abort();
  }, [addDialogOpen, apiKey, normalizedApiHost]);

  useEffect(() => {
    if (
      addTaskRequest === 0 ||
      addTaskRequest === handledAddTaskRequestRef.current
    ) {
      return;
    }
    handledAddTaskRequestRef.current = addTaskRequest;
    fileInputRef.current?.click();
  }, [addTaskRequest]);

  const completedCount = files.filter(
    (file) => batchProgress[file.path]?.status === "done"
  ).length;
  const activeCount = files.filter((file) => {
    const status = batchProgress[file.path]?.status;
    return status === "analyzing" || status === "translating";
  }).length;
  const shouldShowCoffeeBanner =
    translationSuccessCount > TRANSLATION_SUCCESS_THRESHOLD;

  const customModelValue = modelSearch.trim();
  const normalizedModelSearch = customModelValue.toLowerCase();
  const filteredModels = availableModels.filter((modelInfo) =>
    modelInfo.id.toLowerCase().includes(normalizedModelSearch)
  );
  const hasCustomModelOption =
    customModelValue.length > 0 &&
    !availableModels.some(
      (modelInfo) => modelInfo.id.toLowerCase() === normalizedModelSearch
    );

  const selectModel = (nextModel: string) => {
    const normalizedModel = nextModel.trim();
    if (!normalizedModel) return;
    setTaskModel(normalizedModel);
    setModelPickerOpen(false);
    setModelSearch("");
  };

  const handleModelPickerChange = (open: boolean) => {
    setModelPickerOpen(open);
    if (!open) setModelSearch("");
  };

  const resolveSelectedFiles = (selectedFiles: File[]) => {
    const accepted: SubtitleFile[] = [];
    let rejectedCount = 0;

    for (const file of selectedFiles) {
      const lowerName = file.name.toLowerCase();
      if (!supportedExtensions.some((extension) => lowerName.endsWith(extension))) {
        rejectedCount += 1;
        continue;
      }

      try {
        const path = getFilePath(file);
        if (!path || files.some((item) => item.path === path) || accepted.some((item) => item.path === path)) {
          continue;
        }
        accepted.push({ path, name: file.name });
      } catch (error: unknown) {
        toast.error(getLocalizedError(error, "toast.fileReadFailed", t));
      }
    }

    if (rejectedCount > 0) {
      toast.error(t("toast.filesSkipped", { count: rejectedCount }));
    }
    return accepted;
  };

  const requestAddFiles = (selectedFiles: File[]) => {
    const nextFiles = resolveSelectedFiles(selectedFiles);
    if (nextFiles.length === 0) return;
    setTaskModel(model);
    setPendingFiles(nextFiles);
    setAddDialogOpen(true);
  };

  const chooseOutputDirectory = async () => {
    if (!window.electronAPI?.selectDirectory) {
      toast.error(t("toast.outputDirectoryUnavailable"));
      return;
    }

    setIsChoosingOutputDirectory(true);
    try {
      const selectedDirectory = await window.electronAPI.selectDirectory(
        outputDirectory || undefined
      );
      if (selectedDirectory) setOutputDirectory(selectedDirectory);
    } catch (error: unknown) {
      toast.error(getLocalizedError(error, "toast.outputDirectoryFailed", t));
    } finally {
      setIsChoosingOutputDirectory(false);
    }
  };

  const loadCues = async (
    filePath: string,
    showLoading = true,
    outputPath?: string
  ) => {
    const requestId = ++previewRequestIdRef.current;
    if (showLoading) {
      setPreviewLoadStatus("loading");
      setPreviewLoadError("");
    }

    try {
      const preview = await window.electronAPI.getSubtitlePreview({
        filePath,
        outputPath,
      });
      if (requestId !== previewRequestIdRef.current) return;
      setCues(preview.cues);
      setPreviewLoadStatus("success");
      setPreviewLoadError("");
    } catch (error: unknown) {
      if (requestId !== previewRequestIdRef.current) return;
      if (!showLoading) return;
      setPreviewLoadStatus("error");
      setPreviewLoadError(
        getLocalizedError(error, "toast.subtitleLoadFailed", t)
      );
    }
  };

  const openDetails = async (file: SubtitleFile) => {
    const detailRequestId = ++detailRequestIdRef.current;
    setSelectedFile(file);
    setSelectedAnalysis(batchProgress[file.path]?.analysis ?? undefined);
    setCues([]);
    setDetailOpen(true);
    await loadCues(
      file.path,
      true,
      batchProgress[file.path]?.outputPath
    );
    try {
      const analysis = await window.electronAPI.getAnalysis(file.path);
      if (detailRequestId !== detailRequestIdRef.current) return;
      if (analysis) {
        setSelectedAnalysis(analysis);
        setBatchProgress((previous) => ({
          ...previous,
          [file.path]: {
            ...(previous[file.path] || { progress: 0, status: "pending" }),
            analysis,
          },
        }));
      }
    } catch {
      // Analysis is optional for the detail view.
    }
  };

  const closeDetails = () => {
    detailRequestIdRef.current += 1;
    previewRequestIdRef.current += 1;
    setDetailOpen(false);
    setSelectedFile(null);
    setSelectedAnalysis(undefined);
    setCues([]);
    setPreviewLoadStatus("idle");
    setPreviewLoadError("");
  };

  const removeFile = (filePath: string) => {
    window.electronAPI.cancelTranslation(filePath);
    setFiles(files.filter((file) => file.path !== filePath));
    setBatchProgress((previous) => {
      const next = { ...previous };
      delete next[filePath];
      return next;
    });
    if (selectedFile?.path === filePath) closeDetails();
    toast.success(t("toast.taskRemoved"));
  };

  const clearCompletedFiles = () => {
    if (completedCount === 0) return;
    const remaining = files.filter((file) => batchProgress[file.path]?.status !== "done");
    setFiles(remaining);
    setBatchProgress((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([path]) => remaining.some((file) => file.path === path)))
    );
    toast.success(t("toast.completedCleared", { count: completedCount }));
  };

  const startBatchTranslation = async (
    filesToTranslate: SubtitleFile[],
    translationModel: string
  ) => {
    const translatableFiles = filesToTranslate.filter(
      (file) => batchProgress[file.path]?.status !== "done"
    );
    if (translatableFiles.length === 0) return;
    if (!lang.trim()) {
      toast.error(t("toast.targetLanguageRequired"));
      return;
    }
    if (!keys.some((key) => key.trim().length > 0)) {
      toast.error(t("toast.apiKeyRequired"));
      return;
    }

    setActiveTranslationCount((count) => count + 1);
    setBatchProgress((previous) => ({
      ...previous,
      ...Object.fromEntries(
        translatableFiles.map((file) => [
          file.path,
          {
            progress: 0,
            status: "pending" as const,
            model: translationModel,
            targetLanguage: lang,
          },
        ])
      ),
    }));

    try {
      await window.electronAPI.translateBatch({
        files: translatableFiles,
        params: {
          apiKeys: keys,
          apiHost,
          model: translationModel,
          prompt,
          lang,
          additional,
          temperature,
          multiLangSave,
          concurrency,
          contextSize: normalizedContextSize,
          delay: delay * 1000,
          requestsPerMinute,
          outputDirectory: outputDirectory || undefined,
        },
      });
    } catch (error: unknown) {
      toast.error(
        t("toast.translationJobFailed", {
          error: getLocalizedError(error, "toast.unknownError", t),
        })
      );
    } finally {
      setActiveTranslationCount((count) => Math.max(0, count - 1));
    }
  };

  const addPendingTasks = () => {
    const filesToTranslate = pendingFiles;
    const translationModel = taskModel.trim();
    if (filesToTranslate.length === 0 || !translationModel) return;
    if (!lang.trim()) {
      toast.error(t("toast.targetLanguageRequired"));
      return;
    }
    if (!keys.some((key) => key.trim().length > 0)) {
      toast.error(t("toast.apiKeyRequired"));
      return;
    }

    setModel(translationModel);
    setFiles([...files, ...filesToTranslate]);
    setPendingFiles([]);
    setModelPickerOpen(false);
    setModelSearch("");
    setAddDialogOpen(false);
    toast.success(t("toast.tasksAdded", { count: filesToTranslate.length }));
    void startBatchTranslation(filesToTranslate, translationModel);
  };

  const renderStatus = (file: SubtitleFile) => {
    const progress = batchProgress[file.path] || { progress: 0, status: "pending" as const };
    const progressValue = Math.max(0, Math.min(100, progress.progress || 0));
    let detail = t("task.progress.waiting");
    if (progress.status === "analyzing") detail = t("task.progress.analyzing");
    if (progress.status === "translating") {
      detail = progress.currentCue && progress.totalCues
        ? t("task.progress.cue", {
            current: progress.currentCue,
            total: progress.totalCues,
          })
        : t("task.progress.translating");
    }
    if (progress.status === "done") detail = t("task.progress.done");
    if (progress.status === "error") {
      detail = progress.error
        ? t("task.progress.failedSummary")
        : t("task.progress.retry");
    }

    return (
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <Badge variant={getStatusVariant(progress.status)}>
            {progress.status === "translating" && <LoaderCircle className="animate-spin" data-icon="inline-start" />}
            {progress.status === "done" && <CheckCircle2 data-icon="inline-start" />}
            {progress.status === "error" && <AlertCircle data-icon="inline-start" />}
            {statusCopy[progress.status]}
          </Badge>
          <span className="text-xs tabular-nums text-muted-foreground">{progressValue.toFixed(0)}%</span>
        </div>
        <Progress
          value={progressValue}
          aria-label={t("tasks.aria.progress", {
            file: file.name,
            progress: progressValue,
          })}
        />
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </div>
    );
  };

  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col", isDragging && "bg-muted/40")}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        requestAddFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={supportedExtensions.join(",")}
        multiple
        className="hidden"
        onChange={(event) => {
          requestAddFiles(Array.from(event.target.files || []));
          event.currentTarget.value = "";
        }}
      />

      {files.length === 0 ? (
        <Empty className="border-0 px-5 py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="size-14 rounded-2xl [&_svg:not([class*='size-'])]:size-7">
              <FileStack />
            </EmptyMedia>
            <EmptyTitle className="text-2xl">{t("tasks.empty.title")}</EmptyTitle>
            <EmptyDescription className="text-base">{t("tasks.empty.description")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="lg" onClick={() => fileInputRef.current?.click()}>
              <FolderOpen data-icon="inline-start" />
              {t("tasks.empty.chooseFile")}
            </Button>
          </EmptyContent>
          {shouldShowCoffeeBanner && (
            <BuyMeACoffee dismissible className="w-full max-w-2xl" />
          )}
          <p className="mt-auto pt-10 text-center text-xs text-muted-foreground">
            {t("tasks.empty.formats")}
            <br />
            {t("tasks.empty.checkpoint")}
          </p>
        </Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex items-center justify-between border-b px-5 py-2.5 text-xs text-muted-foreground">
            <span>
              {activeCount > 0
                ? t("tasks.queue.active", { count: activeCount })
                : t("tasks.queue.ready")}
            </span>
            <div className="flex items-center gap-3">
              <span>{t("tasks.queue.completed", { count: completedCount })}</span>
              {isTranslating && (
                <Button variant="secondary" size="sm" disabled>
                  <LoaderCircle className="animate-spin" data-icon="inline-start" />
                  {t("tasks.queue.translating")}
                </Button>
              )}
              {completedCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearCompletedFiles}>
                  <Trash2 data-icon="inline-start" />
                  {t("tasks.queue.clearCompleted")}
                </Button>
              )}
            </div>
          </div>
          <div className="min-w-[760px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[320px] px-5">{t("tasks.table.file")}</TableHead>
                  <TableHead className="w-[280px] min-w-[280px] max-w-[280px]">{t("tasks.table.progress")}</TableHead>
                  <TableHead className="hidden min-w-[180px] xl:table-cell">
                    {t("tasks.table.settings")}
                  </TableHead>
                  <TableHead className="w-[220px] px-5 text-right">{t("tasks.table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
              {files.map((file) => {
                const progress = batchProgress[file.path] || { progress: 0, status: "pending" as const };
                return (
                  <TableRow key={file.path}>
                    <TableCell className="min-w-[320px] px-5 py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <FileAudio className="shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate font-medium" title={file.name}>{file.name}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={file.path}>{getParentFolder(file.path, t("task.sourceFolder"))}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="w-[280px] max-w-[280px]">
                      {renderStatus(file)}
                    </TableCell>
                    <TableCell className="hidden min-w-0 xl:table-cell">
                      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                      <span
                        className="truncate font-medium"
                        title={progress.model || model}
                      >
                        {progress.model || model || t("tasks.model.notSet")}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {progress.targetLanguage ||
                          lang ||
                          t("tasks.language.notSet")}
                      </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-5">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void openDetails(file)}
                          aria-label={t("tasks.aria.viewDetails", {
                            file: file.name,
                          })}
                        >
                          <Eye data-icon="inline-start" />
                          {t("tasks.actions.viewDetails")}
                        </Button>
                        {progress.status === "error" && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={
                              isTranslating ||
                              !(progress.model || model).trim()
                            }
                            onClick={() =>
                              void startBatchTranslation(
                                [file],
                                (progress.model || model).trim()
                              )
                            }
                            aria-label={t("tasks.aria.retry", { file: file.name })}
                            title={t("tasks.aria.retry", { file: file.name })}
                          >
                            <RotateCcw />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeFile(file.path)}
                          aria-label={t("tasks.aria.remove", { file: file.name })}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="top-[calc(50%+1.5rem)] grid-rows-[auto_minmax(0,1fr)_auto] max-h-[min(760px,calc(100vh-6rem))] overflow-hidden sm:max-w-4xl">
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl">{t("tasks.dialog.title")}</DialogTitle>
            <DialogDescription className="max-w-2xl">
              {t("tasks.dialog.description")}
            </DialogDescription>
          </DialogHeader>
          <form
            id="add-task-form"
            className="min-h-0 overflow-y-auto"
            onSubmit={(event) => {
              event.preventDefault();
              addPendingTasks();
            }}
          >
            <div className="flex flex-col gap-6 py-2 pr-1">
              <FieldGroup className="grid gap-x-8 gap-y-5 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="task-model">{t("tasks.model.label")}</FieldLabel>
                <Popover
                  open={modelPickerOpen}
                  onOpenChange={handleModelPickerChange}
                >
                  <PopoverTrigger asChild>
                    <Button
                      id="task-model"
                      type="button"
                      variant="outline"
                      className="w-full justify-between font-normal"
                      autoFocus
                    >
                      <span className={cn("truncate", !taskModel && "text-muted-foreground")}>
                        {taskModel || t("tasks.model.choose")}
                      </span>
                      <ChevronDown className="shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0"
                  >
                    <Command shouldFilter={false}>
                      <CommandInput
                        autoFocus
                        value={modelSearch}
                        onValueChange={setModelSearch}
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            hasCustomModelOption &&
                            filteredModels.length === 0
                          ) {
                            event.preventDefault();
                            selectModel(customModelValue);
                          }
                        }}
                        placeholder={t("tasks.model.search")}
                        aria-label={t("tasks.model.search")}
                      />
                      <CommandList>
                        {modelLoadStatus === "loading" && (
                          <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                            <LoaderCircle className="animate-spin" />
                            {t("tasks.model.loading")}
                          </div>
                        )}
                        {modelLoadStatus === "error" && (
                          <div className="px-3 py-3 text-sm text-destructive" role="alert">
                            {t("tasks.model.loadError", { error: modelLoadError })}
                          </div>
                        )}
                        {hasCustomModelOption && (
                          <CommandGroup heading={t("tasks.model.custom")}>
                            <CommandItem
                              value={`custom:${customModelValue}`}
                              onSelect={() => selectModel(customModelValue)}
                            >
                              <Plus />
                              <span className="min-w-0 truncate">
                                {t("tasks.model.useCustom", { model: customModelValue })}
                              </span>
                            </CommandItem>
                          </CommandGroup>
                        )}
                        {filteredModels.length > 0 && (
                          <CommandGroup heading={t("tasks.model.available")}>
                            {filteredModels.map((modelInfo) => (
                              <CommandItem
                                key={modelInfo.id}
                                value={modelInfo.id}
                                onSelect={() => selectModel(modelInfo.id)}
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  {modelInfo.id}
                                </span>
                                {modelInfo.ownedBy && (
                                  <CommandShortcut>{modelInfo.ownedBy}</CommandShortcut>
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                        {modelLoadStatus !== "loading" &&
                          modelLoadStatus !== "error" &&
                          filteredModels.length === 0 &&
                          !hasCustomModelOption && (
                            <CommandEmpty>
                              {modelSearch.trim()
                                ? t("tasks.model.noMatch")
                                : apiKey
                                  ? t("tasks.model.noneAvailable")
                                  : t("tasks.model.apiKeyRequired")}
                            </CommandEmpty>
                          )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <FieldDescription>
                  {!apiKey
                    ? t("tasks.model.helpNoKey")
                    : modelLoadStatus === "loading"
                      ? t("tasks.model.loading")
                      : modelLoadStatus === "error"
                        ? t("tasks.model.loadError", { error: modelLoadError })
                        : modelLoadStatus === "success"
                          ? t("tasks.model.helpSuccess", { count: availableModels.length })
                          : t("tasks.model.helpIdle")}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="task-output-format">
                  {t("tasks.output.label")}
                </FieldLabel>
                <Select value={multiLangSave} onValueChange={(value) => setMultiLangSave(value as TranslationParams["multiLangSave"])}>
                  <SelectTrigger id="task-output-format" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">{t("tasks.output.none")}</SelectItem>
                      <SelectItem value="translate+original">{t("tasks.output.translateOriginal")}</SelectItem>
                      <SelectItem value="original+translate">{t("tasks.output.originalTranslate")}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>{t("tasks.output.description")}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="task-language">{t("tasks.language.label")}</FieldLabel>
                <Input
                  id="task-language"
                  value={lang}
                  onChange={(event) => setLang(event.target.value)}
                  placeholder={t("tasks.language.placeholder")}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="task-output-directory">{t("tasks.output.directory")}</FieldLabel>
                <div className="flex items-center gap-2">
                  <output
                    id="task-output-directory"
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input px-2.5 py-1.5 text-sm text-muted-foreground"
                    title={outputDirectory || t("tasks.output.directoryFallback")}
                  >
                    <FolderOpen className="shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {outputDirectory || t("tasks.output.directoryFallback")}
                    </span>
                  </output>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void chooseOutputDirectory()}
                    disabled={isChoosingOutputDirectory}
                  >
                    <FolderOpen data-icon="inline-start" />
                    {isChoosingOutputDirectory ? t("tasks.output.selecting") : t("tasks.output.select")}
                  </Button>
                </div>
                <FieldDescription>{t("tasks.output.directoryDescription")}</FieldDescription>
              </Field>
            </FieldGroup>
            <Separator />
            <FieldGroup className="grid gap-x-8 gap-y-5 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="task-additional">{t("tasks.additional.label")}</FieldLabel>
                <Textarea
                  id="task-additional"
                  value={additional}
                  onChange={(event) => setAdditional(event.target.value)}
                  placeholder={t("tasks.additional.placeholder")}
                  className="min-h-24 resize-none"
                />
                <FieldDescription>{t("tasks.additional.description")}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="task-context-size">{t("tasks.context.label")}</FieldLabel>
                <Input
                  id="task-context-size"
                  type="number"
                  min="0"
                  max={MAX_CONTEXT_SIZE}
                  step="1"
                  inputMode="numeric"
                  value={normalizedContextSize}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    if (!Number.isFinite(nextValue)) return;
                    setContextSize(
                      Math.min(MAX_CONTEXT_SIZE, Math.max(0, Math.round(nextValue)))
                    );
                  }}
                />
                <FieldDescription>{t("tasks.context.description")}</FieldDescription>
              </Field>
            </FieldGroup>
            <Separator />
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FilePlus2 aria-hidden="true" />
                {t("tasks.output.selectedFiles", { count: pendingFiles.length })}
              </div>
              <ul
                className="flex flex-col gap-1 rounded-lg border bg-muted/20 px-3 py-2 text-sm text-muted-foreground"
                aria-label={t("tasks.output.selectedFiles", { count: pendingFiles.length })}
              >
                {pendingFiles.map((file) => (
                  <li key={file.path} className="shrink-0 truncate py-0.5" title={file.path}>
                    {file.name}
                  </li>
                ))}
              </ul>
            </div>
            </div>
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>{t("cancel")}</Button>
            <Button type="submit" form="add-task-form" disabled={pendingFiles.length === 0 || !lang.trim() || !taskModel.trim()}>
              <FilePlus2 data-icon="inline-start" />
              {t("navigation.addTask")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={detailOpen} onOpenChange={(open) => (open ? setDetailOpen(true) : closeDetails())}>
        <SheetContent side="right" className="w-full gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <SheetHeader className="border-b pr-14">
            <div className="flex items-center gap-2">
              <SheetTitle className="truncate">{t("tasks.details.title")}</SheetTitle>
              {selectedFile && <Badge variant={getStatusVariant(batchProgress[selectedFile.path]?.status || "pending")}>{statusCopy[batchProgress[selectedFile.path]?.status || "pending"]}</Badge>}
            </div>
            <SheetDescription className="truncate" title={selectedFile?.path}>{selectedFile?.name || ""}</SheetDescription>
          </SheetHeader>
          {selectedFile && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex items-end justify-between gap-4 border-b px-5 py-5">
                <div>
                  <p className="text-sm text-muted-foreground">{t("tasks.details.progress")}</p>
                  <p className="mt-1 text-sm font-medium">{statusCopy[batchProgress[selectedFile.path]?.status || "pending"]}</p>
                </div>
                <p className="text-4xl font-semibold tabular-nums">{(batchProgress[selectedFile.path]?.progress || 0).toFixed(0)}%</p>
              </div>
              <div className="px-5 py-5">
                <Progress
                  value={batchProgress[selectedFile.path]?.progress || 0}
                  aria-label={t("tasks.aria.progress", {
                    file: selectedFile.name,
                    progress: batchProgress[selectedFile.path]?.progress || 0,
                  })}
                />
              </div>
              <div className="px-5 pb-5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-2 text-foreground"><span className="size-2 rounded-full bg-primary" />{t("tasks.details.stage.prepare")}</span>
                  <span className="flex items-center gap-2 text-foreground"><span className="size-2 rounded-full bg-primary" />{t("tasks.details.stage.analyze")}</span>
                  <span className="flex items-center gap-2 text-foreground"><span className="size-2 rounded-full bg-primary" />{t("tasks.details.stage.translate")}</span>
                  <span className="flex items-center gap-2"><span className="size-2 rounded-full border" />{t("tasks.details.stage.organize")}</span>
                </div>
              </div>
              {batchProgress[selectedFile.path]?.status === "error" && (
                <section
                  className="border-t px-5 py-5"
                  aria-labelledby="task-error-details-title"
                >
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle aria-hidden="true" />
                    <h3
                      id="task-error-details-title"
                      className="font-medium"
                    >
                      {t("tasks.details.error")}
                    </h3>
                  </div>
                  <ScrollArea className="mt-3 h-40 rounded-lg border bg-muted/20">
                    <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-muted-foreground select-text [overflow-wrap:anywhere]">
                      {getLocalizedError(
                        batchProgress[selectedFile.path]?.error,
                        "toast.unknownError",
                        t
                      )}
                    </pre>
                  </ScrollArea>
                </section>
              )}
              {selectedAnalysis && (
                <div className="border-t px-5 py-5">
                  <p className="font-medium">{t("tasks.details.context")}</p>
                  <MarkdownContent className="mt-2">{selectedAnalysis}</MarkdownContent>
                </div>
              )}
              <div className="border-t">
                <div className="flex items-center justify-between px-5 py-4">
                  <p className="font-medium">{t("tasks.details.transcript")}</p>
                  {previewLoadStatus === "success" && (
                    <Badge variant="outline">
                      {t("tasks.details.cues", { count: cues.length })}
                    </Badge>
                  )}
                </div>
                <div>
                  {previewLoadStatus === "loading" ? (
                    <Empty className="border-t px-5 py-10" aria-live="polite">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <LoaderCircle className="animate-spin" />
                        </EmptyMedia>
                        <EmptyTitle>{t("tasks.details.previewLoading")}</EmptyTitle>
                        <EmptyDescription>
                          {t("tasks.details.previewLoadingDescription")}
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : previewLoadStatus === "error" ? (
                    <Empty className="border-t px-5 py-10">
                      <EmptyHeader role="alert">
                        <EmptyMedia variant="icon">
                          <AlertCircle />
                        </EmptyMedia>
                        <EmptyTitle>{t("tasks.details.previewError")}</EmptyTitle>
                        <EmptyDescription>{previewLoadError}</EmptyDescription>
                      </EmptyHeader>
                      <EmptyContent>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void loadCues(
                              selectedFile.path,
                              true,
                              batchProgress[selectedFile.path]?.outputPath
                            )
                          }
                        >
                          <RotateCcw data-icon="inline-start" />
                          {t("tasks.details.previewRetry")}
                        </Button>
                      </EmptyContent>
                    </Empty>
                  ) : cues.length === 0 ? (
                    <Empty className="border-t px-5 py-10">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <FileAudio />
                        </EmptyMedia>
                        <EmptyTitle>{t("tasks.details.noCues")}</EmptyTitle>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    cues.map((cue, index) => (
                      <div
                        key={`${cue.start}-${index}`}
                        className="border-t px-5 py-3 text-sm leading-6"
                      >
                        <p className="font-mono text-xs tabular-nums text-muted-foreground">
                          {formatCueTimeRange(cue)}
                        </p>
                        <p>{cue.translatedText || cue.text}</p>
                        {cue.translatedText && cue.translatedText !== cue.text && (
                          <p className="mt-1 text-muted-foreground">{cue.text}</p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="flex shrink-0 justify-end gap-2 border-t p-4">
            {selectedFile &&
              batchProgress[selectedFile.path]?.status === "error" && (
                <Button
                  variant="outline"
                  disabled={
                    isTranslating ||
                    !(batchProgress[selectedFile.path]?.model || model).trim()
                  }
                  onClick={() =>
                    void startBatchTranslation(
                      [selectedFile],
                      (
                        batchProgress[selectedFile.path]?.model || model
                      ).trim()
                    )
                  }
                >
                  <RotateCcw data-icon="inline-start" />
                  {t("tasks.details.retry")}
                </Button>
              )}
            <Button variant="outline" onClick={closeDetails}><X data-icon="inline-start" />{t("translate.close")}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
