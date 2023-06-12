import Title from "../Title";
import Button from "../Button";
import { useTranslation } from "react-i18next";
import useModel from "../../hooks/useModel";
import modelList from "../../model/list";
export default function Language() {
  const { t } = useTranslation();
  const [model, setModel] = useModel();
  return (
    <div className="flex flex-col gap-2">
      <Title>{t("model")}</Title>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
        {modelList.map((id) => (
          <Button
            key={id}
            active={id == model}
            onClick={() => setModel(id)}
            className="text-left flex flex-col"
          >
            <div>{t(`models.${id}.name`)}</div>
            <div className="opacity-80 font-normal">
              {t(`models.${id}.description`)}
            </div>
          </Button>
        ))}
      </div>
    </div>
  );
}
