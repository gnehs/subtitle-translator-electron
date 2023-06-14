import InputField from "@/components/InputField";
import TextareaField from "@/components/TextareaField";
import { useLocalStorage } from "usehooks-ts";
import { useTranslation } from "react-i18next";
import useStep from "../../hooks/useStep";
import TranslatorContainer from "../TranslatorContainer";
export default function File() {
  const { t } = useTranslation();
  const [lang, setLang] = useLocalStorage("translate_lang", "");
  const [additional, setAdditional] = useLocalStorage(
    "translate_additional",
    ""
  );

  const [step] = useStep();
  if (step !== 1) return null;
  return (
    <>
      <TranslatorContainer title={t(`translate.language`)}>
        <InputField
          label={t(`translate.target`)}
          placeholder={t(`translate.target_description`)!}
          value={lang}
          onChange={(e: any) => setLang(e.target.value)}
          required
        />
        <TextareaField
          label={t(`translate.additional`)}
          placeholder={t(`translate.additional_description`)!}
          value={additional}
          onChange={(e: any) => setAdditional(e.target.value)}
          minHeight="200px"
        />
      </TranslatorContainer>
    </>
  );
}
