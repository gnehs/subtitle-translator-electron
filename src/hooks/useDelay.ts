import { useLocalStorage } from "usehooks-ts";
export default function useDelay() {
  return useLocalStorage("delay", 1);
}
