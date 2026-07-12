import { i18n as linguiI18n, type MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react";
import { messages as messageDescriptors } from "./i18n-messages";

export const i18n = linguiI18n;
export const defaultLocale = "en-US" as const;
export const locales = ["en-US", "zh-TW", "zh-CN"] as const;
export type Locale = (typeof locales)[number];

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
