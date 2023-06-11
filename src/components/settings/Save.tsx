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
    <div className="flex flex-col gap-2">
      <Title>{t(`save.title`)}</Title>
      <p>{t(`save.multi-language.name`)}</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
        {multiLangSaveOptions.map((id) => (
          <button
            key={id}
            className={`p-2 rounded cursor-pointer ${
              multiLangSave == id
                ? `bg-slate-300 font-bold`
                : `bg-slate-100 hover:bg-slate-200 active:bg-slate-300`
            }`}
            onClick={() => setMultiLangSave(id)}
          >
            {t(`save.multi-language.options.${id}`)}
          </button>
        ))}
      </div>
      <div className="text-sm opacity-80">
        {t(`save.multi-language.description`)}
      </div>
    </div>
  );
}
