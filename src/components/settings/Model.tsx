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
        label={t("modelName")}
        description={t("modelDescription")}
        value={model}
        onChange={(e: any) => setModel(e.target.value)}
        list="chatgpt-models"
      />
      <datalist id="chatgpt-models">
        <option value="gpt-4-turbo">GPT 4 Turbo</option>
        <option value="gpt-3.5-turbo">GPT 3.5 Turbo</option>
      </datalist>

      <Title>{t("eco.title")}</Title>
      <p>
        {t("eco.description1")}
        <br />
        {t("eco.description2")}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button active={eco} onClick={() => setEco(!eco)}>
          {t("eco.enable")}
        </Button>
        <Button active={!eco} onClick={() => setEco(!eco)}>
          {t("eco.disable")}
        </Button>
      </div>
    </div>
  );
}
