import Button from "../Button";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import useStep from "@/hooks/useStep";
import useFile from "@/hooks/useFile";
import { ipcRenderer } from "electron";
import { useLocalStorage } from "usehooks-ts";
import useModel from "@/hooks/useModel";
import usePrompt from "@/hooks/usePrompt";
import useDelay from "@/hooks/useDelay";
import { useAPIKeys, useAPIHost, useAPIHeaders, useEconomy, useCompatibility, useTemperature } from "@/hooks/useOpenAI";
import { motion } from "framer-motion";
import { toast } from "react-toastify";

export default function BatchPreview() {
  const [step, nextStep, previousStep] = useStep();
  const [files] = useFile();
  const [lang] = useLocalStorage("translate_lang", "");
  const [additional] = useLocalStorage("translate_additional", "");
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
  const [batchProgress, setBatchProgress] = useState<Record<string, {progress: number, status: 'pending' | 'translating' | 'done' | 'error', error?: string}>>({});
  const [isTranslating, setIsTranslating] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    const handleProgress = (event: any, data: any) => {
      setBatchProgress(prev => ({ ...prev, [data.filePath]: data }));
      if (data.status === 'error') {
        toast.error(`Translation error for ${data.filePath}: ${data.error}`);
      }
      if (data.status === 'done') {
        toast.success(`Translation completed for ${data.filePath}`);
      }
    };

    ipcRenderer.on('batch-progress', handleProgress);

    return () => {
      ipcRenderer.removeListener('batch-progress', handleProgress);
    };
  }, []);

  const overallProgress = Object.values(batchProgress).reduce((acc, curr) => acc + curr.progress, 0) / (files.length || 1);

  const startBatchTranslation = async () => {
    if (files.length === 0 || keys.filter(k => k.length > 0).length === 0) {
      toast.error("No API keys configured");
      return;
    }
    setIsTranslating(true);
    setBatchProgress(files.reduce((acc, f) => ({ ...acc, [f.path]: {progress: 0, status: 'pending'} }), {}));
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
      eco
    };
    try {
      await ipcRenderer.invoke('batch-translate', { files, params });
      setIsTranslating(false);
    } catch (e) {
      toast.error(`Batch translation failed: ${e.message}`);
      setIsTranslating(false);
    }
  };

  if (step !== 3) return null;

  return (
    <>
      <div className="flex flex-col w-full h-full">
        <div className="flex-1 overflow-y-scroll h-full flex flex-col gap-1 p-1">
          {files.map((file) => {
            const progressData = batchProgress[file.path] || {progress: 0, status: 'pending'};
            return (
              <div key={file.path} className="flex flex-col gap-2 p-2 border rounded">
                <div className="text-sm font-bold">{file.name}</div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-slate-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${progressData.progress}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                <div className="text-xs text-slate-500">{progressData.status} - {progressData.progress}%</div>
                {progressData.error && <div className="text-xs text-red-500">{progressData.error}</div>}
              </div>
            );
          })}
        </div>
        <div className="absolute bottom-0 left-0 w-full">
          <div className="flex items-center gap-2 px-2 py-1 w-full">
            <Button onClick={() => previousStep()} className="shadow">
              {t(`translate.back`)}
            </Button>
            <div className="flex-1 w-full h-2">
              <div className="h-full bg-slate-200 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-slate-500"
                  animate={{ width: `${overallProgress}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            </div>
            {!isTranslating && files.length > 0 && (
              <Button
                onClick={startBatchTranslation}
                variant="primary"
                icon="bx-play"
                className="shadow"
              >
                Start Batch Translation
              </Button>
            )}
            {isTranslating && <div className="text-sm">Translating...</div>}
          </div>
        </div>
      </div>
    </>
  );
}