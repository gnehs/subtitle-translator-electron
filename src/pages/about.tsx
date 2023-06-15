import Header from "@/components/Header";
import Button from "@/components/Button";
import { useVersion } from "@/hooks/useVersion";
import { useTranslation } from "react-i18next";
import icon from "@/assets/icon.png";
import BuyMeACoffee from "@/components/BuyMeACoffee";
export default function About() {
  const { t } = useTranslation();
  const version = useVersion();
  return (
    <div className="h-full flex flex-col">
      <Header>{t("about.title")}</Header>
      <div className="p-2 flex flex-col gap-4 items-center">
        <div className="p-2 flex gap-4 w-full max-w-[450px] mt-4">
          <img src={icon} className="w-32 h-32 mx-auto drop-shadow-lg" />
          <div className="flex-1">
            <h1 className="text-3xl font-bold">Subtitle Translator</h1>
            <h1 className="text-xl">{version}</h1>
            <div className="flex gap-2 items-center justify-start mt-4">
              <Button
                href="https://github.com/gnehs/subtitle-translator-electron"
                target="_blank"
                icon="bxl-github"
              >
                GitHub
              </Button>
              <Button
                href="https://github.com/gnehs/subtitle-translator-electron/issues"
                target="_blank"
                icon="bx-bug"
              >
                {t("about.report_issue")}
              </Button>
            </div>
          </div>
        </div>
        <div className="border-b border-slate-200 w-full"></div>
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-bold text-center">{t("about.author")}</h1>
          <img
            src="https://avatars.githubusercontent.com/u/16719720?v=4"
            className="w-16 h-16 mx-auto drop-shadow-lg mt-4 rounded-full"
          />
          <h1 className="text-center">gnehs</h1>
        </div>
      </div>
      <div className="flex-1"></div>
      <BuyMeACoffee />
    </div>
  );
}
