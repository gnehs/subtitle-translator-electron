import { Outlet, Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalStorage } from "usehooks-ts";
import { useState, useEffect } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useVersion } from "@/hooks/useVersion";
import { shell } from "electron";
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
function CheckUpdate() {
  const version = useVersion();
  const [newVersion, setNewVersion] = useState<string | null>(null);
  useEffect(() => {
    fetch(
      "https://api.github.com/repos/gnehs/subtitle-translator-electron/releases/latest"
    )
      .then((res) => res.json())
      .then((res) => {
        setNewVersion(res.tag_name);
      });
  }, []);
  useEffect(() => {
    if (version && newVersion && version != newVersion) {
      toast.info(`New version (${newVersion})`, {
        onClick: () => {
          shell.openExternal(
            "https://github.com/gnehs/subtitle-translator-electron/releases/latest"
          );
        },
        position: "bottom-center",
        closeButton: false,
        className: "bg-slate-700 text-white cursor-pointer",
      });
    }
  }, [version, newVersion]);

  if (version && newVersion && version != newVersion) {
    return (
      <a
        href="https://github.com/gnehs/subtitle-translator-electron/releases/latest"
        target="_blank"
        className={`flex items-center justify-center text-[24px] text-white group p-2 rounded-lg bg-gradient-to-b from-slate-700 to-slate-500 hover:from-slate-900 hover:to-slate-700`}
      >
        <i
          className={`bx bx-up-arrow-alt group-active:scale-95 transition-all duration-200`}
        ></i>
      </a>
    );
  } else {
    return <></>;
  }
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
        <CheckUpdate />
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
