import { useEffect, useState, type CSSProperties } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { FilePlus2, Info, Settings2, X } from "lucide-react";
import Settings from "@/pages/settings";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { Sheet } from "@/components/ui/sheet";
import { useVersion } from "@/hooks/useVersion";
import { useTranslation } from "@/i18n";
import { isNewerVersion } from "@/utils/version";

const dragRegionStyle = { appRegion: "drag" } as CSSProperties & {
  appRegion: "drag";
};

const noDragRegionStyle = { appRegion: "no-drag" } as CSSProperties & {
  appRegion: "no-drag";
};

function CheckUpdate() {
  const { i18n, t } = useTranslation();
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
    if (!version || !newVersion || !isNewerVersion(version, newVersion)) return;
    toast.custom((toastId) => (
      <div className="relative flex w-full items-start gap-3 rounded-xl border bg-popover p-4 pr-10 text-popover-foreground shadow-lg">
        <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Info className="size-3" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-5 font-medium">{t("update.available")}</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {t("update.description", { version: newVersion })}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              toast.dismiss(toastId);
              void window.electronAPI.openExternal(
                "https://github.com/gnehs/subtitle-translator-electron/releases/latest"
              );
            }}
          >
            {t("update.view")}
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-2"
          onClick={() => toast.dismiss(toastId)}
          aria-label={t("translate.close")}
          title={t("translate.close")}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    ), {
      toasterId: "updates",
      position: "top-center",
      unstyled: true,
      style: { width: "100%" },
    });
  }, [i18n.locale, newVersion, version]);

  return null;
}

export default function DefaultLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const isSettingsOpen = location.pathname === "/settings";
  const isTaskSurface = location.pathname === "/" || isSettingsOpen;
  const [addTaskRequest, setAddTaskRequest] = useState(0);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-muted/30">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur" style={dragRegionStyle}>
        {window.electronAPI.platform === "darwin" && (
          <div className="w-14 shrink-0" aria-hidden="true" />
        )}
        <span className="font-heading text-base font-semibold tracking-tight">Subtitle Translator</span>
        <div className="flex-1" />
        {isTaskSurface && (
          <Button
            onClick={() => setAddTaskRequest((request) => request + 1)}
            style={noDragRegionStyle}
          >
            <FilePlus2 data-icon="inline-start" />
            {t("navigation.addTask")}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => navigate(isSettingsOpen ? "/" : "/settings")}
          style={noDragRegionStyle}
          aria-label={t(isSettingsOpen ? "navigation.closeSettings" : "navigation.openSettings")}
        >
          <Settings2 data-icon="inline-start" />
          {t("settings")}
        </Button>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden bg-background">
        <Outlet context={{ addTaskRequest }} />
      </main>

      <Sheet open={isSettingsOpen} onOpenChange={(open) => !open && navigate("/")}>
        <Settings />
      </Sheet>
      <CheckUpdate />
      <Toaster
        id="updates"
        position="top-center"
        offset={{ top: "4.5rem" }}
        style={{ "--width": "30rem" } as CSSProperties}
        richColors
      />
      <Toaster
        position="bottom-center"
        offset={{ bottom: "2rem" }}
        richColors
      />
    </div>
  );
}
