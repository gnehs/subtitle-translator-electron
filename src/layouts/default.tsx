import { Outlet, Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalStorage } from "usehooks-ts";
import { useEffect } from "react";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
function NavItem({ to, icon }: { to: string; icon: string }) {
  const isActive = useLocation().pathname === to;
  return (
    <Link
      to={to}
      className={`flex items-center justify-center text-[24px] ${
        isActive ? `bg-slate-200` : `hover:bg-slate-200`
      } group p-2 rounded-lg transition-colors duration-200`}
    >
      <i
        className={`bx ${icon} group-active:scale-95 transition-all duration-200`}
      ></i>
    </Link>
  );
}
function DefaultLayout() {
  // change language
  const [language] = useLocalStorage("language", "en-US");
  const { i18n } = useTranslation();
  useEffect(() => {
    if (language != i18n.language) i18n.changeLanguage(language);
  }, []);

  return (
    <div className="flex h-[100vh]">
      <div className="flex flex-col w-[52px] h-full bg-slate-100 p-1 gap-[2px] border-r border-slate-200">
        <NavItem to="/" icon="bx-transfer-alt" />
        <div className="flex-1"></div>
        <NavItem to="/settings" icon="bx-cog" />
        <NavItem to="/about" icon="bx-info-circle" />
      </div>
      <main className="flex-1 h-[100vh] overflow-scroll">
        <Outlet />
      </main>
      <ToastContainer position="bottom-center" newestOnTop />
    </div>
  );
}
export default DefaultLayout;
