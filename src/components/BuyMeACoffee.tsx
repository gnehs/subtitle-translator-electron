import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
export default function BuyMeACoffee() {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ y: 50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="p-4 bg-slate-100 flex gap-4 items-center border border-slate-200 m-2 rounded"
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
  );
}
