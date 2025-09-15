import Title from "../Title";
import { useTranslation } from "react-i18next";
import { useAPIHost, useAPIKeys } from "@/hooks/useOpenAI";
import { useMemo, useState, useEffect, useRef } from "react";

export default function API() {
  const { t } = useTranslation();
  const [keys, setKeys] = useAPIKeys();
  const [host, setHost] = useAPIHost();
  const noKey = useMemo(() => keys.every((k) => !k), [keys]);
  const [provider, setProvider] = useState<
    "openrouter" | "openai" | "vercel-gateway" | "openai-compatible"
  >("openrouter");
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  function setKey(index: number, value: string) {
    const newKeys = structuredClone(keys);
    //@ts-ignore
    newKeys[index] = value;
    setKeys(newKeys);
  }

  function preset(hostUrl: string, keyLabel: string) {
    setHost(hostUrl);
  }

  useEffect(() => {
    switch (provider) {
      case "openrouter":
        preset("https://openrouter.ai/api/v1", "OpenRouter API Key");
        break;
      case "openai":
        preset("https://api.openai.com/v1", "OpenAI API Key");
        break;
      case "vercel-gateway":
        preset("https://ai-gateway.vercel.sh/v1", "AI Gateway Key");
        break;
      case "openai-compatible":
        // do not change host; allow user to edit
        break;
    }
  }, [provider]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const getProviderInfo = (providerValue: string) => {
    const providerNames: Record<string, { name: string }> = {
      openrouter: { name: t("api.presets.openrouter") },
      openai: { name: t("api.presets.openai") },
      "vercel-gateway": { name: t("api.presets.vercel_gateway") },
      "openai-compatible": { name: t("api.presets.openai_compatible") },
    };
    return providerNames[providerValue] || { name: providerValue };
  };

  const currentProviderInfo = getProviderInfo(provider);

  return (
    <div className="bg-white rounded flex justify-between items-start border border-slate-200 p-4 gap-8">
      <div className="flex flex-col">
        <Title>{t("api.title")}</Title>
        {noKey && (
          <div className="text-sm text-yellow-700 bg-yellow-50 p-2 rounded mt-2">
            {t("api.presets.recommendation")}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 w-80 shrink-0">
        {/* Provider Selection */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className={`
              w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3
              flex items-center justify-between
              hover:bg-white hover:border-slate-300
              focus:outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400
              transition-all duration-150 ease-in-out
              cursor-pointer
              ${isOpen ? "bg-white border-slate-400 ring-1 ring-slate-400" : ""}
            `}
          >
            <div className="text-left">
              <div className="font-medium text-slate-800 text-sm">
                {currentProviderInfo.name}
              </div>
            </div>
            <i
              className={`bx bx-chevron-down text-slate-400 transition-transform duration-200 ease-in-out ${
                isOpen ? "rotate-180" : ""
              }`}
            ></i>
          </button>

          {isOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
              <div className="py-1">
                {[
                  "openrouter",
                  "openai",
                  "vercel-gateway",
                  "openai-compatible",
                ].map((providerValue) => {
                  const providerInfo = getProviderInfo(providerValue);
                  const isActive = provider === providerValue;

                  return (
                    <button
                      key={providerValue}
                      onClick={() => {
                        setProvider(providerValue as any);
                        setIsOpen(false);
                      }}
                      className={`
                        w-full px-4 py-2.5 flex items-center gap-3 text-left
                        hover:bg-slate-50 transition-colors duration-150
                        ${isActive ? "bg-slate-100" : ""}
                      `}
                    >
                      <div className="flex-1">
                        <div
                          className={`font-medium text-sm ${
                            isActive ? "text-slate-800" : "text-slate-700"
                          }`}
                        >
                          {providerInfo.name}
                        </div>
                      </div>
                      {isActive && (
                        <div className="w-4 h-4 bg-slate-500 rounded-full flex items-center justify-center flex-shrink-0">
                          <i className="bx bx-check text-white text-xs"></i>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* API Key Input */}
        <input
          type="password"
          placeholder={t("api.key.name")}
          value={keys[0] || ""}
          onChange={(e) => setKey(0, e.target.value)}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
        />

        {/* Custom Host for OpenAI Compatible */}
        {provider === "openai-compatible" && (
          <input
            type="text"
            placeholder={t("api.host.name")}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
          />
        )}
      </div>
    </div>
  );
}
