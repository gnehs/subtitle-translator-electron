import OpenAI from "openai";
import { useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import usePrompt from "./usePrompt";
import useModel from "./useModel";
export function useTranslate() {
  const [apiKeys] = useAPIKeys();
  const [apiHost] = useAPIHost();
  const [model] = useModel();
  const [prompt] = usePrompt();
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
        .replaceAll("{{lang}}", lang)
        .replaceAll("{{additional}}", additional);
      let modelName = {
        "gpt-4": "gpt-4-0613",
        "gpt-4-economy": "gpt-4-0613",
        "gpt-3.5-turbo": "gpt-3.5-turbo-instruct",
        "gpt-3.5-turbo-economy": "gpt-3.5-turbo-instruct",
      }[model]!;
      let res = await ai.chat.completions.create({
        model: modelName,
        tool_choice: {
          type: "function",
          function: { name: "setResult" },
        },
        tools: [
          {
            type: "function",
            function: {
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
                    },
                  },
                },
                required: ["result"],
              },
            },
          },
        ],
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
      });
      updateCost(res);
      return res;
    },
    translateSubtitleSingle: async function (subtitle: string) {
      let ai =
        openAIInstance[Math.floor(Math.random() * openAIInstance.length)];
      let presedPrompt = prompt
        .replaceAll("{{lang}}", lang)
        .replaceAll("{{additional}}", additional);
      let modelName = {
        "gpt-4": "gpt-4-0613",
        "gpt-4-economy": "gpt-4-0613",
        "gpt-3.5-turbo": "gpt-3.5-turbo-instruct",
        "gpt-3.5-turbo-economy": "gpt-3.5-turbo-instruct",
      }[model]!;
      let res = await ai.chat.completions.create({
        model: modelName,
        tool_choice: {
          type: "function",
          function: { name: "setResult" },
        },
        tools: [
          {
            type: "function",
            function: {
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
          },
        ],
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
