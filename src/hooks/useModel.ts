import { useLocalStorage } from "usehooks-ts";
export default function useModel() {
  return useLocalStorage("model", "gpt-3.5-turbo");
}
