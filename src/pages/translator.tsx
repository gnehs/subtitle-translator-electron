import Header from "@/components/Header";
import InputField from "@/components/InputField";
import TextareaField from "@/components/TextareaField";
import { useLocalStorage } from "usehooks-ts";
import { useTranslation } from "react-i18next";
export default function Translator() {
  const { t } = useTranslation();
  const [lang, setLang] = useLocalStorage("translate_lang", "");
  const [additional, setAdditional] = useLocalStorage(
    "translate_additional",
    ""
  );
  return (
    <div className="flex flex-col h-full">
      <Header>Subtitle Translator</Header>
      <div className="flex flex-row h-full">
        <div className="w-[280px] h-full bg-gray-200 p-2 flex flex-col gap-2">
          <InputField
            label={t(`translate.target`)}
            placeholder={t(`translate.target_description`)!}
            value={lang}
            onChange={(e: any) => setLang(e.target.value)}
          />
          <TextareaField
            label={t(`translate.additional`)}
            placeholder={t(`translate.additional_description`)!}
            value={additional}
            onChange={(e: any) => setAdditional(e.target.value)}
            minHeight="200px"
          />
        </div>
        <div className="flex-1 h-full bg-gray-100"></div>
      </div>
    </div>
  );
}
