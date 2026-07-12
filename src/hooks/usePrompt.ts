import { useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";

const legacyDefaultPrompt = `// You are a professional subtitle translator.
// You will only receive subtitles and are only required to translate, no need for any replies.
// Note: {{additional}}
// Do not merge sentences, translate them individually.
// Return the translated subtitles in the same order and length as the input.
// 1. Parse the input subtitles
// 2. Translate the input subtitles into {{lang}}
// 3. Convert names into {{lang}}
// 4. Paraphrase the translated subtitles into more fluent sentences
// 5. Use the setResult method to output the translated subtitles as string[]`;

const defaultPrompt = `You are a professional subtitle translator.
Translate each subtitle into {{lang}} without merging separate subtitles.
Preserve meaning, tone, names, and subtitle markup while writing natural dialogue.
Additional instructions: {{additional}}`;

export default function usePrompt() {
  const [prompt, setPrompt] = useLocalStorage("prompt", defaultPrompt);

  useEffect(() => {
    if (prompt === legacyDefaultPrompt) setPrompt(defaultPrompt);
  }, [prompt, setPrompt]);

  return [prompt, setPrompt] as const;
}
