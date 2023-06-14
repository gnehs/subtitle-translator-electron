import { Configuration, OpenAIApi } from "openai";
import { useLocalStorage } from "usehooks-ts";
import usePrompt from "./usePrompt";
import useModel from "./useModel";
export function translate() {
  const [apiKeys] = useAPIKeys();
  const [apiHost] = useAPIHost();
  const [model] = useModel();
  const [prompt] = usePrompt(model);
  const [lang] = useLocalStorage("translate_lang", "");
  const [additional] = useLocalStorage("translate_additional", "");

  //@ts-ignore
  let openAIInstance = [];
  for (let apiKey of apiKeys) {
    const configuration = new Configuration({ apiKey, basePath: apiHost });
    const openai = new OpenAIApi(configuration);
    openAIInstance.push(openai);
  }
  const getRandomInstance = () => {
    //@ts-ignore
    return openAIInstance[
      Math.floor(Math.random() * openAIInstance.length)
    ] as OpenAIApi;
  };

  //@ts-ignore
  return async function translate(i: number, subtitles: array[string]) {
    let { createChatCompletion } = getRandomInstance();
    let presedPrompt = prompt
      .replace("{{lang}}", lang)
      .replace("{{additional}}", additional);
    return await createChatCompletion({
      model: "gpt-3.5-turbo",
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
  };
}
export function useAPIKeys() {
  return useLocalStorage("api_keys", [""]);
}
export function useAPIHost() {
  return useLocalStorage("api_host", "https://api.openai.com/v1");
}
