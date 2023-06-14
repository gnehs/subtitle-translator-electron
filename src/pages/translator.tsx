import Header from "@/components/Header";
import InputField from "@/components/InputField";
import TextareaField from "@/components/TextareaField";
import { useLocalStorage } from "usehooks-ts";
import { useTranslation } from "react-i18next";
import File from "@/components/translator/File";
import Lang from "@/components/translator/Lang";
import Preview from "@/components/translator/Preview";

import useStep from "@/hooks/useStep";
export default function Translator() {
  const [step] = useStep();
  return (
    <div className="flex flex-col h-full">
      <Header>Subtitle Translator {step}</Header>
      <div className="flex flex-row h-full items-center justify-center">
        <File />
        <Lang />
        <Preview />
      </div>
    </div>
  );
}
