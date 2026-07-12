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
  return useLocalStorage<APIProvider>("api_provider", "openrouter");
}

export function useTemperature() {
  return useLocalStorage("ai_temperature", 1);
}
