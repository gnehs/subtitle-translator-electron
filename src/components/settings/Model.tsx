import Title from "../Title";
import { useTranslation } from "react-i18next";
import useModel from "../../hooks/useModel";
import { useEffect, useMemo, useState, useRef } from "react";
import { useAPIHost, useAPIKeys, useAPIHeaders } from "@/hooks/useOpenAI";
import {
  useEconomy,
  useTemperature,
  useCompatibility,
} from "../../hooks/useOpenAI";

export default function Model() {
  const { t } = useTranslation();
  const [model, setModel] = useModel();
  const [eco, setEco] = useEconomy();
  const [temperature, setTemperature] = useTemperature();
  const [compatibility, setCompatibility] = useCompatibility();
  const [host] = useAPIHost();
  const [keys] = useAPIKeys();
  const [headers] = useAPIHeaders();
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [isModelOpen, setIsModelOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(event.target as Node)
      ) {
        setIsModelOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div className="space-y-4">
      {/* Model Selection */}
      <div className="bg-white rounded flex justify-between items-center border border-slate-200 p-4">
        <div className="flex items-center gap-3">
          <Title>{t("model")}</Title>
        </div>

        <div className="relative w-80" ref={modelDropdownRef}>
          <button
            onClick={() => setIsModelOpen(!isModelOpen)}
            className={`
              w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3
              flex items-center justify-between
              hover:bg-white hover:border-slate-300
              focus:outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400
              transition-all duration-150 ease-in-out
              cursor-pointer
              ${
                isModelOpen
                  ? "bg-white border-slate-400 ring-1 ring-slate-400"
                  : ""
              }
            `}
          >
            <div className="text-left">
              <div className="font-medium text-slate-800 text-sm">
                {model || t("modelName")}
              </div>
            </div>
            <i
              className={`bx bx-chevron-down text-slate-400 transition-transform duration-200 ease-in-out ${
                isModelOpen ? "rotate-180" : ""
              }`}
            ></i>
          </button>

          {isModelOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-72 overflow-y-auto">
              <div className="py-1">
                {remoteModels.map((modelName) => (
                  <button
                    key={modelName}
                    onClick={() => {
                      setModel(modelName);
                      setIsModelOpen(false);
                    }}
                    className={`
                      w-full px-4 py-2.5 flex items-center gap-3 text-left
                      hover:bg-slate-50 transition-colors duration-150
                      ${model === modelName ? "bg-slate-100" : ""}
                    `}
                  >
                    <div className="flex-1">
                      <div
                        className={`font-medium text-sm ${
                          model === modelName
                            ? "text-slate-800"
                            : "text-slate-700"
                        }`}
                      >
                        {modelName}
                      </div>
                    </div>
                    {model === modelName && (
                      <div className="w-4 h-4 bg-slate-500 rounded-full flex items-center justify-center flex-shrink-0">
                        <i className="bx bx-check text-white text-xs"></i>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Economy Mode */}
      <div className="bg-white rounded flex justify-between items-center border border-slate-200 p-4 gap-8">
        <div className="flex flex-col">
          <Title>{t("eco.title")}</Title>
          <div className="text-sm text-slate-600">
            {t("eco.description1")} {t("eco.description2")}
          </div>
        </div>

        <div className="flex gap-2 w-80 shrink-0">
          <button
            onClick={() => setEco(true)}
            className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              eco
                ? "bg-slate-800 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {t("eco.enable")}
          </button>
          <button
            onClick={() => setEco(false)}
            className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              !eco
                ? "bg-slate-800 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {t("eco.disable")}
          </button>
        </div>
      </div>

      {/* Temperature */}
      <div className="bg-white rounded flex justify-between items-center border border-slate-200 p-4 gap-8">
        <div className="flex flex-col">
          <Title>{t("temperature.title")}</Title>
          <div className="text-sm text-slate-600">
            {t("temperature.description")}
          </div>
        </div>

        <div className="flex items-center gap-3 w-80 shrink-0">
          <input
            type="range"
            min="0"
            max="2"
            step="0.01"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="flex-1"
          />
          <input
            type="number"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-20 px-2 py-1 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
            min="0"
            max="2"
            step="0.01"
          />
        </div>
      </div>

      {/* Compatibility Mode */}
      <div className="bg-white rounded flex justify-between items-center border border-slate-200 p-4 gap-8">
        <div className="flex flex-col">
          <Title>{t("compatibility.title")}</Title>
          <div className="text-sm text-slate-600">
            {t("compatibility.description")}
          </div>
        </div>

        <div className="flex gap-2 w-80 shrink-0">
          <button
            onClick={() => setCompatibility(true)}
            className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              compatibility
                ? "bg-slate-800 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {t("compatibility.enable")}
          </button>
          <button
            onClick={() => setCompatibility(false)}
            className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              !compatibility
                ? "bg-slate-800 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {t("compatibility.disable")}
          </button>
        </div>
      </div>
    </div>
  );
}
