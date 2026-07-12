import { useEffect, useRef, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { toast } from "sonner";
import useFile from "@/hooks/useFile";
import useModel from "@/hooks/useModel";
import usePrompt from "@/hooks/usePrompt";
import useDelay from "@/hooks/useDelay";
import { useAPIHost, useAPIKeys, useTemperature } from "@/hooks/useOpenAI";
import { getFilePath } from "@/utils/filePath";
import type {
  AvailableModel,
  BatchProgress,
  SubtitleCuePreview,
  SubtitleFile,
  TranslationParams,
} from "@/types/electron-api";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type FileProgress = Pick<BatchProgress, "progress" | "status"> &
  Partial<Omit<BatchProgress, "progress" | "status">>;

type ModelLoadStatus = "idle" | "loading" | "success" | "error";

type TranslatorPanelProps = {
  addTaskRequest: number;
};

const supportedExtensions = [".ass", ".ssa", ".srt", ".vtt"];

const statusCopy: Record<BatchProgress["status"], string> = {
  pending: "等待中",
  analyzing: "分析中",
  translating: "翻譯中",
  done: "已完成",
  error: "失敗",
};

function getStatusVariant(status: BatchProgress["status"]) {
  if (status === "error") return "destructive" as const;
  if (status === "done") return "outline" as const;
  if (status === "translating" || status === "analyzing") return "default" as const;
  return "secondary" as const;
}

function getParentFolder(filePath: string) {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts.at(-2) || "來源資料夾";
}

export default function TranslatorPanel({ addTaskRequest }: TranslatorPanelProps) {
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
        toast.error(`翻譯失敗：${data.error || data.filePath}`);
      }
      if (data.status === "done") {
        toast.success(`翻譯完成：${data.filePath.split(/[\\/]/).at(-1) || data.filePath}`);
      }
    });

    return unsubscribe;
  }, [detailOpen, selectedFile]);

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
      setModelLoadError("目前環境無法載入模型清單");
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
        setModelLoadError(
          error instanceof Error ? error.message : "無法載入模型清單"
        );
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
        toast.error(error instanceof Error ? error.message : "無法讀取檔案");
      }
    }

    if (rejectedCount > 0) {
      toast.error(`已略過 ${rejectedCount} 個不支援的檔案`);
    }
    return accepted;
  };

  const requestAddFiles = (selectedFiles: File[]) => {
    if (isTranslating) {
      toast.info("翻譯進行中，請稍後再新增任務");
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
      toast.error("目前環境無法選擇輸出資料夾");
      return;
    }

    setIsChoosingOutputDirectory(true);
    try {
      const selectedDirectory = await window.electronAPI.selectDirectory(
        outputDirectory || undefined
      );
      if (selectedDirectory) setOutputDirectory(selectedDirectory);
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "無法選擇輸出資料夾"
      );
    } finally {
      setIsChoosingOutputDirectory(false);
    }
  };

  const loadCues = async (filePath: string) => {
    try {
      const preview = await window.electronAPI.getSubtitlePreview(filePath);
      setCues(preview.cues);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "無法載入字幕內容");
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
    toast.success("任務已移除");
  };

  const clearCompletedFiles = () => {
    if (completedCount === 0) return;
    const remaining = files.filter((file) => batchProgress[file.path]?.status !== "done");
    setFiles(remaining);
    setBatchProgress((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([path]) => remaining.some((file) => file.path === path)))
    );
    toast.success(`已清除 ${completedCount} 個已完成任務`);
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
      toast.error("請先填寫目標語言");
      return;
    }
    if (!keys.some((key) => key.trim().length > 0)) {
      toast.error("請先在設定中加入 API 金鑰");
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
          outputDirectory: outputDirectory || undefined,
        },
      });
    } catch (error: unknown) {
      toast.error(`翻譯工作失敗：${error instanceof Error ? error.message : "未知錯誤"}`);
    } finally {
      setIsTranslating(false);
    }
  };

  const addPendingTasks = () => {
    const filesToTranslate = pendingFiles;
    const translationModel = taskModel.trim();
    if (filesToTranslate.length === 0 || !translationModel) return;
    if (!lang.trim()) {
      toast.error("請先填寫目標語言");
      return;
    }
    if (!keys.some((key) => key.trim().length > 0)) {
      toast.error("請先在設定中加入 API 金鑰");
      return;
    }

    setModel(translationModel);
    setFiles([...files, ...filesToTranslate]);
    setPendingFiles([]);
    setModelPickerOpen(false);
    setModelSearch("");
    setAddDialogOpen(false);
    toast.success(`已加入 ${filesToTranslate.length} 個任務，開始翻譯`);
    void startBatchTranslation(filesToTranslate, translationModel);
  };

  const renderStatus = (file: SubtitleFile) => {
    const progress = batchProgress[file.path] || { progress: 0, status: "pending" as const };
    const progressValue = Math.max(0, Math.min(100, progress.progress || 0));
    let detail = "等待開始";
    if (progress.status === "analyzing") detail = "分析字幕脈絡";
    if (progress.status === "translating") {
      detail = progress.currentCue && progress.totalCues
        ? `第 ${progress.currentCue} / ${progress.totalCues} 段`
        : "翻譯字幕內容";
    }
    if (progress.status === "done") detail = "已輸出翻譯檔案";
    if (progress.status === "error") detail = progress.error || "請重試此任務";

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
        <Progress value={progressValue} aria-label={`${file.name} ${progressValue}%`} />
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
            <EmptyTitle className="text-2xl">尚無任務</EmptyTitle>
            <EmptyDescription className="text-base">新增檔案後會自動排隊。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="lg" onClick={() => fileInputRef.current?.click()}>
              <FolderOpen data-icon="inline-start" />
              拖放或選取檔案
            </Button>
          </EmptyContent>
          <p className="mt-auto pt-10 text-xs text-muted-foreground">支援格式：ass、ssa、srt、vtt</p>
        </Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex items-center justify-between border-b px-5 py-2.5 text-xs text-muted-foreground">
            <span>{activeCount > 0 ? `${activeCount} 個任務正在處理` : "佇列已就緒"}</span>
            <div className="flex items-center gap-3">
              <span>{completedCount} 個已完成</span>
              {isTranslating && (
                <Button variant="secondary" size="sm" disabled>
                  <LoaderCircle className="animate-spin" data-icon="inline-start" />
                  翻譯中
                </Button>
              )}
              {completedCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearCompletedFiles}>
                  <Trash2 data-icon="inline-start" />
                  清除已結束
                </Button>
              )}
            </div>
          </div>
          <div className="min-w-[900px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[320px] px-5">檔案</TableHead>
                  <TableHead className="min-w-[150px]">狀態</TableHead>
                  <TableHead className="min-w-[260px]">進度</TableHead>
                  <TableHead className="min-w-[180px]">設定</TableHead>
                  <TableHead className="w-[72px] px-5 text-right">動作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
              {files.map((file) => {
                const progress = batchProgress[file.path] || { progress: 0, status: "pending" as const };
                return (
                  <TableRow
                    key={file.path}
                    tabIndex={0}
                    aria-label={`查看 ${file.name} 翻譯詳情`}
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
                          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={file.path}>{getParentFolder(file.path)}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(progress.status)}>{statusCopy[progress.status]}</Badge>
                    </TableCell>
                    <TableCell>{renderStatus(file)}</TableCell>
                    <TableCell className="min-w-0">
                      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                      <span className="truncate font-medium" title={model}>{model || "尚未設定模型"}</span>
                      <span className="truncate text-xs text-muted-foreground">{lang || "尚未設定目標語言"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-5">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeFile(file.path);
                          }}
                          aria-label={`移除 ${file.name}`}
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
            <DialogTitle className="text-xl">新增翻譯任務</DialogTitle>
            <DialogDescription>
              設定這批字幕的翻譯方式，確認後會加入任務並自動開始翻譯。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 py-2 md:grid-cols-2">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="task-model">翻譯模型</FieldLabel>
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
                        {taskModel || "選擇或輸入模型"}
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
                        placeholder="搜尋模型或輸入自訂模型 ID"
                        aria-label="搜尋模型或輸入自訂模型 ID"
                      />
                      <CommandList>
                        {modelLoadStatus === "loading" && (
                          <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                            <LoaderCircle className="animate-spin" />
                            正在載入 API 可用模型⋯
                          </div>
                        )}
                        {modelLoadStatus === "error" && (
                          <div className="px-3 py-3 text-sm text-destructive" role="alert">
                            {modelLoadError}；仍可使用自訂模型 ID。
                          </div>
                        )}
                        {hasCustomModelOption && (
                          <CommandGroup heading="自訂模型">
                            <CommandItem
                              value={`custom:${customModelValue}`}
                              onSelect={() => selectModel(customModelValue)}
                            >
                              <Plus />
                              <span className="min-w-0 truncate">
                                使用「{customModelValue}」
                              </span>
                            </CommandItem>
                          </CommandGroup>
                        )}
                        {filteredModels.length > 0 && (
                          <CommandGroup heading="可用模型">
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
                                ? "找不到模型，可以直接使用自訂模型 ID。"
                                : apiKey
                                  ? "目前沒有可用模型。"
                                  : "請先設定 API 金鑰，或輸入自訂模型 ID。"}
                            </CommandEmpty>
                          )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <FieldDescription>
                  {!apiKey
                    ? "請先在設定中加入 API 金鑰，開啟此選單時會自動載入可用模型。"
                    : modelLoadStatus === "loading"
                      ? "正在載入 API 可用模型⋯"
                      : modelLoadStatus === "error"
                        ? `${modelLoadError}；仍可使用自訂模型 ID。`
                        : modelLoadStatus === "success"
                          ? `已載入 ${availableModels.length} 個模型；也可使用自訂模型 ID。`
                          : "開啟此選單時會自動載入可用模型。"}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="task-language">目標語言</FieldLabel>
                <Input
                  id="task-language"
                  value={lang}
                  onChange={(event) => setLang(event.target.value)}
                  placeholder="例如：繁體中文、English、日本語"
                  autoFocus
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="task-additional">翻譯提示</FieldLabel>
                <Textarea
                  id="task-additional"
                  value={additional}
                  onChange={(event) => setAdditional(event.target.value)}
                  placeholder="例如：保留專有名詞，語氣自然。"
                  className="min-h-32 resize-none"
                />
                <FieldDescription>這段提示會套用到本批任務。</FieldDescription>
              </Field>
            </FieldGroup>
            <FieldGroup>
              <Field>
                <FieldLabel>輸出格式</FieldLabel>
                <Select value={multiLangSave} onValueChange={(value) => setMultiLangSave(value as TranslationParams["multiLangSave"])}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">僅輸出翻譯字幕</SelectItem>
                    <SelectItem value="translate+original">翻譯字幕 + 原文字幕</SelectItem>
                    <SelectItem value="original+translate">原文字幕 + 翻譯字幕</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>這個選項會套用到本批任務。</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>輸出資料夾</FieldLabel>
                <div className="flex items-center gap-2">
                  <div
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input px-2.5 py-1.5 text-sm text-muted-foreground"
                    title={outputDirectory || "與來源字幕檔案相同的資料夾"}
                  >
                    <FolderOpen className="shrink-0" />
                    <span className="truncate">
                      {outputDirectory || "與來源字幕檔案相同的資料夾"}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void chooseOutputDirectory()}
                    disabled={isChoosingOutputDirectory}
                  >
                    <FolderOpen data-icon="inline-start" />
                    {isChoosingOutputDirectory ? "選擇中" : "選擇"}
                  </Button>
                </div>
                <FieldDescription>未選擇時會輸出到來源字幕檔案所在資料夾。</FieldDescription>
              </Field>
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="flex items-center gap-2 font-medium">
                  <FilePlus2 />
                  已選取 {pendingFiles.length} 個檔案
                </div>
                <div className="mt-3 max-h-36 overflow-y-auto text-sm text-muted-foreground">
                  {pendingFiles.map((file) => <p key={file.path} className="truncate py-0.5" title={file.path}>{file.name}</p>)}
                </div>
              </div>
            </FieldGroup>
          </div>
          <Separator />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>取消</Button>
            <Button onClick={addPendingTasks} disabled={pendingFiles.length === 0 || !lang.trim() || !taskModel.trim()}>
              <FilePlus2 data-icon="inline-start" />
              新增任務
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={detailOpen} onOpenChange={(open) => (open ? setDetailOpen(true) : closeDetails())}>
        <SheetContent side="right" className="w-full gap-0 overflow-hidden p-0 sm:max-w-xl">
          <SheetHeader className="border-b pr-14">
            <div className="flex items-center gap-2">
              <SheetTitle className="truncate">任務詳情</SheetTitle>
              {selectedFile && <Badge variant={getStatusVariant(batchProgress[selectedFile.path]?.status || "pending")}>{statusCopy[batchProgress[selectedFile.path]?.status || "pending"]}</Badge>}
            </div>
            <SheetDescription className="truncate" title={selectedFile?.path}>{selectedFile?.name || ""}</SheetDescription>
          </SheetHeader>
          {selectedFile && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex items-end justify-between gap-4 border-b px-5 py-5">
                <div>
                  <p className="text-sm text-muted-foreground">目前進度</p>
                  <p className="mt-1 text-sm font-medium">{statusCopy[batchProgress[selectedFile.path]?.status || "pending"]}</p>
                </div>
                <p className="text-4xl font-semibold tabular-nums">{(batchProgress[selectedFile.path]?.progress || 0).toFixed(0)}%</p>
              </div>
              <div className="px-5 py-5">
                <Progress value={batchProgress[selectedFile.path]?.progress || 0} />
              </div>
              <div className="px-5 pb-5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-2 text-foreground"><span className="size-2 rounded-full bg-primary" />準備</span>
                  <span className="flex items-center gap-2 text-foreground"><span className="size-2 rounded-full bg-primary" />分析</span>
                  <span className="flex items-center gap-2 text-foreground"><span className="size-2 rounded-full bg-primary" />翻譯</span>
                  <span className="flex items-center gap-2"><span className="size-2 rounded-full border" />整理</span>
                </div>
              </div>
              {selectedAnalysis && (
                <div className="border-t px-5 py-5">
                  <p className="font-medium">內容脈絡</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{selectedAnalysis}</p>
                </div>
              )}
              <div className="border-t">
                <div className="flex items-center justify-between px-5 py-4">
                  <p className="font-medium">即時逐字稿</p>
                  <Badge variant="outline">{cues.length} 段</Badge>
                </div>
                <div>
                  {cues.length === 0 ? (
                    <p className="px-5 pb-6 text-sm text-muted-foreground">尚未載入字幕內容。</p>
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
          <div className="flex shrink-0 justify-end border-t p-4">
            <Button variant="outline" onClick={closeDetails}><X data-icon="inline-start" />關閉</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
