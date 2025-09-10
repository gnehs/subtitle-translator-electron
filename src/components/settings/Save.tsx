import Title from "../Title";
import { useTranslation } from "react-i18next";
import { useLocalStorage } from "usehooks-ts";

export default function Save() {
  const { t } = useTranslation();
  const [multiLangSave, setMultiLangSave] = useLocalStorage(
    "multi_language_save",
    "none"
  );
  const multiLangSaveOptions = [
    "none",
    "translate+original",
    "original+translate",
  ];

  return (
    <div className="bg-white rounded flex justify-between items-center border border-slate-200 p-4 gap-8">
      <div className="flex flex-col">
        <Title>{t(`save.title`)}</Title>
        <div className="text-sm text-slate-600 mt-1">
          {t(`save.multi-language.description`)}
        </div>
      </div>
      
      <div className="flex gap-2 shrink-0">
        {multiLangSaveOptions.map((id) => (
          <button
            key={id}
            onClick={() => setMultiLangSave(id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              multiLangSave === id 
                ? "bg-slate-800 text-white" 
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {t(`save.multi-language.options.${id}`)}
          </button>
        ))}
      </div>
    </div>
  );
}