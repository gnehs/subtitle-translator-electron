import { useLocalStorage } from "usehooks-ts";

export default function useRPM() {
  const [storedRpm, setStoredRpm] = useLocalStorage(
    "requests_per_minute",
    60
  );
  const normalize = (value: number) =>
    Number.isSafeInteger(value)
      ? Math.min(100_000, Math.max(1, value))
      : 60;

  return [
    normalize(storedRpm),
    (nextRpm: number) => setStoredRpm(normalize(nextRpm)),
  ] as const;
}
