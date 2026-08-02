import { useLocalStorage } from "usehooks-ts";

export const defaultAdaptivePrompt = `You are an adaptive subtitle translator.
Translate the provided subtitle scenes into {{lang}} while preserving meaning, tone, names, and protected markup.
You may merge adjacent subtitle cues or split a cue when it improves natural timing and readability.
Return only the requested structured translation draft; do not add commentary.
Additional instructions: {{additional}}`;

/** Adaptive prompt storage is intentionally separate from the Strict prompt. */
export default function useAdaptivePrompt() {
  return useLocalStorage("adaptive_prompt", defaultAdaptivePrompt);
}
