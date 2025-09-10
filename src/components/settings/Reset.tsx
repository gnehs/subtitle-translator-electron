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
    <div className="bg-white rounded flex justify-between items-center border border-slate-200 p-4 gap-8">
      <div className="flex flex-col">
        <Title>{t(`reset.title`)}</Title>
      </div>
      
      <button
        onClick={resetAll}
        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium text-sm shrink-0"
      >
        {t(`reset.name`)}
      </button>
    </div>
  );
}