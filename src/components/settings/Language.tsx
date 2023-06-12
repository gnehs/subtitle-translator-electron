import Title from "../Title";
import Button from "../Button";
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
          <Button
            key={language}
            active={i18n.language == language}
            onClick={() => {
              i18n.changeLanguage(language);
              setLanguage(language);
            }}
          >
            {t(`name`, { lng: language })}
          </Button>
        ))}
      </div>
    </div>
  );
}
