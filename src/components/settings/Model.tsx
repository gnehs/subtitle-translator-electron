import Title from "../Title";
import Button from "../Button";
import { useTranslation } from "react-i18next";
import useModel from "../../hooks/useModel";
import modelList from "../../model/list";
import InputField from "../InputField";
import { useEffect, useMemo, useState } from "react";
import { useAPIHost, useAPIKeys, useAPIHeaders } from "@/hooks/useOpenAI";
import {
  useEconomy,
  useTemperature,
  useCompatibility,
} from "../../hooks/useOpenAI";
export default function Language() {
  const { t } = useTranslation();
  const [model, setModel] = useModel();
  const [eco, setEco] = useEconomy();
  const [temperature, setTemperature] = useTemperature();
  const [compatibility, setCompatibility] = useCompatibility();
  const [host] = useAPIHost();
  const [keys] = useAPIKeys();
  const [headers] = useAPIHeaders();
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const baseUrl = useMemo(() => (host || "").replace(/\/$/, ""), [host]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadModels() {
      try {
        if (!baseUrl || !keys?.[0]) return;
        const res = await fetch(`${baseUrl}/models`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${keys[0]}`,
            ...(Object.fromEntries(
              (headers || [])
                .filter((h: any) => h?.name)
                .map((h: any) => [h.name, h.value || ""])
            ) as any),
          },
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = await res.json();
        const data = Array.isArray(json?.data) ? json.data : [];
        const ids = data
          .map((m: any) => m?.id)
          .filter((id: any) => typeof id === "string");
        setRemoteModels(ids);
      } catch (_) {
        // silent
      }
    }
    loadModels();
    return () => controller.abort();
  }, [baseUrl, JSON.stringify(headers), keys?.[0]]);
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
          {remoteModels.map((m) => (
            <option value={m} key={m} />
          ))}
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
      </div>
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
      </div>
      <div className="flex flex-col gap-2">
        <Title>{t("compatibility.title")}</Title>
        <p>{t("compatibility.description")}</p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            active={compatibility}
            onClick={() => setCompatibility(!compatibility)}
          >
            {t("compatibility.enable")}
          </Button>
          <Button
            active={!compatibility}
            onClick={() => setCompatibility(!compatibility)}
          >
            {t("compatibility.disable")}
          </Button>
        </div>
      </div>
    </div>
  );
}
