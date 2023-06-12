import Title from "../Title";
import Button from "../Button";
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
          <Button
            key={id}
            active={multiLangSave == id}
            onClick={() => setMultiLangSave(id)}
          >
            {t(`save.multi-language.options.${id}`)}
          </Button>
        ))}
      </div>
      <div className="text-sm opacity-80">
        {t(`save.multi-language.description`)}
      </div>
    </div>
  );
}
