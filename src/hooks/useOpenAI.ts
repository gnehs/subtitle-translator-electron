import { Configuration, OpenAIApi } from "openai";
import { useLocalStorage } from "usehooks-ts";
export function createChatCompletion() {
  const [apiKeys] = useAPIKeys();
  const [apiHost] = useAPIHost();
  //@ts-ignore
  let openAIInstance = [];
  for (let apiKey of apiKeys) {
    const configuration = new Configuration({ apiKey, basePath: apiHost });
    const openai = new OpenAIApi(configuration);
    openai.createChatCompletion;
    openAIInstance.push(openai);
  }
  //@ts-ignore
  return function createChatCompletion(i, ...args) {
    //@ts-ignore
    return openAIInstance[i % openAIInstance.length].createChatCompletion(
      ...args
    );
  };
}
export function useAPIKeys() {
  return useLocalStorage("api_keys", [""]);
}
export function useAPIHost() {
  return useLocalStorage("api_host", "https://api.openai.com/v1");
}
