import { useState, useEffect } from "react";
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
import InputField from "../InputField";
import TextareaField from "../TextareaField";
import TranslatorContainer from "../TranslatorContainer";
import Button from "../Button";

interface FileType {
  path: string;
  name: string;
}

interface ProgressType {
  progress: number;
  status: "pending" | "translating" | "done" | "error";
  error?: string;
  totalCues?: number;
  currentCue?: number;
}

export default function TranslatorPanel() {
  const { t } = useTranslation();
  const [files, setFiles] = useFile() as [
    FileType[],
    (files: FileType[]) => void
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
  const [selectedFile, setSelectedFile] = useState<FileType | null>(null);
  const [cues, setCues] = useState<any[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const handleProgress = (event: any, data: any) => {
      setBatchProgress((prev) => ({ ...prev, [data.filePath]: data }));
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
  }, []);

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

  const openModal = async (file: FileType) => {
    setSelectedFile(file);
    try {
      const { cues } = await ipcRenderer.invoke('get-subtitle-preview', file.path);
      setCues(cues);
      setModalOpen(true);
    } catch (e: unknown) {
      const error = e as Error;
      toast.error(`Failed to load content: ${error.message}`);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedFile(null);
    setCues([]);
  };

  const isDisabled = isTranslating;

  return (
    <div>
      <div className="flex flex-row w-full h-full">
        {/* Left Sidebar: Settings */}
        <div className="w-1/3 flex flex-col gap-4">
          <TranslatorContainer title={t(`translate.language`)}>
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
                isDisabled
                  ? () => {}
                  : (e: any) => setAdditional(e.target.value)
              }
              minHeight="200px"
            />
          </TranslatorContainer>
        </div>

        {/* Right Sidebar: File Upload and Batch Progress */}
        <div className="w-2/3 flex flex-col">
          <TranslatorContainer title={t(`translate.file`)}>
            <div className="flex flex-col gap-4 h-full">
              {/* File Upload Area */}
              <div className="flex flex-col gap-1 border-2 border-dashed rounded items-center justify-center relative p-4">
                <i
                  className={`bx ${
                    files.length > 0 ? `bxs-file-blank` : `bx-file-blank`
                  } text-4xl`}
                ></i>
                {!files.length && (
                  <div className="opacity-50 text-sm">
                    {t(`translate.file_description`)}
                  </div>
                )}
                {files.length > 0 && (
                  <div className="text-sm text-center">
                    {files.map((f: FileType, i: number) => (
                      <div key={i}>{f.name}</div>
                    ))}
                  </div>
                )}
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
                              path: f.path,
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
              </div>

              {/* Batch Progress if files are present */}
              {files.length > 0 && (
                <div className="flex-1 overflow-y-scroll flex flex-col gap-1 p-1">
                  {files.map((file: FileType) => {
                    const progressData = batchProgress[file.path] || {
                      progress: 0,
                      status: "pending" as const,
                    };
                    const statusText =
                      progressData.status === "translating" &&
                      progressData.currentCue &&
                      progressData.totalCues
                        ? `Translating cue ${progressData.currentCue} of ${
                            progressData.totalCues
                          } - ${progressData.progress.toFixed(1)}%`
                        : `${
                            progressData.status
                          } - ${progressData.progress.toFixed(1)}%`;
                    return (
                      <div
                        key={file.path}
                        className="flex flex-col gap-2 p-2 border rounded cursor-pointer"
                        onClick={() => openModal(file)}
                      >
                        <div className="text-sm font-bold">{file.name}</div>
                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-slate-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${progressData.progress}%` }}
                            transition={{ duration: 0.5 }}
                          />
                        </div>
                        <div className="text-xs text-slate-500">
                          {statusText}
                        </div>
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

              {/* Overall Progress and Start Button */}
            </div>
          </TranslatorContainer>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 px-2 py-1 w-full">
            <div className="flex-1 w-full h-2">
              <div className="h-full bg-slate-200 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-slate-500"
                  animate={{ width: `${overallProgress.toFixed(1)}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            </div>
            {isTranslating && <div className="text-sm">Translating...</div>}
          </div>
          <div className="flex justify-center">
            <Button
              onClick={isDisabled ? () => {} : startBatchTranslation}
              variant="primary"
              icon="bx-play"
              className={`shadow ${
                isDisabled ? "cursor-not-allowed opacity-50" : ""
              }`}
            >
              Start Batch Translation
            </Button>
          </div>
        </div>
        {/* Modal */}
        {modalOpen && selectedFile && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-4 rounded max-w-4xl max-h-full overflow-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold">{selectedFile.name}</h3>
                <Button onClick={closeModal} icon="bx-x">
                  Close
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-gray-300">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-300 p-2 text-left">Original</th>
                      <th className="border border-gray-300 p-2 text-left">Translated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cues.map((cue: any, index: number) => (
                      <tr key={index}>
                        <td className="border border-gray-300 p-2">{cue.text}</td>
                        <td className="border border-gray-300 p-2">{cue.translatedText || 'Not translated yet'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
