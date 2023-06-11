import Title from "../Title";
import TextareaField from "../TextareaField";
import { useTranslation } from "react-i18next";
import usePrompt from "../../hooks/usePrompt";
import useModel from "../../hooks/useModel";
import modelList from "../../model/list";
function PromptField({ model }: { model: string }) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = usePrompt(model);
  return (
    <TextareaField
      label={t(`prompt.name`, { name: t(`models.${model}.name`)! })}
      description={t(`prompt.description`)!}
      value={prompt}
      onChange={(e: any) => setPrompt(e.target.value)}
    />
  );
}
export default function Prompt() {
  const { t } = useTranslation();
  const [model] = useModel();
  return (
    <div className="flex flex-col gap-2">
      <Title>{t(`prompt.title`)}</Title>
      {modelList.map(
        (modelId) => model === modelId && <PromptField model={modelId} />
      )}
    </div>
  );
}
