import Title from "../Title";
import { useTranslation } from "react-i18next";
import resources from "../../locales/index";
import { useLocalStorage } from "usehooks-ts";
export default function Language() {
  const [language, setLanguage] = useLocalStorage("language", "en-US");
  const { t, i18n } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <Title>{t("language")}</Title>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
        {Object.keys(resources).map((language) => (
          <button
            key={language}
            className={`p-2 rounded cursor-pointer ${
              i18n.language == language
                ? `bg-slate-300 font-bold`
                : `bg-slate-100 hover:bg-slate-200 active:bg-slate-300`
            }`}
            onClick={() => {
              i18n.changeLanguage(language);
              setLanguage(language);
            }}
          >
            {t(`name`, { lng: language })}
          </button>
        ))}
      </div>
    </div>
  );
}
