import { useTranslation } from "react-i18next";
import TranslatorContainer from "../TranslatorContainer";
import useFile from "@/hooks/useFile";
import useStep from "@/hooks/useStep";
export default function File() {
  const { t } = useTranslation();
  const [step] = useStep();
  const [files, setFiles] = useFile();
  if (step !== 2) return null;
  return (
    <TranslatorContainer title={t(`translate.file`)}>
      <div className="flex flex-col gap-1 h-[256px] border-2 border-dashed rounded items-center justify-center relative p-4">
        <i
          className={`bx ${files.length > 0 ? `bxs-file-blank` : `bx-file-blank`} text-4xl`}
        ></i>
        {!files.length && (
          <div className="opacity-50 text-sm">
            {t(`translate.file_description`)}
          </div>
        )}
        {files.length > 0 && (
          <div className="text-sm text-center">
            {files.map((f, i) => (
              <div key={i}>{f.name}</div>
            ))}
          </div>
        )}
        <input
          type="file"
          multiple
          className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
          onChange={(e) => {
            if (e.target.files) {
              const fileArray = Array.from(e.target.files).map(f => ({ path: f.path, name: f.name }));
              setFiles(fileArray);
            }
          }}
          accept=".ass,.srt,.vtt,.saa"
        />
        <input
          className="hidden"
          value={files.map(f => f.path).join(',')}
          required
          onChange={() => {}}
        />
      </div>
    </TranslatorContainer>
  );
}
