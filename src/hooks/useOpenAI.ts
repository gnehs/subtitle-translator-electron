import { Configuration, OpenAIApi } from "openai";
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

  //@ts-ignore
  let openAIInstance = [] as OpenAIApi[];
  for (let apiKey of apiKeys) {
    let configuration = new Configuration({ apiKey, basePath: apiHost });
    delete configuration.baseOptions.headers["User-Agent"];
    let openai = new OpenAIApi(configuration);
    openAIInstance.push(openai);
  }

  //@ts-ignore
  return async function translate(subtitles: array[]) {
    let ai = openAIInstance[Math.floor(Math.random() * openAIInstance.length)];
    let presedPrompt = prompt
      .replace("{{lang}}", lang)
      .replace("{{additional}}", additional);
    let modelName = {
      "gpt-4": "gpt-4-0613",
      "gpt-3.5-turbo": "gpt-3.5-turbo-0613",
      "gpt-3.5-turbo-economy": "gpt-3.5-turbo-0613",
    }[model]!;
    return await ai.createChatCompletion({
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
  };
}
export function useAPIKeys() {
  return useLocalStorage("api_keys", [""]);
}
export function useAPIHost() {
  return useLocalStorage("api_host", "https://api.openai.com/v1");
}
