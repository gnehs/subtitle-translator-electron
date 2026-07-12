import { i18n as linguiI18n, type MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react";
import { messages as messageDescriptors } from "./i18n-messages";
import {
  fallbackLocale,
  supportedLocales,
  type SupportedLocale,
} from "./utils/locale";

export const i18n = linguiI18n;
export const defaultLocale = fallbackLocale;
export const locales = supportedLocales;
export type Locale = SupportedLocale;

export const localeNames: Record<Locale, string> = {
  "en-US": "English",
  "zh-TW": "繁體中文",
  "zh-CN": "简体中文",
};

const catalogLoaders: Record<Locale, () => Promise<{ messages: Record<string, string> }>> = {
  "en-US": () => import("./locales/en-US.po"),
  "zh-TW": () => import("./locales/zh-TW.po"),
  "zh-CN": () => import("./locales/zh-CN.po"),
};

function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export async function dynamicActivate(locale: string): Promise<Locale> {
  const nextLocale = isLocale(locale) ? locale : defaultLocale;
  const { messages } = await catalogLoaders[nextLocale]();

  i18n.load(nextLocale, messages);
  i18n.activate(nextLocale);

  return nextLocale;
}

export function syncNativeMenuLocale(locale: Locale): void {
  if (
    typeof window === "undefined" ||
    typeof window.electronAPI?.setMenuLocale !== "function"
  ) {
    return;
  }

  void window.electronAPI.setMenuLocale(locale).catch((error: unknown) => {
    console.error("Failed to sync native menu locale:", error);
  });
}

function getMessageDescriptor(id: string): MessageDescriptor {
  return (
    (messageDescriptors as Record<string, MessageDescriptor>)[id] ?? {
      id,
      message: id,
    }
  );
}

export function useTranslation() {
  const { i18n: contextI18n } = useLingui();

  const t = (id: string, values?: Record<string, unknown>) =>
    contextI18n._(
      values
        ? { ...getMessageDescriptor(id), values }
        : getMessageDescriptor(id)
    );

  return { i18n: contextI18n, t };
}
