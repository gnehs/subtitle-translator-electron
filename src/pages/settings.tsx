import Header from "@/components/Header";
import Language from "@/components/settings/Language";
import Model from "@/components/settings/Model";
import API from "@/components/settings/API";
import Prompt from "@/components/settings/Prompt";
import { useTranslation } from "react-i18next";
export default function Settings() {
  const { t, i18n } = useTranslation();
  return (
    <>
      <Header>{t(`settings`)}</Header>
      <div className="p-2 flex flex-col gap-8">
        <Language />
        <API />
        <Model />
        <Prompt />
      </div>
    </>
  );
}
