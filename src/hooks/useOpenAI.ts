import { useLocalStorage } from "usehooks-ts";

export type APIProvider =
  | "openrouter"
  | "openai"
  | "vercel-gateway"
  | "openai-compatible";

export function useAPIKeys() {
  return useLocalStorage<string[]>("api_keys", [""]);
}

export function useAPIHost() {
  return useLocalStorage("api_host", "https://api.openai.com/v1");
}

export function useAPIProvider() {
  return useLocalStorage<APIProvider>("api_provider", "openai");
}

export function useTemperature() {
  const [storedTemperature, setStoredTemperature] = useLocalStorage(
    "ai_temperature",
    1
  );
  const normalize = (value: number) =>
    Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : 1;

  return [
    normalize(storedTemperature),
    (nextTemperature: number) =>
      setStoredTemperature(normalize(nextTemperature)),
  ] as const;
}
