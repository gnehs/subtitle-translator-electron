import Title from "../Title";
import { useTranslation } from "react-i18next";
import resources from "../../locales/index";
export default function Language() {
  const { t, i18n } = useTranslation();
  console.log(i18n);
  return (
    <>
      <Title>{t("language")}</Title>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
        {Object.keys(resources).map((language) => (
          <button
            key={language}
            className={`p-2 rounded cursor-pointer ${
              i18n.language == language
                ? `bg-slate-300 font-bold`
                : `bg-slate-100 hover:bg-slate-200 active:bg-slate-300`
            }}`}
            onClick={() => i18n.changeLanguage(language)}
          >
            {t(`name`, { lng: language })}
          </button>
        ))}
      </div>
    </>
  );
}
