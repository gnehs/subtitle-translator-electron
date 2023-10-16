import OpenAI from "openai";
import { useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import usePrompt from "./usePrompt";
import useModel from "./useModel";
export function useTranslate() {
  const [apiKeys] = useAPIKeys();
  const [apiHost] = useAPIHost();
  const [model] = useModel();
  const [prompt] = usePrompt(model);
  const [lang] = useLocalStorage("translate_lang", "");
  const [additional] = useLocalStorage("translate_additional", "");

  const [usedInputTokens, setUsedInputTokens] = useState<number>(0);
  const [usedOutputTokens, setUsedOutputTokens] = useState<number>(0);
  const [usedDollars, setUsedDollars] = useState<number>(0);
  function updateCost(res: any) {
    let inputToken = res?.usage?.prompt_tokens!;
    let inputCost = 0.0015;
    let outputToken = res?.usage?.completion_tokens!;
    let outputCost = 0.002;
    if (model === "gpt-4") {
      inputCost = 0.03;
      outputCost = 0.06;
    }
    setUsedInputTokens((usedInputTokens) => usedInputTokens + inputToken);
    setUsedOutputTokens((usedOutputTokens) => usedOutputTokens + outputToken);
    setUsedDollars(
      (usedDollars) =>
        usedDollars +
        (inputToken / 1000) * inputCost +
        (outputToken / 1000) * outputCost
    );
  }

  //@ts-ignore
  let openAIInstance = [] as Array<OpenAI>;
  for (let apiKey of apiKeys) {
    let openai = new OpenAI({
      apiKey,
      baseURL: apiHost,
      dangerouslyAllowBrowser: true,
    });
    openAIInstance.push(openai);
  }

  //@ts-ignore
  return {
    usedInputTokens,
    usedOutputTokens,
    usedDollars,
    translateSubtitleChunk: async function (subtitles: Array<any>) {
      let ai =
        openAIInstance[Math.floor(Math.random() * openAIInstance.length)];
      let presedPrompt = prompt
        .replace("{{lang}}", lang)
        .replace("{{additional}}", additional);
      let modelName = {
        "gpt-4": "gpt-4-0613",
        "gpt-3.5-turbo": "gpt-3.5-turbo-0613",
        "gpt-3.5-turbo-economy": "gpt-3.5-turbo-0613",
      }[model]!;
      let res = await ai.chat.completions.create({
        model: modelName,
        messages: [
          {
            role: "system",
            content: presedPrompt,
          },
          {
            role: "user",
            content: JSON.stringify(subtitles),
          },
        ],
        functions: [
          {
            name: "setResult",
            description: "Sets the result of the translation",
            parameters: {
              type: "object",
              properties: {
                result: {
                  type: "array",
                  description: "The translated subtitles",
                  items: {
                    type: "string",
                    description: "A subtitle",
                  },
                },
              },
              required: ["result"],
            },
          },
        ],
      });
      updateCost(res);
      return res;
    },
    translateSubtitleSingle: async function (subtitle: string) {
      let ai =
        openAIInstance[Math.floor(Math.random() * openAIInstance.length)];
      let presedPrompt =
        `prompt: You are a program responsible for translating subtitles. Your task is to output the specified target language based on the input text. Please do not create the following subtitles on your own. Use setResult function to return the result. Target language: {{lang}}\n\n{{additional}}`
          .replace("{{lang}}", lang)
          .replace("{{additional}}", additional);
      let modelName = {
        "gpt-4": "gpt-4-0613",
        "gpt-3.5-turbo": "gpt-3.5-turbo-0613",
        "gpt-3.5-turbo-economy": "gpt-3.5-turbo-0613",
      }[model]!;
      let res = await ai.chat.completions.create({
        model: modelName,
        messages: [
          {
            role: "system",
            content: presedPrompt,
          },
          {
            role: "user",
            content: subtitle,
          },
        ],
        functions: [
          {
            name: "setResult",
            description: "Sets the result of the translation",
            parameters: {
              type: "object",
              properties: {
                result: {
                  type: "string",
                  description: "The translated subtitle",
                },
              },
              required: ["result"],
            },
          },
        ],
      });
      updateCost(res);
      return res;
    },
  };
}
export function useAPIKeys() {
  return useLocalStorage("api_keys", [""]);
}
export function useAPIHost() {
  return useLocalStorage("api_host", "https://api.openai.com/v1");
}
