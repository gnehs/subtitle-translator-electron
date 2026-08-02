import { useLocalStorage } from "usehooks-ts";
import {
  translationModes,
  type TranslationMode,
} from "@/types/electron-api";

function isTranslationMode(value: unknown): value is TranslationMode {
  return (
    typeof value === "string" &&
    (translationModes as readonly string[]).includes(value)
  );
}

function deserializeTranslationMode(value: string): TranslationMode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = value;
  }
  return isTranslationMode(parsed) ? parsed : "strict";
}

/** Persist the task mode while treating invalid or legacy values as Strict. */
export default function useTranslationMode() {
  return useLocalStorage<TranslationMode>("translation_mode", "strict", {
    deserializer: deserializeTranslationMode,
  });
}
