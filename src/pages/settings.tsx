import { useEffect, useRef, useState } from "react";
import { dynamicActivate, useTranslation } from "@/i18n";
import { useLocalStorage } from "usehooks-ts";
import { useAPIHost, useAPIKeys, useAPIProvider, useTemperature } from "@/hooks/useOpenAI";
import useDelay from "@/hooks/useDelay";
import useRPM from "@/hooks/useRPM";
import useTranslationConcurrency from "@/hooks/useTranslationConcurrency";
import usePrompt from "@/hooks/usePrompt";
import {
  translationConcurrencyOptions,
  type TranslationConcurrency,
} from "@/types/electron-api";
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
  SelectGroup,
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
    label: "api.presets.openrouter",
    host: "https://openrouter.ai/api/v1",
  },
  openai: {
    label: "api.presets.openai",
    host: "https://api.openai.com/v1",
  },
  "vercel-gateway": {
    label: "api.presets.vercel_gateway",
    host: "https://ai-gateway.vercel.sh/v1",
  },
  "openai-compatible": {
    label: "api.presets.openai_compatible",
    host: "",
  },
} as const;

export default function Settings() {
  const { t } = useTranslation();
  const [language, setLanguage] = useLocalStorage("language", "en-US");
  const [provider, setProvider] = useAPIProvider();
  const [keys, setKeys] = useAPIKeys();
  const [host, setHost] = useAPIHost();
  const [temperature, setTemperature] = useTemperature();
  const [delay, setDelay] = useDelay();
  const [requestsPerMinute, setRequestsPerMinute] = useRPM();
  const [concurrency, setConcurrency] = useTranslationConcurrency();
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
    const activatedLocale = await dynamicActivate(nextLanguage);
    setLanguage(activatedLocale);
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
    if (confirm(t("reset.prompt"))) {
      localStorage.clear();
      window.location.reload();
    }
  };

  return (
    <SheetContent side="right" className="w-full gap-0 overflow-hidden p-0 sm:max-w-xl">
      <SheetHeader className="border-b px-6 py-5 pr-14">
        <SheetTitle className="text-2xl">{t("settings")}</SheetTitle>
        <SheetDescription>{t("settings.description")}</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <FieldGroup>
          <div>
            <h2 className="font-heading text-lg font-semibold">{t("settings.interface.title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("settings.interface.description")}</p>
          </div>
          <Field>
            <FieldLabel>{t("language")}</FieldLabel>
            <Select value={language} onValueChange={(value) => void changeLanguage(value)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="zh-TW">繁體中文</SelectItem>
                  <SelectItem value="zh-CN">简体中文</SelectItem>
                  <SelectItem value="en-US">English</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Separator className="my-2" />

          <div>
            <h2 className="font-heading text-lg font-semibold">{t("settings.api.title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("settings.api.description")}</p>
          </div>
          <Field>
            <FieldLabel>{t("settings.provider")}</FieldLabel>
            <Select value={provider} onValueChange={(value) => changeProvider(value as keyof typeof providerPresets)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {Object.entries(providerPresets).map(([value, item]) => (
                    <SelectItem key={value} value={value}>{t(item.label)}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-api-key">{t("api.key.name")}</FieldLabel>
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
            <FieldLabel htmlFor="settings-api-host">{t("api.host.name")}</FieldLabel>
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
            <h2 className="font-heading text-lg font-semibold">{t("settings.translation.title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("settings.translation.description")}</p>
          </div>
          <Field>
            <FieldLabel>{t("temperature.title")}</FieldLabel>
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
            <FieldDescription>{t("temperature.description")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-delay">{t("settings.delay.label")}</FieldLabel>
            <Input id="settings-delay" type="number" min="0" step="0.1" value={delay} onChange={(event) => setDelay(Number(event.target.value))} />
            <FieldDescription>{t("settings.delay.description")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-rpm">{t("settings.rpm.label")}</FieldLabel>
            <Input
              id="settings-rpm"
              type="number"
              min="1"
              max="100000"
              step="1"
              value={requestsPerMinute}
              onChange={(event) => setRequestsPerMinute(Number(event.target.value))}
            />
            <FieldDescription>{t("settings.rpm.description")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-concurrency">{t("settings.concurrency.label")}</FieldLabel>
            <Select
              value={String(concurrency)}
              onValueChange={(value) => setConcurrency(Number(value) as TranslationConcurrency)}
            >
              <SelectTrigger id="settings-concurrency" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {translationConcurrencyOptions.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option === 1
                        ? t("settings.concurrency.options.sequential")
                        : t("settings.concurrency.options.parallel", { count: option })}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>{t("settings.concurrency.description")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>{t("save.multi-language.name")}</FieldLabel>
            <Select value={multiLangSave} onValueChange={setMultiLangSave}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">{t("save.multi-language.options.none")}</SelectItem>
                  <SelectItem value="translate+original">{t("save.multi-language.options.translate+original")}</SelectItem>
                  <SelectItem value="original+translate">{t("save.multi-language.options.original+translate")}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-prompt">{t("settings.prompt.label")}</FieldLabel>
            <Textarea id="settings-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-52 resize-y" />
            <FieldDescription>
              {t("settings.prompt.description", {
                lang: "{{lang}}",
                additional: "{{additional}}",
              })}
            </FieldDescription>
          </Field>

          <Separator className="my-2" />

          <div className="flex items-center justify-between gap-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
            <div className="flex min-w-0 gap-3">
              <AlertTriangle className="mt-0.5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium">{t("reset.name")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("settings.reset.description")}</p>
              </div>
            </div>
            <Button variant="destructive" size="sm" onClick={resetAll}>
              <RotateCcw data-icon="inline-start" />
              {t("reset.title")}
            </Button>
          </div>
        </FieldGroup>
      </div>
    </SheetContent>
  );
}
