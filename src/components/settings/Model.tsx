import Title from "../Title";
import Button from "../Button";
import { useTranslation } from "react-i18next";
import useModel from "../../hooks/useModel";
import modelList from "../../model/list";
import InputField from "../InputField";
import { useEconomy, useTemperature } from "../../hooks/useOpenAI";
export default function Language() {
  const { t } = useTranslation();
  const [model, setModel] = useModel();
  const [eco, setEco] = useEconomy();
  const [temperature, setTemperature] = useTemperature();
  return (
    <div className="flex flex-col gap-8">
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
      </div>
      <div className="flex flex-col gap-2">
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
      </div>{" "}
      <div className="flex flex-col gap-2">
        <Title>{t("temperature.title")}</Title>

        <p>{t("temperature.description")}</p>
        <div className="flex items-center gap-2">
          <input
            className="grow"
            type="range"
            min="0"
            max="2"
            step="0.01"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
          />
          <InputField
            value={temperature}
            className="w-20"
            onChange={(e: any) => setTemperature(e.target.value)}
            type="number"
            label=""
            step={0.01}
          />
        </div>
      </div>{" "}
    </div>
  );
}
