import Title from "../Title";
import {
  dynamicActivate,
  localeNames,
  locales,
  syncNativeMenuLocale,
  type Locale,
  useTranslation,
} from "@/i18n";
import { useLocalStorage } from "usehooks-ts";
import { useState, useEffect, useRef } from "react";
import { Check, ChevronDown } from "lucide-react";

export default function Language() {
  const [language, setLanguage] = useLocalStorage("language", "en-US");
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isChanging, setIsChanging] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const getLanguageInfo = (langCode: string) => {
    return { name: localeNames[langCode as Locale] || langCode };
  };

  const handleLanguageChange = async (newLanguage: string) => {
    if (newLanguage === i18n.locale) {
      setIsOpen(false);
      return;
    }

    setIsChanging(true);
    try {
      const activatedLocale = await dynamicActivate(newLanguage);
      syncNativeMenuLocale(activatedLocale);
      setLanguage(activatedLocale);
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

  const currentLangInfo = getLanguageInfo(i18n.locale);

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
            <ChevronDown
              size={18}
              aria-hidden="true"
              className={`text-slate-400 transition-transform duration-200 ease-in-out ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </div>
        </button>

        {/* Refined Dropdown Menu */}
        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-72 overflow-y-auto">
            <div className="py-1">
              {locales.map((langCode) => {
                const langInfo = getLanguageInfo(langCode);
                const isActive = i18n.locale === langCode;

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
                        <Check size={12} className="text-white" aria-hidden="true" />
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
