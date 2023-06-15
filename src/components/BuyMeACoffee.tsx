import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
export default function BuyMeACoffee() {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      className=" bg-slate-100 border border-slate-200 bg-opacity-40 m-2 rounded"
    >
      <div className="px-4 py-3 flex gap-4 items-center">
        <div className="flex-1">
          <h2 className="font-bold">{t("about.buy_me_a_coffee")}</h2>
          <p>{t("about.buy_me_a_coffee_description")}</p>
        </div>
        <a
          href="https://www.buymeacoffee.com/gnehs"
          target="_blank"
          className={`py-2 px-3 rounded cursor-pointer bg-slate-800 hover:bg-slate-950 active:bg-slate-950 text-white flex items-center justify-center gap-1 shadow`}
        >
          <i className="bx bx-coffee-togo"></i>
          {t("about.buy_me_a_coffee")}
        </a>
      </div>
    </motion.div>
  );
}
