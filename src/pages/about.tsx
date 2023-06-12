import Header from "@/components/Header";
import Button from "@/components/Button";
import { useVersion } from "@/hooks/useVersion";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
export default function About() {
  const { t } = useTranslation();
  const version = useVersion();
  return (
    <div className="h-full flex flex-col">
      <Header>{t("about.title")}</Header>
      <div className="p-2 flex flex-col gap-4">
        <div>
          <img
            src="/icon.png"
            className="w-32 h-32 mx-auto drop-shadow-lg mt-4"
          />
          <h1 className="text-3xl font-bold text-center">
            Subtitle Translator
          </h1>
          <h1 className="text-xl text-center">{version}</h1>
          <div className="flex gap-2 items-center justify-center mt-4">
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
        <div className="border-b border-slate-200"></div>
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
      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="p-4 bg-slate-100 flex gap-4 items-center border-t border-slate-200"
      >
        <div className="flex flex-col gap-1 flex-1">
          <h2 className="text-xl font-bold">{t("about.buy_me_a_coffee")}</h2>
          <p>{t("about.buy_me_a_coffee_description")}</p>
        </div>
        <a
          href="https://www.buymeacoffee.com/gnehs"
          target="_blank"
          className={`p-2 rounded cursor-pointer bg-slate-800 hover:bg-slate-900 active:bg-slate-950 text-white flex items-center justify-center gap-1`}
        >
          <i className="bx bx-coffee-togo"></i>
          {t("about.buy_me_a_coffee")}
        </a>
      </motion.div>
    </div>
  );
}
