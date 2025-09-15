import Title from "../Title";
import { useTranslation } from "react-i18next";
import useModel from "../../hooks/useModel";
import { useEffect, useMemo, useState, useRef } from "react";
import { useAPIHost, useAPIKeys } from "@/hooks/useOpenAI";
import { useTemperature } from "../../hooks/useOpenAI";

export default function Model() {
  const { t } = useTranslation();
  const [model, setModel] = useModel();
  const [temperature, setTemperature] = useTemperature();
  const [host] = useAPIHost();
  const [keys] = useAPIKeys();
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [isModelOpen, setIsModelOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const baseUrl = useMemo(() => (host || "").replace(/\/$/, ""), [host]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadModels() {
      try {
        if (!baseUrl || !keys?.[0]) return;
        setRemoteModels([]);
        const res = await fetch(`${baseUrl}/models`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${keys[0]}`,
          },
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = await res.json();
        console.log("Fetched models", baseUrl, json);
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
  }, [baseUrl, keys?.[0]]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(event.target as Node)
      ) {
        setIsModelOpen(false);
        setSearchInput("");
        setSelectedIndex(-1);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Reset selected index when search input changes
  useEffect(() => {
    setSelectedIndex(-1);
  }, [searchInput]);

  const filteredModels = useMemo(() => {
    if (!searchInput.trim()) return remoteModels;
    return remoteModels.filter((modelName) =>
      modelName.toLowerCase().includes(searchInput.toLowerCase())
    );
  }, [remoteModels, searchInput]);

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value);
  };

  const handleSearchInputKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (selectedIndex >= 0 && selectedIndex < filteredModels.length) {
        handleModelSelect(filteredModels[selectedIndex]);
      } else if (searchInput.trim()) {
        setModel(searchInput.trim());
        setIsModelOpen(false);
        setSearchInput("");
        setSelectedIndex(-1);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filteredModels.length > 0) {
        setSelectedIndex((prev) =>
          prev < filteredModels.length - 1 ? prev + 1 : 0
        );
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filteredModels.length > 0) {
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredModels.length - 1
        );
      }
    } else if (e.key === "Escape") {
      setIsModelOpen(false);
      setSearchInput("");
      setSelectedIndex(-1);
    }
  };

  const handleModelSelect = (modelName: string) => {
    setModel(modelName);
    setIsModelOpen(false);
    setSearchInput("");
    setSelectedIndex(-1);
  };

  const handleDropdownToggle = () => {
    setIsModelOpen(!isModelOpen);
    if (!isModelOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  };

  return (
    <div className="space-y-4">
      {/* Model Selection */}
      <div className="bg-white rounded flex justify-between items-center border border-slate-200 p-4">
        <div className="flex items-center gap-3">
          <Title>{t("model")}</Title>
        </div>

        <div className="relative w-80" ref={modelDropdownRef}>
          <button
            onClick={handleDropdownToggle}
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
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
              {/* Search Input */}
              <div className="p-2 border-b border-slate-200">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchInput}
                  onChange={handleSearchInputChange}
                  onKeyDown={handleSearchInputKeyPress}
                  placeholder={t("searchOrEnterModel")}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400
                    transition-all duration-150 ease-in-out"
                />
              </div>

              {/* Model List */}
              <div className="max-h-60 overflow-y-auto">
                {filteredModels.length > 0 ? (
                  <div className="py-1">
                    {filteredModels.map((modelName, index) => (
                      <button
                        key={modelName}
                        onClick={() => handleModelSelect(modelName)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={`
                          w-full px-4 py-2.5 flex items-center gap-3 text-left
                          hover:bg-slate-50
                          ${model === modelName ? "bg-slate-100" : ""}
                          ${selectedIndex === index ? "bg-slate-100" : ""}
                        `}
                      >
                        <div className="flex-1">
                          <div
                            className={`font-medium text-sm ${
                              model === modelName || selectedIndex === index
                                ? "text-slate-800"
                                : "text-slate-700"
                            }`}
                          >
                            {modelName}
                          </div>
                        </div>
                        {(model === modelName || selectedIndex === index) && (
                          <div
                            className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
                              model === modelName
                                ? "bg-slate-500"
                                : "bg-slate-300"
                            }`}
                          >
                            <i className="bx bx-check text-white text-xs"></i>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="py-4 px-4 text-center">
                    <div className="text-sm text-slate-500 mb-2">
                      {t("noModelsFound")}
                    </div>
                    {searchInput.trim() && (
                      <div className="text-xs text-slate-400">
                        {t("pressEnterToUse")} "{searchInput}"
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
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
    </div>
  );
}
