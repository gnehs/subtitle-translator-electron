import Button from "../Button";
import useFile from "@/hooks/useFile";
import { useTranslation } from "react-i18next";
import TranslatorContainer from "../TranslatorContainer";
import useStep from "@/hooks/useStep";
export default function File() {
  const { t } = useTranslation();
  const [step] = useStep();
  const [file, setFile] = useFile();
  if (step !== 2) return null;
  return (
    <TranslatorContainer title={t(`translate.file`)}>
      <div className="flex flex-col gap-1 h-[256px] border-2 border-dashed rounded items-center justify-center relative">
        <i
          className={`bx ${file ? `bxs-file-blank` : `bx-file-blank`} text-4xl`}
        ></i>
        {!file && (
          <div className="opacity-50 text-sm">
            {t(`translate.file_description`)}
          </div>
        )}
        {file && <div className="text-sm text-center">{file.name}</div>}
        <input
          type="file"
          className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
          onChange={(e) => {
            console.log(e.target.files);
            if (e.target.files) setFile(e.target.files[0]);
          }}
          required={!file}
          accept=".ass,.srt,.vtt,.saa"
        />
      </div>
    </TranslatorContainer>
  );
}
