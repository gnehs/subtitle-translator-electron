import { useLocalStorage } from "usehooks-ts";
export default function useModel() {
  return useLocalStorage("model", "gpt-4-turbo");
}
