import Title from "../Title";
import TextareaField from "../TextareaField";
import { useTranslation } from "react-i18next";
import usePrompt from "../../hooks/usePrompt";
export default function Prompt() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = usePrompt();
  return (
    <div className="flex flex-col gap-2">
      <Title>{t(`prompt.title`)}</Title>
      <TextareaField
        label={t(`prompt.name`)}
        description={t(`prompt.description`)!}
        value={prompt}
        onChange={(e: any) => setPrompt(e.target.value)}
      />
    </div>
  );
}
