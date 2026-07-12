import { useEffect, useRef, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { toast } from "sonner";
import useFile from "@/hooks/useFile";
import useModel from "@/hooks/useModel";
import usePrompt from "@/hooks/usePrompt";
import useDelay from "@/hooks/useDelay";
import useRPM from "@/hooks/useRPM";
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
  Partial<Omit<BatchProgress, "progress" | "status">>;

type ModelLoadStatus = "idle" | "loading" | "success" | "error";

type TranslatorPanelProps = {
  addTaskRequest: number;
};

const supportedExtensions = [".ass", ".ssa", ".srt", ".vtt", ".json"];

type Translate = (id: string, values?: Record<string, unknown>) => string;

const translationErrorMessageIds: Record<string, string> = {
  [translationErrorCodes.unsupportedInputFile]: "error.unsupportedInputFile",
  [translationErrorCodes.inputPathNotFile]: "error.inputPathNotFile",
  [translationErrorCodes.unsupportedSubtitleFormat]: "error.unsupportedSubtitleFormat",
  [translationErrorCodes.invalidCheckpoint]: "error.invalidCheckpoint",
  [translationErrorCodes.incompatibleCheckpoint]: "error.incompatibleCheckpoint",
  [translationErrorCodes.noValidApiKeys]: "error.noValidApiKeys",
  [translationErrorCodes.unsupportedFileExtension]: "error.unsupportedFileExtension",
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

export default function TranslatorPanel({ addTaskRequest }: TranslatorPanelProps) {
  const { i18n, t } = useTranslation();
  const [files, setFiles] = useFile();
  const [lang, setLang] = useLocalStorage("translate_lang", "");
  const [additional, setAdditional] = useLocalStorage("translate_additional", "");
  const [model, setModel] = useModel();
  const [prompt] = usePrompt();
  const [delay] = useDelay();
  const [keys] = useAPIKeys();
  const [apiHost] = useAPIHost();
  const [temperature] = useTemperature();
  const apiKey = keys.find((key) => key.trim().length > 0)?.trim() || "";
  const normalizedApiHost = apiHost.trim();
  const [requestsPerMinute] = useRPM();
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
  const [selectedAnalysis, setSelectedAnalysis] = useState<string | undefined>();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [modelLoadStatus, setModelLoadStatus] = useState<ModelLoadStatus>("idle");
  const [modelLoadError, setModelLoadError] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const statusCopy: Record<BatchProgress["status"], string> = {
    pending: t("task.status.pending"),
    analyzing: t("task.status.analyzing"),
    translating: t("task.status.translating"),
    done: t("task.status.done"),
    error: t("task.status.error"),
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastPreviewUpdateRef = useRef(0);
  const handledAddTaskRequestRef = useRef(0);

  useEffect(() => {
    if (!window.electronAPI?.onBatchProgress) return;
    const unsubscribe = window.electronAPI.onBatchProgress((data) => {
      setBatchProgress((previous) => ({
        ...previous,
        [data.filePath]: {
          ...previous[data.filePath],
          ...data,
          analysis: data.analysis ?? previous[data.filePath]?.analysis,
        },
      }));

      const now = Date.now();
      if (
        detailOpen &&
        selectedFile?.path === data.filePath &&
        (data.status === "translating" || data.status === "done") &&
        now - lastPreviewUpdateRef.current > 800
      ) {
        lastPreviewUpdateRef.current = now;
        void loadCues(data.filePath);
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
  }, [detailOpen, i18n.locale, incrementTranslationSuccessCount, selectedFile]);

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
    if (isTranslating) return;
    fileInputRef.current?.click();
  }, [addTaskRequest, isTranslating]);

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
    if (isTranslating) {
      toast.info(t("toast.translationInProgress"));
      return;
    }
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

  const loadCues = async (filePath: string) => {
    try {
      const preview = await window.electronAPI.getSubtitlePreview(filePath);
      setCues(preview.cues);
    } catch (error: unknown) {
      toast.error(getLocalizedError(error, "toast.subtitleLoadFailed", t));
    }
  };

  const openDetails = async (file: SubtitleFile) => {
    setSelectedFile(file);
    setSelectedAnalysis(batchProgress[file.path]?.analysis);
    setDetailOpen(true);
    await loadCues(file.path);
    try {
      const analysis = await window.electronAPI.getAnalysis(file.path);
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
    setDetailOpen(false);
    setSelectedFile(null);
    setSelectedAnalysis(undefined);
    setCues([]);
  };

  const removeFile = (filePath: string) => {
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

    setIsTranslating(true);
    setBatchProgress((previous) => ({
      ...previous,
      ...Object.fromEntries(
        translatableFiles.map((file) => [file.path, { progress: 0, status: "pending" as const }])
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
      setIsTranslating(false);
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
        ? t("task.progress.retryWithError", {
            error: getLocalizedError(progress.error, "toast.unknownError", t),
          })
        : t("task.progress.retry");
    }

    return (
      <div className="flex min-w-44 flex-col gap-1.5">
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
        <span className="truncate text-xs text-muted-foreground" title={detail}>{detail}</span>
      </div>
    );
  };

  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col", isDragging && "bg-muted/40")}
      onDragOver={(event) => {
        event.preventDefault();
        if (!isTranslating) setIsDragging(true);
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
            <BuyMeACoffee dismissible className="w-full max-w-sm" />
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
          <div className="min-w-[900px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[320px] px-5">{t("tasks.table.file")}</TableHead>
                  <TableHead className="min-w-[150px]">{t("tasks.table.status")}</TableHead>
                  <TableHead className="min-w-[260px]">{t("tasks.table.progress")}</TableHead>
                  <TableHead className="min-w-[180px]">{t("tasks.table.settings")}</TableHead>
                  <TableHead className="w-[112px] px-5 text-right">{t("tasks.table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
              {files.map((file) => {
                const progress = batchProgress[file.path] || { progress: 0, status: "pending" as const };
                return (
                  <TableRow
                    key={file.path}
                    tabIndex={0}
                    aria-label={t("tasks.aria.viewDetails", { file: file.name })}
                    className="group cursor-pointer transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none"
                    onClick={() => void openDetails(file)}
                    onKeyDown={(event) => {
                      if (
                        event.target instanceof Element &&
                        event.target.closest("button, a, input, textarea, select")
                      ) {
                        return;
                      }
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      void openDetails(file);
                    }}
                  >
                    <TableCell className="min-w-[320px] px-5 py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <FileAudio className="shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate font-medium" title={file.name}>{file.name}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={file.path}>{getParentFolder(file.path, t("task.sourceFolder"))}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(progress.status)}>{statusCopy[progress.status]}</Badge>
                    </TableCell>
                    <TableCell>{renderStatus(file)}</TableCell>
                    <TableCell className="min-w-0">
                      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                      <span className="truncate font-medium" title={model}>{model || t("tasks.model.notSet")}</span>
                      <span className="truncate text-xs text-muted-foreground">{lang || t("tasks.language.notSet")}</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-5">
                      <div className="flex justify-end gap-1">
                        {progress.status === "error" && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={isTranslating || !model.trim()}
                            onClick={(event) => {
                              event.stopPropagation();
                              void startBatchTranslation([file], model.trim());
                            }}
                            aria-label={t("tasks.aria.retry", { file: file.name })}
                            title={t("tasks.aria.retry", { file: file.name })}
                          >
                            <RotateCcw />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeFile(file.path);
                          }}
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
        <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] sm:max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">{t("tasks.dialog.title")}</DialogTitle>
            <DialogDescription>{t("tasks.dialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 py-2 md:grid-cols-2">
            <FieldGroup>
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
                <FieldLabel htmlFor="task-language">{t("tasks.language.label")}</FieldLabel>
                <Input
                  id="task-language"
                  value={lang}
                  onChange={(event) => setLang(event.target.value)}
                  placeholder={t("tasks.language.placeholder")}
                  autoFocus
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="task-additional">{t("tasks.additional.label")}</FieldLabel>
                <Textarea
                  id="task-additional"
                  value={additional}
                  onChange={(event) => setAdditional(event.target.value)}
                  placeholder={t("tasks.additional.placeholder")}
                  className="min-h-32 resize-none"
                />
                <FieldDescription>{t("tasks.additional.description")}</FieldDescription>
              </Field>
            </FieldGroup>
            <FieldGroup>
              <Field>
                  <FieldLabel>{t("tasks.output.label")}</FieldLabel>
                <Select value={multiLangSave} onValueChange={(value) => setMultiLangSave(value as TranslationParams["multiLangSave"])}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
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
                  <FieldLabel>{t("tasks.output.directory")}</FieldLabel>
                <div className="flex items-center gap-2">
                  <div
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input px-2.5 py-1.5 text-sm text-muted-foreground"
                    title={outputDirectory || t("tasks.output.directoryFallback")}
                  >
                    <FolderOpen className="shrink-0" />
                    <span className="truncate">
                      {outputDirectory || t("tasks.output.directoryFallback")}
                    </span>
                  </div>
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
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="flex items-center gap-2 font-medium">
                  <FilePlus2 />
                  {t("tasks.output.selectedFiles", { count: pendingFiles.length })}
                </div>
                <div className="mt-3 max-h-36 overflow-y-auto text-sm text-muted-foreground">
                  {pendingFiles.map((file) => <p key={file.path} className="truncate py-0.5" title={file.path}>{file.name}</p>)}
                </div>
              </div>
            </FieldGroup>
          </div>
          <Separator />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>{t("cancel")}</Button>
            <Button onClick={addPendingTasks} disabled={pendingFiles.length === 0 || !lang.trim() || !taskModel.trim()}>
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
                <Progress value={batchProgress[selectedFile.path]?.progress || 0} />
              </div>
              <div className="px-5 pb-5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-2 text-foreground"><span className="size-2 rounded-full bg-primary" />{t("tasks.details.stage.prepare")}</span>
                  <span className="flex items-center gap-2 text-foreground"><span className="size-2 rounded-full bg-primary" />{t("tasks.details.stage.analyze")}</span>
                  <span className="flex items-center gap-2 text-foreground"><span className="size-2 rounded-full bg-primary" />{t("tasks.details.stage.translate")}</span>
                  <span className="flex items-center gap-2"><span className="size-2 rounded-full border" />{t("tasks.details.stage.organize")}</span>
                </div>
              </div>
              {selectedAnalysis && (
                <div className="border-t px-5 py-5">
                  <p className="font-medium">{t("tasks.details.context")}</p>
                  <MarkdownContent className="mt-2">{selectedAnalysis}</MarkdownContent>
                </div>
              )}
              <div className="border-t">
                <div className="flex items-center justify-between px-5 py-4">
                  <p className="font-medium">{t("tasks.details.transcript")}</p>
                  <Badge variant="outline">{t("tasks.details.cues", { count: cues.length })}</Badge>
                </div>
                <div>
                  {cues.length === 0 ? (
                    <p className="px-5 pb-6 text-sm text-muted-foreground">{t("tasks.details.noCues")}</p>
                  ) : cues.map((cue, index) => (
                    <div key={`${cue.start}-${index}`} className="border-t px-5 py-3 text-sm leading-6">
                      <p>{cue.translatedText || cue.text}</p>
                      {cue.translatedText && cue.translatedText !== cue.text && <p className="mt-1 text-muted-foreground">{cue.text}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="flex shrink-0 justify-end gap-2 border-t p-4">
            {selectedFile &&
              batchProgress[selectedFile.path]?.status === "error" && (
                <Button
                  variant="outline"
                  disabled={isTranslating || !model.trim()}
                  onClick={() =>
                    void startBatchTranslation([selectedFile], model.trim())
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
