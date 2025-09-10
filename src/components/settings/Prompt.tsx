import Title from "../Title";
import { useTranslation } from "react-i18next";
import usePrompt from "../../hooks/usePrompt";

export default function Prompt() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = usePrompt();

  return (
    <div className="bg-white rounded flex justify-between items-start border border-slate-200 p-4 gap-2 flex-col">
      <div className="flex flex-col">
        <Title>{t(`prompt.title`)}</Title>
        <div
          className="text-sm text-slate-600 mt-1"
          dangerouslySetInnerHTML={{ __html: t(`prompt.description`) }}
        ></div>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t(`prompt.name`)!}
        className="w-full h-56 px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500 resize-none"
      />
    </div>
  );
}
