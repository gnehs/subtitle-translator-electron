import Title from "../Title";
import Button from "../Button";
import { useTranslation } from "react-i18next";
import useModel from "../../hooks/useModel";
import modelList from "../../model/list";
import InputField from "../InputField";
import { useEconomy } from "../../hooks/useOpenAI";
export default function Language() {
  const { t } = useTranslation();
  const [model, setModel] = useModel();
  const [eco, setEco] = useEconomy();
  return (
    <div className="flex flex-col gap-2">
      <Title>{t("model")}</Title>

      <InputField
        label={t("model")}
        description={"Select a model or enter a custom model."}
        value={model}
        onChange={(e: any) => setModel(e.target.value)}
        list="chatgpt-models"
      />
      <datalist id="chatgpt-models">
        <option value="gpt-4-turbo">GPT 4 Turbo</option>
        <option value="gpt-3.5-turbo">GPT 3.5 Turbo</option>
      </datalist>

      <Title>Economy Mode</Title>
      <p>
        Economy is a mode that reduces the cost of the API request by using
        sentence-by-sentence translation without providing context may result in
        a decrease in translation quality. <br />* In old versions, this was
        called "Single sentence GPT-4" or "Single sentence GPT-3".
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button active={eco} onClick={() => setEco(!eco)}>
          Enable
        </Button>
        <Button active={!eco} onClick={() => setEco(!eco)}>
          Disable (Recommended)
        </Button>
      </div>
    </div>
  );
}
