import { useCallback } from "react";
import { useLocalStorage } from "usehooks-ts";

export const TRANSLATION_SUCCESS_COUNT_KEY = "translation_success_count";
export const TRANSLATION_SUCCESS_THRESHOLD = 10;

export default function useTranslationSuccessCount() {
  const [count, setCount] = useLocalStorage(
    TRANSLATION_SUCCESS_COUNT_KEY,
    0
  );

  const increment = useCallback(() => {
    setCount((previousCount) =>
      Number.isFinite(previousCount) && previousCount >= 0
        ? Math.floor(previousCount) + 1
        : 1
    );
  }, [setCount]);

  return [count, increment] as const;
}
