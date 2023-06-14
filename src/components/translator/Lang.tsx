import Button from "../Button";
import InputField from "@/components/InputField";
import TextareaField from "@/components/TextareaField";
import { useLocalStorage } from "usehooks-ts";
import { useTranslation } from "react-i18next";
import useStep from "../../hooks/useStep";
import Title from "../Title";
export default function File() {
  const { t } = useTranslation();
  const [lang, setLang] = useLocalStorage("translate_lang", "");
  const [additional, setAdditional] = useLocalStorage(
    "translate_additional",
    ""
  );

  const [step, nextStep] = useStep();
  if (step !== 1) return null;
  return (
    <>
      <div className="flex flex-col gap-2 items-center justify-center w-full max-w-[368px] mx-auto bg-slate-50 p-2 rounded">
        <Title>{t(`translate.language`)}</Title>
        <div className="w-full p-2 flex flex-col gap-2">
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
        <Button className="w-full" onClick={() => nextStep()}>
          Next
        </Button>
      </div>
    </>
  );
}
