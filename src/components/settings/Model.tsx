import Title from "../Title";
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
          <button
            key={id}
            className={`p-2 rounded cursor-pointer text-left flex flex-col ${
              id == model
                ? `bg-slate-300 font-bold`
                : `bg-slate-100 hover:bg-slate-200 active:bg-slate-300`
            }}`}
            onClick={() => setModel(id)}
          >
            <div className={id == model ? `font-bold` : ``}>
              {t(`models.${id}.name`)}
            </div>
            <div className="opacity-80">{t(`models.${id}.description`)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
