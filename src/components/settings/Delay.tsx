import Title from "../Title";
import { useTranslation } from "react-i18next";
import useDelay from "@/hooks/useDelay";

export default function Delay() {
  const [delay, setDelay] = useDelay();
  const { t } = useTranslation();

  return (
    <div className="bg-white rounded flex justify-between items-center border border-slate-200 p-4 gap-8">
      <div className="flex flex-col">
        <Title>{t("delay.title")}</Title>
        <div className="text-sm text-slate-600">{t(`delay.description`)}</div>
      </div>

      <div className="flex items-center gap-4 w-80 shrink-0">
        <input
          type="number"
          value={delay?.toString() || ""}
          onChange={(e) => setDelay(e.target.valueAsNumber)}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
          placeholder="0"
          min="0"
          step="100"
        />
      </div>
    </div>
  );
}
