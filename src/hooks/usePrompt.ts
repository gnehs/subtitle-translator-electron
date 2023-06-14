import { useLocalStorage } from "usehooks-ts";
export default function usePrompt(name: string) {
  let defaultPrompt = `Error`;
  if (name === "gpt-4") {
    defaultPrompt = `You are a program responsible for translating subtitles. Your task is to output the specified target language based on the input text. Please do not create the following subtitles on your own. Please only output the translation and reply in the same format as the original array. Target language: {{lang}}\n\n{{additional}}`;
  }
  if (name === "gpt-3.5-turbo") {
    defaultPrompt = `You are a program responsible for translating subtitles. Your task is to output the specified target language based on the input text. Please do not create the following subtitles on your own. Please do not output any text other than the translation. You will receive the subtitles as array that needs to be translated, as well as the previous translation results and next subtitle. If you need to merge the subtitles with the following line, simply repeat the translation. Please transliterate the person's name into the local language. Target language: {{lang}}\n\n{{additional}}`;
  }
  if (name === "gpt-3.5-turbo-economy") {
    defaultPrompt = `You are a program responsible for translating subtitles. Your task is to output the specified target language based on the input text. Please do not create the following subtitles on your own. Please do not output any text other than the translation. Target language: {{lang}}\n\n{{additional}}`;
  }
  return useLocalStorage(`prompt_${name}`, defaultPrompt);
}
