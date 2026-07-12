import { useLocalStorage } from "usehooks-ts";

export default function useRPM() {
  return useLocalStorage("requests_per_minute", 60);
}
