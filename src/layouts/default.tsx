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
        isActive ? `bg-black/10` : `hover:bg-black/5`
      } group p-2 rounded-lg transition-colors duration-200 cursor-pointer`}
    >
      <i
        className={`bx ${icon} group-active:scale-90 transition-all duration-200`}
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
    <div className="flex flex-col h-[100vh] p-2 gap-2 bg-white/75">
      <div
        className="text-center shrink-0"
        style={{
          // @ts-expect-error Electron API
          appRegion: "drag",
        }}
      >
        Subtitle translator
      </div>
      <div className="flex flex-1">
        <div className="flex flex-col w-[52px] h-full pr-2 gap-0.5">
          <NavItem to="/" icon="bx-transfer-alt" />
          <div className="flex-1"></div>
          <CheckUpdate />
          <NavItem to="/settings" icon="bx-cog" />
          <NavItem to="/about" icon="bx-info-circle" />
        </div>
        <div className="drop-shadow-xl w-full h-full bg-white/90 rounded-md">
          <main className=" overflow-hidden w-full h-full rounded-md   ">
            <Outlet />
          </main>
        </div>
        <ToastContainer position="bottom-center" newestOnTop />
      </div>
    </div>
  );
}
export default DefaultLayout;
