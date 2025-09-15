import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import { generateObject, generateText, tool } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import usePrompt from "./usePrompt";
import useModel from "./useModel";
export function useTranslate() {
  const [apiKeys] = useAPIKeys();
  const [apiHost] = useAPIHost();
  const [model] = useModel();
  const [prompt] = usePrompt();
  const [lang] = useLocalStorage("translate_lang", "");
  const [additional] = useLocalStorage("translate_additional", "");
  const [temperature] = useTemperature();
  // token usage tracking removed per request

  //@ts-ignore
  let openAIProviders = [] as Array<ReturnType<typeof createOpenAICompatible>>;
  for (let apiKey of apiKeys) {
    const provider = createOpenAICompatible({
      name: "openai",
      apiKey,
      baseURL: apiHost,
    });
    openAIProviders.push(provider);
  }

  //@ts-ignore
  return {
    translateSubtitleChunk: async function (
      subtitles: Array<any>,
      opts?: { abortSignal?: AbortSignal }
    ) {
      const ai =
        openAIProviders[Math.floor(Math.random() * openAIProviders.length)];
      const systemPrompt = prompt
        .replaceAll("{{lang}}", lang)
        .replaceAll("{{additional}}", additional);

      try {
        // Prefer tool-calling with a forced tool to reduce failure rate
        let toolTranslated: Array<string> | null = null;
        const tools = {
          submit_translation: tool({
            description:
              "Provide the final translated subtitles. Keep order and length identical to input.",
            inputSchema: z
              .object({
                translated: z.array(
                  z.string().describe("Translated subtitle at the same index")
                ),
              })
              .strict(),
            execute: async ({ translated }) => {
              toolTranslated = translated;
              return JSON.stringify(translated);
            },
          }),
        } as const;

        await generateText({
          model: ai(model),
          temperature,
          tools,
          toolChoice: "required",
          system:
            systemPrompt +
            "\nReturn ONLY using the tool, do not include any extra text.",
          prompt:
            "Translate the following subtitles. Return the result via the tool as an array of strings with the exact same length and order as input.\n\n" +
            JSON.stringify(subtitles),
          abortSignal: opts?.abortSignal,
          maxRetries: 2,
        });

        if (toolTranslated && Array.isArray(toolTranslated)) {
          return { translated: toolTranslated } as any;
        }

        const { object } = await generateObject({
          model: ai(model),
          temperature,
          schema: z.array(z.string().describe("The translated subtitles")),
          prompt:
            systemPrompt +
            "\nOutput must be valid json. Respond with a JSON object that matches the schema. Return only JSON.\n\n" +
            JSON.stringify(subtitles),
          abortSignal: opts?.abortSignal,
          maxRetries: 3,
        });
        return { translated: object } as any;
      } catch (e: any) {
        // bubble up details for UI to stop translation with context
        throw e;
      }
    },
    translateSubtitleSingle: async function (
      subtitle: string,
      opts?: { abortSignal?: AbortSignal }
    ) {
      const ai =
        openAIProviders[Math.floor(Math.random() * openAIProviders.length)];
      const systemPrompt = prompt
        .replaceAll("{{lang}}", lang)
        .replaceAll("{{additional}}", additional);

      try {
        // Prefer tool-calling with a forced tool to reduce failure rate
        let toolSingle: string | null = null;
        const tools = {
          submit_single_translation: tool({
            description: "Provide the final translated text only.",
            inputSchema: z.object({ result: z.string() }).strict(),
            execute: async ({ result }) => {
              toolSingle = result;
              return result;
            },
          }),
        } as const;

        await generateText({
          model: ai(model),
          temperature,
          tools,
          // @ts-ignore
          toolChoice: "required",
          system:
            systemPrompt +
            "\nReturn ONLY using the tool, do not include any extra text.",
          prompt:
            "Translate the following subtitle. Return the result via the tool as plain text only.\n\n" +
            JSON.stringify(subtitle),
          abortSignal: opts?.abortSignal,
          maxRetries: 2,
        });

        if (typeof toolSingle === "string") {
          return { translated: toolSingle } as any;
        }

        const { object } = await generateObject({
          model: ai(model),
          temperature,
          schema: z.object({ result: z.string() }),
          prompt:
            systemPrompt +
            "\nOutput must be valid json. Respond with a JSON object that matches the schema. Return only JSON.\n\n" +
            JSON.stringify(subtitle),
          abortSignal: opts?.abortSignal,
          maxRetries: 3,
        });
        return { translated: object.result } as any;
      } catch (e: any) {
        throw e;
      }
    },
  };
}
export function useAPIKeys() {
  return useLocalStorage("api_keys", [""]);
}
export function useAPIHost() {
  return useLocalStorage("api_host", "https://api.openai.com/v1");
}
export function useTemperature() {
  return useLocalStorage("ai_temperature", 1);
}
