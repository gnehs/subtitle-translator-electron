import Title from "../Title";
import { useTranslation } from "react-i18next";
export default function Reset() {
  const { t } = useTranslation();
  function resetAll() {
    if (confirm(t(`reset.prompt`)!)) {
      localStorage.clear();
      window.location.reload();
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <Title>{t(`reset.title`)}</Title>
      <button
        className={`p-2 rounded cursor-pointer bg-red-100 hover:bg-red-200 active:bg-red-300 text-red-500 font-bold`}
        onClick={(e) => resetAll()}
      >
        {t(`reset.name`)}
      </button>
    </div>
  );
}
