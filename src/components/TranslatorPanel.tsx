import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import useFile from "@/hooks/useFile";
import { ipcRenderer } from "electron";
import { useLocalStorage } from "usehooks-ts";
import useModel from "@/hooks/useModel";
import usePrompt from "@/hooks/usePrompt";
import useDelay from "@/hooks/useDelay";
import {
  useAPIKeys,
  useAPIHost,
  useAPIHeaders,
  useEconomy,
  useCompatibility,
  useTemperature,
} from "@/hooks/useOpenAI";
import { motion } from "framer-motion";
import { toast } from "react-toastify";
import InputField from "@/components/InputField";
import TextareaField from "@/components/TextareaField";
import Button from "@/components/Button";
import { getFilePath } from "@/utils/filePath";

interface FileType {
  path: string;
  name: string;
}

interface ProgressType {
  progress: number;
  status: "pending" | "analyzing" | "translating" | "done" | "error";
  error?: string;
  totalCues?: number;
  currentCue?: number;
  analysis?: {
    plotSummary: string;
    glossary: {
      term: string;
      category?: string;
      description: string;
      preferredTranslation?: string;
      notes?: string;
    }[];
  };
}

export default function TranslatorPanel() {
  const { t } = useTranslation();
  const [files, setFiles] = useFile() as [
    { path: string; name: string }[],
    (files: { path: string; name: string }[]) => void
  ];
  const [lang, setLang] = useLocalStorage("translate_lang", "");
  const [additional, setAdditional] = useLocalStorage(
    "translate_additional",
    ""
  );
  const [model] = useModel();
  const [prompt] = usePrompt();
  const [delay] = useDelay();
  const [keys] = useAPIKeys();
  const [apiHost] = useAPIHost();
  const [apiHeaders] = useAPIHeaders();
  const [temperature] = useTemperature();
  const [eco] = useEconomy();
  const [compatibility] = useCompatibility();
  const [multiLangSave] = useLocalStorage("multi_language_save", "none");
  const [batchProgress, setBatchProgress] = useState<
    Record<string, ProgressType>
  >({});
  const [isTranslating, setIsTranslating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileType | null>(null);
  const [cues, setCues] = useState<any[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  // throttle live preview reload
  const lastPreviewUpdateRef = useRef<number>(0);

  useEffect(() => {
    const handleProgress = (event: any, data: any) => {
      setBatchProgress((prev) => {
        const prevFile = prev[data.filePath] || {};
        const merged: ProgressType = {
          ...prevFile,
          ...data,
          analysis: data.analysis ?? (prevFile as any).analysis,
        } as ProgressType;
        return { ...prev, [data.filePath]: merged };
      });

      // Live update cues in modal during translating/done with throttling
      const now = Date.now();
      const shouldUpdatePreview =
        modalOpen &&
        selectedFile &&
        selectedFile.path === data.filePath &&
        (data.status === "translating" || data.status === "done") &&
        now - lastPreviewUpdateRef.current > 800;

      if (shouldUpdatePreview) {
        lastPreviewUpdateRef.current = now;
        // fire and forget
        loadCues(data.filePath).catch(() => {});
      }

      if (data.status === "error") {
        toast.error(`Translation error for ${data.filePath}: ${data.error}`);
      }
      if (data.status === "done") {
        toast.success(`Translation completed for ${data.filePath}`);
      }
    };

    ipcRenderer.on("batch-progress", handleProgress);

    return () => {
      ipcRenderer.removeListener("batch-progress", handleProgress);
    };
  }, [modalOpen, selectedFile]);

  const overallProgress =
    Object.values(batchProgress).reduce(
      (acc: number, curr: ProgressType) => acc + curr.progress,
      0
    ) / (files.length || 1);

  const startBatchTranslation = async () => {
    if (
      files.length === 0 ||
      keys.filter((k: string) => k.length > 0).length === 0
    ) {
      toast.error("No API keys configured");
      return;
    }
    setIsTranslating(true);
    setBatchProgress(
      files.reduce<Record<string, ProgressType>>(
        (acc, f) => ({
          ...acc,
          [f.path]: { progress: 0, status: "pending" as const },
        }),
        {}
      )
    );
    const params = {
      apiKeys: keys,
      apiHost,
      apiHeaders,
      model,
      prompt,
      lang,
      additional,
      temperature,
      compatibility,
      multiLangSave,
      delay: delay * 1000,
      eco,
    };
    try {
      await ipcRenderer.invoke("batch-translate", { files, params });
      setIsTranslating(false);
    } catch (e: unknown) {
      const error = e as Error;
      toast.error(`Batch translation failed: ${error.message}`);
      setIsTranslating(false);
    }
  };

  const loadCues = async (filePath: string) => {
    try {
      const { cues } = await ipcRenderer.invoke(
        "get-subtitle-preview",
        filePath
      );
      setCues(cues);
    } catch (e: unknown) {
      const error = e as Error;
      toast.error(`Failed to load content: ${error.message}`);
    }
  };

  const openModal = async (file: FileType) => {
    setSelectedFile(file);
    await loadCues(file.path);
    // Ensure analysis is available even if the renderer missed the progress event
    try {
      const analysis = await ipcRenderer.invoke("get-analysis", file.path);
      if (analysis) {
        setBatchProgress((prev) => {
          const prevFile = prev[file.path] || {
            progress: 0,
            status: "pending" as const,
          };
          const merged: ProgressType = {
            ...prevFile,
            analysis,
          } as ProgressType;
          return { ...prev, [file.path]: merged };
        });
      }
    } catch (e) {
      // ignore fetch analysis errors
    }
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedFile(null);
    setCues([]);
  };

  const clearCompletedFiles = () => {
    const completedFiles = files.filter((file) => {
      const progress = batchProgress[file.path];
      return progress && progress.status === "done";
    });

    if (completedFiles.length === 0) {
      toast.info(t("translate.no_completed_files"));
      return;
    }

    const newFiles = files.filter((file) => {
      const progress = batchProgress[file.path];
      return !progress || progress.status !== "done";
    });

    setFiles(newFiles);

    const newBatchProgress = Object.fromEntries(
      Object.entries(batchProgress).filter(([path]) =>
        newFiles.some((f) => f.path === path)
      )
    );

    setBatchProgress(newBatchProgress);

    toast.success(
      t("translate.cleared_files", { count: completedFiles.length })
    );
  };

  const removeFile = (filePath: string) => {
    const newFiles = files.filter((f) => f.path !== filePath);
    setFiles(newFiles);

    const newBatchProgress = Object.fromEntries(
      Object.entries(batchProgress).filter(([path]) => path !== filePath)
    );
    setBatchProgress(newBatchProgress);

    toast.success(t("translate.file_removed"));
  };

  useEffect(() => {
    if (selectedFile && modalOpen) {
      const progress = batchProgress[selectedFile.path];
      if (progress && progress.status === "done") {
        loadCues(selectedFile.path);
      }
    }
  }, [batchProgress, selectedFile, modalOpen]);

  const isDisabled = isTranslating;
  const selectedAnalysis = selectedFile
    ? batchProgress[selectedFile.path]?.analysis
    : undefined;

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex flex-row w-full flex-1">
        {/* Left Sidebar: Settings */}
        <div className="w-2/5 flex flex-col gap-4 p-2 border-r border-slate-200 h-full">
          <InputField
            label={t(`translate.target`)}
            placeholder={t(`translate.target_description`)!}
            value={lang}
            onChange={
              isDisabled ? () => {} : (e: any) => setLang(e.target.value)
            }
            required
            className={isDisabled ? "cursor-not-allowed opacity-50" : ""}
          />
          <TextareaField
            label={t(`translate.additional`)}
            placeholder={t(`translate.additional_description`)!}
            value={additional}
            onChange={
              isDisabled ? () => {} : (e: any) => setAdditional(e.target.value)
            }
            minHeight="200px"
          />
          <div className="flex-1" />
          {/* Overall Progress and Start Button */}
          <Button
            onClick={isDisabled ? () => {} : startBatchTranslation}
            variant="primary"
            icon="bx-play"
            className={`shadow ${
              isDisabled ? "cursor-not-allowed opacity-50" : ""
            }`}
          >
            {isTranslating ? t("translate.translating") : t("translate.start")}
          </Button>
        </div>

        {/* Right Sidebar: File Upload and Batch Progress */}
        <div className="w-3/5 flex flex-col gap-4 p-2 h-[calc(100vh-61px)]">
          {/* File Upload Area */}
          <motion.div
            className="flex flex-col gap-1 border-2 border-dashed rounded items-center justify-center relative p-4 cursor-pointer"
            animate={{
              scale: isDragging ? 1.01 : 1,
              borderColor: isDragging ? "#3b82f6" : "#d1d5db",
              backgroundColor: isDragging
                ? "rgba(59, 130, 246, 0.1)"
                : "transparent",
            }}
            transition={{ duration: 0.2 }}
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={() => setIsDragging(true)}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (!isDisabled && e.dataTransfer.files) {
                const fileArray = Array.from(e.dataTransfer.files)
                  .filter((f: File) =>
                    [".ass", ".srt", ".vtt", ".saa"].some((ext) =>
                      f.name.toLowerCase().endsWith(ext)
                    )
                  )
                  .map((f: File) => ({
                    path: getFilePath(f),
                    name: f.name,
                  }));
                setFiles(fileArray);
              }
            }}
          >
            <i
              className={`bx ${
                files.length > 0
                  ? `bxs-file-blank`
                  : `bx-file-blank opacity-50 `
              } text-4xl`}
            ></i>

            <div className="opacity-50 text-sm">
              {t(`translate.file_description`)}
            </div>
            <input
              type="file"
              multiple
              className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
              onChange={
                isDisabled
                  ? () => {}
                  : (e) => {
                      if (e.target.files) {
                        const fileArray = Array.from(
                          e.target.files as FileList
                        ).map((f: File) => ({
                          path: getFilePath(f),
                          name: f.name,
                        }));
                        setFiles(fileArray);
                      }
                    }
              }
              accept=".ass,.srt,.vtt,.saa"
              disabled={isDisabled}
            />
            <input
              className="hidden"
              value={files.map((f: FileType) => f.path).join(",")}
              required
              onChange={() => {}}
            />
          </motion.div>

          <div className="flex-1 h-full overflow-y-auto">
            {files.length > 0 && (
              <div className="flex justify-end">
                <Button
                  onClick={clearCompletedFiles}
                  variant="secondary"
                  icon="bx-trash"
                  className="text-sm"
                >
                  {t("translate.clear_completed")}
                </Button>
              </div>
            )}
            {/* Batch Progress if files are present */}
            {files.length > 0 && (
              <div className="flex-1 overflow-y-scroll flex flex-col gap-1 p-1">
                {files.map((file: FileType) => {
                  const progressData = batchProgress[file.path] || {
                    progress: 0,
                    status: "pending" as const,
                  };
                  let statusText = "";
                  if (
                    progressData.status === "translating" &&
                    progressData.currentCue &&
                    progressData.totalCues
                  ) {
                    statusText = `Translating cue ${
                      progressData.currentCue
                    } of ${
                      progressData.totalCues
                    } - ${progressData.progress.toFixed(1)}%`;
                  } else if (progressData.status === "analyzing") {
                    statusText = `${t(
                      "translate.analyzing_context"
                    )} - ${progressData.progress.toFixed(1)}%`;
                  } else {
                    statusText = `${
                      progressData.status
                    } - ${progressData.progress.toFixed(1)}%`;
                  }
                  return (
                    <div
                      key={file.path}
                      className="flex flex-col gap-2 p-2 border rounded cursor-pointer group"
                      onClick={() => openModal(file)}
                    >
                      <div className="flex justify-between items-center">
                        <div className="text-sm font-bold">{file.name}</div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(file.path);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 text-sm"
                          title="Remove file"
                        >
                          <i className="bx bx-trash"></i>
                        </button>
                      </div>
                      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-slate-500"
                          initial={{ width: 0 }}
                          animate={{ width: `${progressData.progress}%` }}
                          transition={{ duration: 0.5 }}
                        />
                      </div>
                      <div className="text-xs text-slate-500">{statusText}</div>
                      {progressData.error && (
                        <div className="text-xs text-red-500">
                          {progressData.error}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-slate-200 border-t border-slate-200 overflow-hidden h-2">
        <motion.div
          className="h-full bg-slate-500"
          animate={{ width: `${overallProgress.toFixed(1)}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
      {/* Modal */}
      {modalOpen && selectedFile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="p-4 h-full">
            <div className="bg-white p-4 rounded max-w-4xl  h-full overflow-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold">{selectedFile.name}</h3>
                <Button onClick={closeModal} icon="bx-x" className="shrink-0">
                  {t("translate.close")}
                </Button>
              </div>
              <div className="overflow-x-auto">
                {selectedAnalysis && (
                  <div className="mb-4">
                    <div className="mb-2">
                      <div className="text-md font-semibold">
                        {t("translate.context.title")}
                      </div>
                      <div className="mt-1">
                        <div className="font-medium">
                          {t("translate.context.plot_summary")}
                        </div>
                        <p className="text-sm whitespace-pre-wrap">
                          {selectedAnalysis.plotSummary}
                        </p>
                      </div>
                      <div className="mt-2">
                        <div className="font-medium">
                          {t("translate.context.glossary")}
                        </div>
                        <ul className="text-sm list-disc pl-5">
                          {selectedAnalysis.glossary?.map(
                            (g: any, idx: number) => (
                              <li key={idx}>
                                <span className="font-semibold">{g.term}</span>
                                {g.preferredTranslation
                                  ? ` (${g.preferredTranslation})`
                                  : ""}
                                {g.category ? ` [${g.category}]` : ""}:{" "}
                                {g.description}
                                {g.notes ? ` (${g.notes})` : ""}
                              </li>
                            )
                          )}
                        </ul>
                      </div>
                    </div>
                    <hr className="my-2" />
                  </div>
                )}
                {cues.map((cue: any, index: number) => (
                  <div
                    key={index}
                    className="border border-gray-300 p-1 px-2 mb-1 rounded"
                  >
                    <div>{cue.text}</div>
                    <div className="text-sm opacity-75">
                      {cue.translatedText || t("translate.not_translated_yet")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
