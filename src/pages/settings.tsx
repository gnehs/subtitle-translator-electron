import { useEffect, useRef, useState } from "react";
import { dynamicActivate, useTranslation } from "@/i18n";
import { useLocalStorage } from "usehooks-ts";
import {
  useAPIHost,
  useAPIKeys,
  useAPIProvider,
  useTemperature,
} from "@/hooks/useOpenAI";
import useDelay from "@/hooks/useDelay";
import useRPM from "@/hooks/useRPM";
import useTranslationConcurrency from "@/hooks/useTranslationConcurrency";
import usePrompt from "@/hooks/usePrompt";
import useAdaptivePrompt from "@/hooks/useAdaptivePrompt";
import useTranslationMode from "@/hooks/useTranslationMode";
import {
  translationConcurrencyOptions,
  type SubtitleOutputFormat,
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
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import FontPicker from "@/components/FontPicker";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileOutput,
  Gauge,
  Info,
  Languages,
  LoaderCircle,
  MessageSquareText,
  PlugZap,
  RotateCcw,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ConnectionStatus = "idle" | "loading" | "success" | "error";
type SettingsSection =
  "general" | "api" | "translation" | "output" | "performance" | "advanced";

const subtitleOutputFormats: readonly SubtitleOutputFormat[] = [
  "srt-translation",
  "srt-bilingual",
  "srt-original-translation",
  "ass-bilingual",
  "ass-original-translation",
];
const adaptiveOutputFormats: readonly SubtitleOutputFormat[] = [
  "srt-translation",
  "ass-bilingual",
];

function getLegacyOutputFormat(): SubtitleOutputFormat {
  if (typeof window === "undefined") return "srt-translation";

  try {
    const stored = window.localStorage.getItem("subtitle_output_format");
    if (!stored) return "srt-translation";
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      parsed = stored;
    }
    return typeof parsed === "string" &&
      subtitleOutputFormats.includes(parsed as SubtitleOutputFormat)
      ? (parsed as SubtitleOutputFormat)
      : "srt-translation";
  } catch {
    return "srt-translation";
  }
}

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
  if (
    /valid URL|HTTP or HTTPS|HTTPS unless|contain credentials/i.test(message)
  ) {
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
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("general");
  const [language, setLanguage] = useLocalStorage("language", "en-US");
  const [provider, setProvider] = useAPIProvider();
  const [keys, setKeys] = useAPIKeys();
  const [host, setHost] = useAPIHost();
  const [temperature, setTemperature] = useTemperature();
  const [delay, setDelay] = useDelay();
  const [requestsPerMinute, setRequestsPerMinute] = useRPM();
  const [concurrency, setConcurrency] = useTranslationConcurrency();
  const [strictPrompt, setStrictPrompt] = usePrompt();
  const [adaptivePrompt, setAdaptivePrompt] = useAdaptivePrompt();
  const [mode, setMode] = useTranslationMode();
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [connectionMessage, setConnectionMessage] = useState("");
  const connectionRequestRef = useRef(0);
  const [strictOutputFormat, setStrictOutputFormat] =
    useLocalStorage<SubtitleOutputFormat>(
      "strict_output_format",
      getLegacyOutputFormat,
    );
  const [adaptiveOutputFormat, setAdaptiveOutputFormat] =
    useLocalStorage<SubtitleOutputFormat>(
      "adaptive_output_format",
      "srt-translation",
    );
  const [assTranslationFont, setAssTranslationFont] = useLocalStorage(
    "ass_translation_font",
    "",
  );
  const [assOriginalFont, setAssOriginalFont] = useLocalStorage(
    "ass_original_font",
    "",
  );
  const apiKey = keys.find((key) => key.trim().length > 0)?.trim() || "";
  const normalizedApiHost = host.trim();
  const outputFormat =
    mode === "adaptive" ? adaptiveOutputFormat : strictOutputFormat;
  const prompt = mode === "adaptive" ? adaptivePrompt : strictPrompt;
  const setPrompt = mode === "adaptive" ? setAdaptivePrompt : setStrictPrompt;

  useEffect(() => {
    if (!adaptiveOutputFormats.includes(adaptiveOutputFormat)) {
      setAdaptiveOutputFormat("srt-translation");
    }
  }, [adaptiveOutputFormat, setAdaptiveOutputFormat]);

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
          : t("api.connection.successEmpty"),
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

  const sections = [
    {
      id: "general",
      title: t("settings.interface.title"),
      description: t("settings.interface.description"),
      icon: Languages,
    },
    {
      id: "api",
      title: t("settings.api.title"),
      description: t("settings.api.description"),
      icon: PlugZap,
    },
    {
      id: "translation",
      title: t("settings.translation.title"),
      description: t("settings.translation.description"),
      icon: MessageSquareText,
    },
    {
      id: "output",
      title: t("settings.output.title"),
      description: t("settings.output.description"),
      icon: FileOutput,
    },
    {
      id: "performance",
      title: t("settings.performance.title"),
      description: t("settings.performance.description"),
      icon: Gauge,
    },
    {
      id: "advanced",
      title: t("settings.advanced.title"),
      description: t("settings.advanced.description"),
      icon: Wrench,
    },
  ] as const;
  const currentSection = sections.find(
    (section) => section.id === activeSection,
  )!;

  return (
    <SheetContent
      side="right"
      className="max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
      style={{
        width: "min(58rem, calc(100vw - 5rem))",
        maxWidth: "none",
      }}
    >
      <div className="grid min-h-0 flex-1 grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r bg-sidebar text-sidebar-foreground">
          <div className="flex flex-col gap-1 px-5 pb-4 pt-6">
            <SheetTitle className="text-2xl">{t("settings")}</SheetTitle>
            <SheetDescription>{t("settings.description")}</SheetDescription>
          </div>
          <nav
            aria-label={t("settings.navigation.label")}
            className="flex flex-col gap-1 overflow-y-auto px-3 pb-5"
          >
            {sections.map((section) => {
              const Icon = section.icon;
              const isActive = section.id === activeSection;

              return (
                <Button
                  key={section.id}
                  type="button"
                  variant={isActive ? "secondary" : "ghost"}
                  size="lg"
                  className="h-11 w-full justify-start px-3 text-left"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setActiveSection(section.id)}
                >
                  <Icon data-icon="inline-start" />
                  {section.title}
                </Button>
              );
            })}
          </nav>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col bg-background">
          <SheetHeader className="border-b px-7 py-5 pr-14">
            <h2 className="font-heading text-xl font-semibold">
              {currentSection.title}
            </h2>
            <p className="text-sm text-muted-foreground">
              {currentSection.description}
            </p>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
            <FieldGroup>
              {activeSection === "general" && (
                <Field>
                  <FieldLabel>{t("language")}</FieldLabel>
                  <Select
                    value={language}
                    onValueChange={(value) => void changeLanguage(value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="zh-TW">繁體中文</SelectItem>
                        <SelectItem value="zh-CN">简体中文</SelectItem>
                        <SelectItem value="en-US">English</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {activeSection === "api" && (
                <>
                  <aside className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
                    <Info
                      className="mt-0.5 size-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <p className="text-muted-foreground">
                      {t("api.presets.recommendation")}
                    </p>
                  </aside>
                  <Field>
                    <FieldLabel>{t("settings.provider")}</FieldLabel>
                    <Select
                      value={provider}
                      onValueChange={(value) =>
                        changeProvider(value as keyof typeof providerPresets)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {Object.entries(providerPresets).map(
                            ([value, item]) => (
                              <SelectItem key={value} value={value}>
                                {t(item.label)}
                              </SelectItem>
                            ),
                          )}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="settings-api-key">
                      {t("api.key.name")}
                    </FieldLabel>
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
                    <FieldLabel htmlFor="settings-api-host">
                      {t("api.host.name")}
                    </FieldLabel>
                    <Input
                      id="settings-api-host"
                      value={host}
                      onChange={(event) => setHost(event.target.value)}
                    />
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
                          <LoaderCircle
                            data-icon="inline-start"
                            className="animate-spin"
                          />
                        ) : (
                          <PlugZap data-icon="inline-start" />
                        )}
                        {connectionStatus === "loading"
                          ? t("api.connection.testing")
                          : t("api.connection.test")}
                      </Button>
                      {connectionMessage && (
                        <p
                          className={cn(
                            "flex items-center gap-1.5 text-sm",
                            connectionStatus === "success"
                              ? "text-foreground"
                              : "text-destructive",
                          )}
                          role={
                            connectionStatus === "error" ? "alert" : "status"
                          }
                          aria-live="polite"
                        >
                          {connectionStatus === "success" ? (
                            <CheckCircle2
                              className="size-4 shrink-0"
                              aria-hidden="true"
                            />
                          ) : (
                            <AlertCircle
                              className="size-4 shrink-0"
                              aria-hidden="true"
                            />
                          )}
                          {connectionMessage}
                        </p>
                      )}
                    </div>
                    {connectionStatus === "idle" &&
                      (!apiKey || !normalizedApiHost) && (
                        <FieldDescription>
                          {t("api.connection.missing")}
                        </FieldDescription>
                      )}
                  </Field>
                </>
              )}

              {activeSection === "translation" && (
                <>
                  <Field>
                    <FieldLabel htmlFor="settings-translation-mode">
                      {t("settings.mode.label")}
                    </FieldLabel>
                    <Select
                      value={mode}
                      onValueChange={(value) => setMode(value as typeof mode)}
                    >
                      <SelectTrigger
                        id="settings-translation-mode"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="strict">
                            {t("settings.mode.strict")}
                          </SelectItem>
                          <SelectItem value="adaptive">
                            {t("settings.mode.adaptive")}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      {mode === "adaptive"
                        ? t("settings.mode.adaptiveDescription")
                        : t("settings.mode.strictDescription")}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>{t("temperature.title")}</FieldLabel>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.01"
                        value={temperature}
                        onChange={(event) =>
                          setTemperature(Number(event.target.value))
                        }
                        className="w-full accent-primary"
                      />
                      <Input
                        type="number"
                        min="0"
                        max="2"
                        step="0.01"
                        value={temperature}
                        onChange={(event) =>
                          setTemperature(Number(event.target.value))
                        }
                        className="w-20"
                      />
                    </div>
                    <FieldDescription>
                      {t("temperature.description")}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="settings-prompt">
                      {mode === "adaptive"
                        ? t("settings.prompt.adaptiveLabel")
                        : t("settings.prompt.strictLabel")}
                    </FieldLabel>
                    <Textarea
                      id="settings-prompt"
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      className="min-h-52 resize-y"
                    />
                    <FieldDescription>
                      {t(
                        mode === "adaptive"
                          ? "settings.prompt.adaptiveDescription"
                          : "settings.prompt.strictDescription",
                        {
                          lang: "{{lang}}",
                          additional: "{{additional}}",
                        },
                      )}
                    </FieldDescription>
                  </Field>
                </>
              )}

              {activeSection === "performance" && (
                <>
                  <Field>
                    <FieldLabel htmlFor="settings-delay">
                      {t("settings.delay.label")}
                    </FieldLabel>
                    <Input
                      id="settings-delay"
                      type="number"
                      min="0"
                      step="0.1"
                      value={delay}
                      onChange={(event) => setDelay(Number(event.target.value))}
                    />
                    <FieldDescription>
                      {t("settings.delay.description")}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="settings-rpm">
                      {t("settings.rpm.label")}
                    </FieldLabel>
                    <Input
                      id="settings-rpm"
                      type="number"
                      min="1"
                      max="100000"
                      step="1"
                      value={requestsPerMinute}
                      onChange={(event) =>
                        setRequestsPerMinute(Number(event.target.value))
                      }
                    />
                    <FieldDescription>
                      {t("settings.rpm.description")}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="settings-concurrency">
                      {t("settings.concurrency.label")}
                    </FieldLabel>
                    <Select
                      value={String(concurrency)}
                      onValueChange={(value) =>
                        setConcurrency(Number(value) as TranslationConcurrency)
                      }
                    >
                      <SelectTrigger
                        id="settings-concurrency"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {translationConcurrencyOptions.map((option) => (
                            <SelectItem key={option} value={String(option)}>
                              {option === 1
                                ? t("settings.concurrency.options.sequential")
                                : t("settings.concurrency.options.parallel", {
                                    count: option,
                                  })}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      {t("settings.concurrency.description")}
                    </FieldDescription>
                  </Field>
                </>
              )}

              {activeSection === "output" && (
                <>
                  <Field>
                    <FieldLabel>{t("tasks.output.label")}</FieldLabel>
                    <Select
                      value={outputFormat}
                      onValueChange={(value) => {
                        const nextFormat = value as SubtitleOutputFormat;
                        if (mode === "adaptive")
                          setAdaptiveOutputFormat(nextFormat);
                        else setStrictOutputFormat(nextFormat);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>SRT</SelectLabel>
                          <SelectItem value="srt-translation">
                            {t("tasks.output.srtTranslation")}
                          </SelectItem>
                          {mode === "strict" && (
                            <>
                              <SelectItem value="srt-bilingual">
                                {t("tasks.output.srtBilingual")}
                              </SelectItem>
                              <SelectItem value="srt-original-translation">
                                {t("tasks.output.srtOriginalTranslation")}
                              </SelectItem>
                            </>
                          )}
                        </SelectGroup>
                        <SelectSeparator />
                        <SelectGroup>
                          <SelectLabel>ASS</SelectLabel>
                          <SelectItem value="ass-bilingual">
                            {t("tasks.output.assBilingual")}
                          </SelectItem>
                          {mode === "strict" && (
                            <SelectItem value="ass-original-translation">
                              {t("tasks.output.assOriginalTranslation")}
                            </SelectItem>
                          )}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      {mode === "adaptive"
                        ? t("tasks.output.adaptiveLocked")
                        : t("tasks.output.description")}
                    </FieldDescription>
                  </Field>
                  {outputFormat.startsWith("ass-") && (
                    <>
                      <Field>
                        <FieldLabel htmlFor="settings-ass-translation-font">
                          {t("tasks.output.translationFont")}
                        </FieldLabel>
                        <FontPicker
                          id="settings-ass-translation-font"
                          value={assTranslationFont}
                          onValueChange={setAssTranslationFont}
                          placeholder={t("tasks.output.fontPlaceholder")}
                          useDefaultLabel={t("tasks.output.fontUseDefault")}
                          searchPlaceholder={t("tasks.output.fontSearch")}
                          loadingLabel={t("tasks.output.fontLoading")}
                          emptyLabel={t("tasks.output.fontEmpty")}
                          unavailableLabel={t("tasks.output.fontUnavailable")}
                        />
                        <FieldDescription>
                          {t("tasks.output.translationFontDescription")}
                        </FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="settings-ass-original-font">
                          {t("tasks.output.originalFont")}
                        </FieldLabel>
                        <FontPicker
                          id="settings-ass-original-font"
                          value={assOriginalFont}
                          onValueChange={setAssOriginalFont}
                          placeholder={t("tasks.output.fontPlaceholder")}
                          useDefaultLabel={t("tasks.output.fontUseDefault")}
                          searchPlaceholder={t("tasks.output.fontSearch")}
                          loadingLabel={t("tasks.output.fontLoading")}
                          emptyLabel={t("tasks.output.fontEmpty")}
                          unavailableLabel={t("tasks.output.fontUnavailable")}
                        />
                        <FieldDescription>
                          {t("tasks.output.originalFontDescription")}
                        </FieldDescription>
                      </Field>
                    </>
                  )}
                </>
              )}

              {activeSection === "advanced" && (
                <div className="flex items-center justify-between gap-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
                  <div className="flex min-w-0 gap-3">
                    <AlertTriangle className="mt-0.5 shrink-0 text-destructive" />
                    <div>
                      <p className="font-medium">{t("reset.name")}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("settings.reset.description")}
                      </p>
                    </div>
                  </div>
                  <Button variant="destructive" size="sm" onClick={resetAll}>
                    <RotateCcw data-icon="inline-start" />
                    {t("reset.title")}
                  </Button>
                </div>
              )}
            </FieldGroup>
          </div>
        </section>
      </div>
    </SheetContent>
  );
}
