import { useEffect, useState, type CSSProperties } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalStorage } from "usehooks-ts";
import { toast } from "sonner";
import { FilePlus2, Settings2 } from "lucide-react";
import Settings from "@/pages/settings";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { Sheet } from "@/components/ui/sheet";
import { useVersion } from "@/hooks/useVersion";

const dragRegionStyle = { appRegion: "drag" } as CSSProperties & {
  appRegion: "drag";
};

const noDragRegionStyle = { appRegion: "no-drag" } as CSSProperties & {
  appRegion: "no-drag";
};

function CheckUpdate() {
  const version = useVersion();
  const [newVersion, setNewVersion] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(
      "https://api.github.com/repos/gnehs/subtitle-translator-electron/releases/latest",
      { signal: controller.signal }
    )
      .then((response) => (response.ok ? response.json() : null))
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
      .catch(() => undefined);

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!version || !newVersion || version === newVersion) return;
    toast.info(`有新的版本可用：${newVersion}`, {
      action: {
        label: "查看更新",
        onClick: () => {
          void window.electronAPI.openExternal(
            "https://github.com/gnehs/subtitle-translator-electron/releases/latest"
          );
        },
      },
    });
  }, [newVersion, version]);

  return null;
}

export default function DefaultLayout() {
  const [language] = useLocalStorage("language", "en-US");
  const { i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const isSettingsOpen = location.pathname === "/settings";
  const isTaskSurface = location.pathname === "/" || isSettingsOpen;
  const [addTaskRequest, setAddTaskRequest] = useState(0);

  useEffect(() => {
    if (language !== i18n.language) void i18n.changeLanguage(language);
  }, [i18n, language]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-muted/30">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur" style={dragRegionStyle}>
        <div className="w-14 shrink-0" aria-hidden="true" />
        <span className="font-heading text-base font-semibold tracking-tight">Subtitle Translator</span>
        <div className="flex-1" />
        {isTaskSurface && (
          <Button
            onClick={() => setAddTaskRequest((request) => request + 1)}
            style={noDragRegionStyle}
          >
            <FilePlus2 data-icon="inline-start" />
            新增任務
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => navigate(isSettingsOpen ? "/" : "/settings")}
          style={noDragRegionStyle}
          aria-label={isSettingsOpen ? "關閉設定" : "開啟設定"}
        >
          <Settings2 data-icon="inline-start" />
          設定
        </Button>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden bg-background">
        <Outlet context={{ addTaskRequest }} />
      </main>

      <Sheet open={isSettingsOpen} onOpenChange={(open) => !open && navigate("/")}>
        <Settings />
      </Sheet>
      <CheckUpdate />
      <Toaster position="bottom-center" richColors />
    </div>
  );
}
