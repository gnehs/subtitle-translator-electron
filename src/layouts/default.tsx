import { Outlet, Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalStorage } from "usehooks-ts";
import { useState, useEffect, type CSSProperties } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useVersion } from "@/hooks/useVersion";
import {
  ArrowLeftRight,
  ArrowUp,
  Info,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const dragRegionStyle = { appRegion: "drag" } as CSSProperties & {
  appRegion: "drag";
};
function NavItem({ to, icon: Icon }: { to: string; icon: LucideIcon }) {
  const isActive = useLocation().pathname === to;
  return (
    <Link
      to={to}
      className={`flex items-center justify-center text-[24px] ${
        isActive ? `bg-black/10` : `hover:bg-black/5`
      } group p-2 rounded-lg transition-colors duration-200 cursor-pointer`}
    >
      <Icon
        size={24}
        aria-hidden="true"
        className="group-active:scale-90 transition-all duration-200"
      />
    </Link>
  );
}
function CheckUpdate() {
  const version = useVersion();
  const [newVersion, setNewVersion] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();

    fetch(
      "https://api.github.com/repos/gnehs/subtitle-translator-electron/releases/latest",
      { signal: controller.signal }
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((release: unknown) => {
        if (
          release &&
          typeof release === "object" &&
          "tag_name" in release &&
          typeof release.tag_name === "string"
        ) {
          setNewVersion(release.tag_name);
        }
      })
      .catch(() => {
        // Update checks are optional and should not interrupt the app.
      });

    return () => controller.abort();
  }, []);
  useEffect(() => {
  if (version && newVersion && version !== newVersion) {
      toast.info(`New version (${newVersion})`, {
        onClick: () => {
          void window.electronAPI
            .openExternal(
              "https://github.com/gnehs/subtitle-translator-electron/releases/latest"
            )
            .catch(() => undefined);
        },
        position: "bottom-center",
        closeButton: false,
        className: "bg-slate-700 text-white cursor-pointer",
      });
    }
  }, [version, newVersion]);

    if (version && newVersion && version !== newVersion) {
    return (
      <a
        href="https://github.com/gnehs/subtitle-translator-electron/releases/latest"
        target="_blank"
        rel="noreferrer"
        className={`flex items-center justify-center text-[24px] text-white group p-2 rounded-lg bg-gradient-to-b from-slate-700 to-slate-500 hover:from-slate-900 hover:to-slate-700`}
      >
        <ArrowUp
          size={24}
          aria-hidden="true"
          className="group-active:scale-95 transition-all duration-200"
        />
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
    if (language !== i18n.language) void i18n.changeLanguage(language);
  }, [i18n, language]);

  return (
    <div className="flex flex-col h-[100vh] p-2 gap-2 bg-white/75">
      <div
        className="text-center shrink-0"
        style={dragRegionStyle}
      >
        Subtitle translator
      </div>
      <div className="flex flex-1">
        <div className="flex flex-col w-[52px] h-full pr-2 gap-0.5">
          <NavItem to="/" icon={ArrowLeftRight} />
          <div className="flex-1"></div>
          <CheckUpdate />
          <NavItem to="/settings" icon={Settings} />
          <NavItem to="/about" icon={Info} />
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
