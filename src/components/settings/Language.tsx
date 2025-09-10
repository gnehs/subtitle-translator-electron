import Title from "../Title";
import { useTranslation } from "react-i18next";
import resources from "../../locales/index";
import { useLocalStorage } from "usehooks-ts";
import { useState, useEffect, useRef } from "react";

export default function Language() {
  const [language, setLanguage] = useLocalStorage("language", "en-US");
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isChanging, setIsChanging] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const getLanguageInfo = (langCode: string) => {
    const langNames: Record<string, { name: string }> = {
      "en-US": { name: "English" },
      "zh-TW": { name: "繁體中文" },
      "zh-CN": { name: "简体中文" },
    };
    return (
      langNames[langCode] || { name: langCode, flag: "🌍", native: langCode }
    );
  };

  const handleLanguageChange = async (newLanguage: string) => {
    if (newLanguage === i18n.language) {
      setIsOpen(false);
      return;
    }

    setIsChanging(true);
    try {
      await i18n.changeLanguage(newLanguage);
      setLanguage(newLanguage);
      setIsOpen(false);
    } catch (error) {
      console.error("Failed to change language:", error);
    } finally {
      setIsChanging(false);
    }
  };

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

  const currentLangInfo = getLanguageInfo(i18n.language);

  return (
    <div className="bg-white rounded flex justify-between items-center border border-slate-200 p-4 gap-8">
      <div className="flex flex-col">
        <Title>{t("language")}</Title>
      </div>

      {/* Refined macOS Style Dropdown */}
      <div className="relative w-80 shrink-0" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={isChanging}
          className={`
            w-full max-w-sm bg-slate-50 border border-slate-200 rounded-lg px-4 py-3
            flex items-center justify-between
            hover:bg-white hover:border-slate-300
            focus:outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400
            transition-all duration-150 ease-in-out
            ${isChanging ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
            ${isOpen ? "bg-white border-slate-400 ring-1 ring-slate-400" : ""}
          `}
        >
          <div className="flex items-center gap-3">
            <div className="text-left">
              <div className="font-medium text-slate-800 text-sm">
                {currentLangInfo.name}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isChanging && (
              <div className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
            )}
            <i
              className={`bx bx-chevron-down text-slate-400 transition-transform duration-200 ease-in-out ${
                isOpen ? "rotate-180" : ""
              }`}
            ></i>
          </div>
        </button>

        {/* Refined Dropdown Menu */}
        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-72 overflow-y-auto">
            <div className="py-1">
              {Object.keys(resources).map((langCode) => {
                const langInfo = getLanguageInfo(langCode);
                const isActive = i18n.language === langCode;

                return (
                  <button
                    key={langCode}
                    onClick={() => handleLanguageChange(langCode)}
                    className={`
                      w-full px-4 py-2.5 flex items-center gap-3 text-left
                      hover:bg-slate-50 transition-colors duration-150
                      ${isActive ? "bg-slate-100" : ""}
                      first:mt-0 last:mb-0
                    `}
                  >
                    <div className="flex-1">
                      <div
                        className={`font-medium text-sm ${
                          isActive ? "text-slate-800" : "text-slate-700"
                        }`}
                      >
                        {langInfo.name}
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
    </div>
  );
}