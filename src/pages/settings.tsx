import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalStorage } from "usehooks-ts";
import { useAPIHost, useAPIKeys, useAPIProvider, useTemperature } from "@/hooks/useOpenAI";
import useDelay from "@/hooks/useDelay";
import usePrompt from "@/hooks/usePrompt";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  PlugZap,
  RotateCcw,
} from "lucide-react";

type ConnectionStatus = "idle" | "loading" | "success" | "error";

function getConnectionErrorKey(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (/HTTP (401|403)\b/i.test(message)) {
    return "api.connection.unauthorized";
  }
  if (/HTTP 429\b/i.test(message)) {
    return "api.connection.rateLimited";
  }
  if (/timeout|timed out|aborted/i.test(message)) {
    return "api.connection.timeout";
  }
  if (/valid URL|HTTP or HTTPS/i.test(message)) {
    return "api.connection.invalidHost";
  }
  return "api.connection.failed";
}

const providerPresets = {
  openrouter: {
    label: "OpenRouter",
    host: "https://openrouter.ai/api/v1",
  },
  openai: {
    label: "OpenAI",
    host: "https://api.openai.com/v1",
  },
  "vercel-gateway": {
    label: "Vercel AI Gateway",
    host: "https://ai-gateway.vercel.sh/v1",
  },
  "openai-compatible": {
    label: "OpenAI 相容（自訂）",
    host: "",
  },
} as const;

