import Header from "@/components/Header";
import Language from "@/components/settings/Language";
import { useTranslation } from "react-i18next";
export default function Settings() {
  const { t, i18n } = useTranslation();
  return (
    <>
      <Header>{t(`settings`)}</Header>
      <div className="p-2 flex flex-col gap-2">
        <Language />
        <h1 className="font-bold text-slate-800">API Key & Host</h1>
        <h1 className="font-bold text-slate-800">Prompt</h1>
      </div>
    </>
  );
}
