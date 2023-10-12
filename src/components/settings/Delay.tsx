import Title from "../Title";
import { useTranslation } from "react-i18next";
import useDelay from "@/hooks/useDelay";
import InputField from "../InputField";
export default function Language() {
  const [delay, setDelay] = useDelay();
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <Title>{t("delay.title")}</Title>
      <InputField
        label={""}
        type="number"
        value={delay?.toString() || ""}
        onChange={(e: any) => setDelay(e.target.valueAsNumber)}
      />
      <div className="text-sm opacity-80">{t(`delay.description`)}</div>
    </div>
  );
}
