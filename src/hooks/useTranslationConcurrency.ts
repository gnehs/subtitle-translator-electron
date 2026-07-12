import { useLocalStorage } from "usehooks-ts";
import {
  translationConcurrencyOptions,
  type TranslationConcurrency,
} from "@/types/electron-api";

export default function useTranslationConcurrency() {
  const [storedConcurrency, setStoredConcurrency] = useLocalStorage<number>(
    "translation_concurrency",
    10
  );
  const concurrency = translationConcurrencyOptions.includes(
    storedConcurrency as TranslationConcurrency
  )
    ? (storedConcurrency as TranslationConcurrency)
    : 10;

  const setConcurrency = (nextConcurrency: TranslationConcurrency) => {
    setStoredConcurrency(nextConcurrency);
  };

  return [concurrency, setConcurrency] as const;
}