export default function Settings() {
  const { i18n, t } = useTranslation();
  const [language, setLanguage] = useLocalStorage("language", "en-US");
  const [provider, setProvider] = useAPIProvider();
  const [keys, setKeys] = useAPIKeys();
  const [host, setHost] = useAPIHost();
  const [temperature, setTemperature] = useTemperature();
  const [delay, setDelay] = useDelay();
  const [prompt, setPrompt] = usePrompt();
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [connectionMessage, setConnectionMessage] = useState("");
  const connectionRequestRef = useRef(0);
  const [multiLangSave, setMultiLangSave] = useLocalStorage(
    "multi_language_save",
    "none"
  );
  const apiKey = keys.find((key) => key.trim().length > 0)?.trim() || "";
  const normalizedApiHost = host.trim();

  const changeLanguage = async (nextLanguage: string) => {
    setLanguage(nextLanguage);
    await i18n.changeLanguage(nextLanguage);
  };

  const changeProvider = (nextProvider: keyof typeof providerPresets) => {
    setProvider(nextProvider);
    const nextHost = providerPresets[nextProvider].host;
    if (nextHost) setHost(nextHost);
  };

  useEffect(() => {
    connectionRequestRef.current += 1;
    setConnectionStatus("idle");
    setConnectionMessage("");
  }, [apiKey, normalizedApiHost, provider]);

  const testConnection = async () => {
    const requestId = ++connectionRequestRef.current;

    if (!apiKey || !normalizedApiHost) {
      setConnectionStatus("error");
      setConnectionMessage(t("api.connection.missing"));
      return;
    }

    if (typeof window.electronAPI?.listModels !== "function") {
      setConnectionStatus("error");
      setConnectionMessage(t("api.connection.unavailable"));
      return;
    }

    setConnectionStatus("loading");
    setConnectionMessage("");

    try {
      const models = await window.electronAPI.listModels({
        apiKey,
        apiHost: normalizedApiHost,
      });

      if (connectionRequestRef.current !== requestId) return;

      setConnectionStatus("success");
      setConnectionMessage(
        models.length > 0
          ? t("api.connection.success", { count: models.length })
          : t("api.connection.successEmpty")
      );
    } catch (error: unknown) {
      if (connectionRequestRef.current !== requestId) return;

      setConnectionStatus("error");
      setConnectionMessage(t(getConnectionErrorKey(error)));
    }
  };

  const resetAll = () => {
    if (confirm("這將清除所有設定並恢復預設值，確定要繼續嗎？")) {
      localStorage.clear();
      window.location.reload();
    }
  };

  return (
    <SheetContent side="right" className="w-full gap-0 overflow-hidden p-0 sm:max-w-xl">
      <SheetHeader className="border-b px-6 py-5 pr-14">
        <SheetTitle className="text-2xl">設定</SheetTitle>
        <SheetDescription>管理介面、API 與翻譯相關工具。</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <FieldGroup>
          <div>
            <h2 className="font-heading text-lg font-semibold">介面</h2>
            <p className="mt-1 text-sm text-muted-foreground">選擇介面語言與工作偏好。</p>
          </div>
          <Field>
            <FieldLabel>語言</FieldLabel>
            <Select value={language} onValueChange={(value) => void changeLanguage(value)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="zh-TW">繁體中文</SelectItem>
                <SelectItem value="zh-CN">简体中文</SelectItem>
                <SelectItem value="en-US">English</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Separator className="my-2" />

          <div>
            <h2 className="font-heading text-lg font-semibold">API 連線</h2>
            <p className="mt-1 text-sm text-muted-foreground">金鑰只會儲存在本機瀏覽器儲存空間。</p>
          </div>
          <Field>
            <FieldLabel>供應商</FieldLabel>
            <Select value={provider} onValueChange={(value) => changeProvider(value as keyof typeof providerPresets)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(providerPresets).map(([value, item]) => (
                  <SelectItem key={value} value={value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-api-key">API 金鑰</FieldLabel>
            <Input
              id="settings-api-key"
              type="password"
              value={keys[0] || ""}
              onChange={(event) => setKeys([event.target.value])}
              placeholder="sk-..."
              autoComplete="off"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-api-host">API 主機</FieldLabel>
            <Input id="settings-api-host" value={host} onChange={(event) => setHost(event.target.value)} />
          </Field>
          <Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => void testConnection()}
                disabled={
                  connectionStatus === "loading" ||
                  !apiKey ||
                  !normalizedApiHost
                }
                aria-busy={connectionStatus === "loading"}
              >
                {connectionStatus === "loading" ? (
                  <LoaderCircle data-icon="inline-start" className="animate-spin" />
                ) : (
                  <PlugZap data-icon="inline-start" />
                )}
                {connectionStatus === "loading"
                  ? t("api.connection.testing")
                  : t("api.connection.test")}
              </Button>
              {connectionMessage && (
                <p
                  className={`flex items-center gap-1.5 text-sm ${
                    connectionStatus === "success"
                      ? "text-emerald-700"
                      : "text-destructive"
                  }`}
                  role={connectionStatus === "error" ? "alert" : "status"}
                  aria-live="polite"
                >
                  {connectionStatus === "success" ? (
                    <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                  )}
                  {connectionMessage}
                </p>
              )}
            </div>
            {connectionStatus === "idle" && (!apiKey || !normalizedApiHost) && (
              <FieldDescription>{t("api.connection.missing")}</FieldDescription>
            )}
          </Field>

          <Separator className="my-2" />

          <div>
            <h2 className="font-heading text-lg font-semibold">翻譯</h2>
            <p className="mt-1 text-sm text-muted-foreground">這些選項會套用到之後新增的任務。</p>
          </div>
          <Field>
            <FieldLabel>溫度</FieldLabel>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={temperature}
                onChange={(event) => setTemperature(Number(event.target.value))}
                className="w-full accent-primary"
              />
              <Input
                type="number"
                min="0"
                max="2"
                step="0.01"
                value={temperature}
                onChange={(event) => setTemperature(Number(event.target.value))}
                className="w-20"
              />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-delay">請求間隔（秒）</FieldLabel>
            <Input id="settings-delay" type="number" min="0" step="0.1" value={delay} onChange={(event) => setDelay(Number(event.target.value))} />
            <FieldDescription>在每次請求之間暫停，降低供應商限流風險。</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>雙語字幕</FieldLabel>
            <Select value={multiLangSave} onValueChange={setMultiLangSave}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">僅儲存翻譯字幕</SelectItem>
                <SelectItem value="translate+original">翻譯字幕 + 原文字幕</SelectItem>
                <SelectItem value="original+translate">原文字幕 + 翻譯字幕</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-prompt">翻譯提示詞</FieldLabel>
            <Textarea id="settings-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-52 resize-y" />
            <FieldDescription>保留 <code>{"{{lang}}"}</code> 與 <code>{"{{additional}}"}</code> 變數，新增任務時會自動帶入。</FieldDescription>
          </Field>

          <Separator className="my-2" />

          <div className="flex items-center justify-between gap-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
            <div className="flex min-w-0 gap-3">
              <AlertTriangle className="mt-0.5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium">重設所有設定</p>
                <p className="mt-1 text-sm text-muted-foreground">清除本機儲存的 API、任務與翻譯偏好。</p>
              </div>
            </div>
            <Button variant="destructive" size="sm" onClick={resetAll}>
              <RotateCcw data-icon="inline-start" />
              重設
            </Button>
          </div>
        </FieldGroup>
      </div>
    </SheetContent>
  );
}
