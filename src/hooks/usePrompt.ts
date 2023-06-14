import { useLocalStorage } from "usehooks-ts";
export default function usePrompt(name: string) {
  let defaultPrompt = `Error`;
  if (name === "gpt-4") {
    defaultPrompt = `You are a program responsible for translating subtitles. Your task is to output the specified target language based on the input text. Please do not create the following subtitles on your own. Use setResult function to return the result. Target language: {{lang}}\n\n{{additional}}`;
  }
  if (name === "gpt-3.5-turbo") {
    defaultPrompt = `You are a program responsible for translating subtitles. Your task is to output the specified target language based on the input text. Please do not create the following subtitles on your own. Please transliterate the person's name into the local language. Use setResult function to return the result. Target language: {{lang}}\n\n{{additional}}`;
  }
  if (name === "gpt-3.5-turbo-economy") {
    defaultPrompt = `You are a program responsible for translating subtitles. Your task is to output the specified target language based on the input text. Please do not create the following subtitles on your own.  Use setResult function to return the result. Target language: {{lang}}\n\n{{additional}}`;
  }
  return useLocalStorage(`prompt_${name}`, defaultPrompt);
}
