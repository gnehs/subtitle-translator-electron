import { useLocalStorage } from "usehooks-ts";

export default function useDelay() {
  const [storedDelay, setStoredDelay] = useLocalStorage("delay", 1);
  const delay = Number.isFinite(storedDelay) ? Math.max(0, storedDelay) : 1;

  return [
    delay,
    (nextDelay: number) =>
      setStoredDelay(Number.isFinite(nextDelay) ? Math.max(0, nextDelay) : 1),
  ] as const;
}
