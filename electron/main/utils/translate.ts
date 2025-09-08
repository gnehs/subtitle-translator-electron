import fs from "node:fs";
import path from "node:path";
import { parseSync, stringifySync } from "subtitle";
import assParser from "ass-parser";
import assStringify from "ass-stringify";
import { z } from "zod";
import { generateObject, generateText, tool } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

function splitIntoChunk(array: any[], by = 5) {
  let chunks = [];
  let chunk = [];
  for (let i = 0; i < array.length; i++) {
    if (array[i].data?.translatedText) continue;
    chunk.push(array[i]);
    if (chunk.length === by) {
      chunks.push(chunk);
      chunk = [];
    }
  }
  if (chunk.length > 0) {
    chunks.push(chunk);
  }
  return chunks;
}

async function translateSubtitleChunk(
  subtitles: string[],
  {
    apiKeys,
    apiHost,
    apiHeaders,
    model,
    prompt,
    lang,
    additional,
    temperature,
    compatibility,
  }: {
    apiKeys: string[];
    apiHost: string;
    apiHeaders: { name: string; value: string }[];
    model: string;
    prompt: string;
    lang: string;
    additional: string;
    temperature: number;
    compatibility: boolean;
  }
) {
  let openAIProviders = [];
  for (let apiKey of apiKeys) {
    if (apiKey.length > 0) {
      const provider = createOpenAICompatible({
        name: "openai",
        apiKey,
        baseURL: apiHost,
        fetch: async (url, init) => {
          const headers = new Headers(init?.headers || {});
          for (const h of apiHeaders || []) {
            if (h?.name) headers.set(h.name, h.value || "");
          }
          return fetch(url, { ...init, headers });
        },
      });
      openAIProviders.push(provider);
    }
  }

  if (openAIProviders.length === 0) {
    throw new Error("No valid API keys provided");
  }

  const ai =
    openAIProviders[Math.floor(Math.random() * openAIProviders.length)];
  const systemPrompt = prompt
    .replaceAll("{{lang}}", lang)
    .replaceAll("{{additional}}", additional);

  try {
    if (compatibility) {
      const { text } = await generateText({
        model: ai(model),
        temperature,
        system:
          systemPrompt + "\nReturn ONLY a JSON array of translated strings.",
        prompt: JSON.stringify(subtitles),
        maxRetries: 3,
      });
      return JSON.parse(text);
    }

    let toolTranslated: string[] | null = null;
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
      maxRetries: 2,
    });

    if (toolTranslated && Array.isArray(toolTranslated)) {
      return toolTranslated;
    }

    const { object } = await generateObject({
      model: ai(model),
      temperature,
      schema: z.array(z.string().describe("The translated subtitles")),
      prompt:
        systemPrompt +
        "\nOutput must be valid json. Respond with a JSON object that matches the schema. Return only JSON.\n\n" +
        JSON.stringify(subtitles),
      maxRetries: 3,
    });
    return object;
  } catch (e: any) {
    throw e;
  }
}

async function translateSubtitleSingle(
  subtitle: string,
  {
    apiKeys,
    apiHost,
    apiHeaders,
    model,
    prompt,
    lang,
    additional,
    temperature,
    compatibility,
  }: {
    apiKeys: string[];
    apiHost: string;
    apiHeaders: { name: string; value: string }[];
    model: string;
    prompt: string;
    lang: string;
    additional: string;
    temperature: number;
    compatibility: boolean;
  }
) {
  let openAIProviders = [];
  for (let apiKey of apiKeys) {
    if (apiKey.length > 0) {
      const provider = createOpenAICompatible({
        name: "openai",
        apiKey,
        baseURL: apiHost,
        fetch: async (url, init) => {
          const headers = new Headers(init?.headers || {});
          for (const h of apiHeaders || []) {
            if (h?.name) headers.set(h.name, h.value || "");
          }
          return fetch(url, { ...init, headers });
        },
      });
      openAIProviders.push(provider);
    }
  }

  if (openAIProviders.length === 0) {
    throw new Error("No valid API keys provided");
  }

  const ai =
    openAIProviders[Math.floor(Math.random() * openAIProviders.length)];
  const systemPrompt = prompt
    .replaceAll("{{lang}}", lang)
    .replaceAll("{{additional}}", additional);

  try {
    if (compatibility) {
      const { text } = await generateText({
        model: ai(model),
        temperature,
        system: systemPrompt + "\nReturn ONLY the translated text.",
        prompt: subtitle,
        maxRetries: 3,
      });
      return text;
    }

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
      toolChoice: "required",
      system:
        systemPrompt +
        "\nReturn ONLY using the tool, do not include any extra text.",
      prompt:
        "Translate the following subtitle. Return the result via the tool as plain text only.\n\n" +
        JSON.stringify(subtitle),
      maxRetries: 2,
    });

    if (typeof toolSingle === "string") {
      return toolSingle;
    }

    const { object } = await generateObject({
      model: ai(model),
      temperature,
      schema: z.object({ result: z.string() }),
      prompt:
        systemPrompt +
        "\nOutput must be valid json. Respond with a JSON object that matches the schema. Return only JSON.\n\n" +
        JSON.stringify(subtitle),
      maxRetries: 3,
    });
    return object.result;
  } catch (e: any) {
    throw e;
  }
}

function parseSubtitle(fileContent: string, fileExtension: string) {
  if (["srt", "vtt"].includes(fileExtension)) {
    return parseSync(fileContent);
  }
  if (["ass", "ssa"].includes(fileExtension)) {
    const parsedAssSubtitle = assParser(fileContent);
    const events = parsedAssSubtitle
      .filter((x: any) => x.section === "Events")[0]
      .body.filter(({ key }: any) => key === "Dialogue")
      .map((line: any) => {
        return {
          type: `cue`,
          data: {
            text: line.value.Text,
            start: line.value.Start,
            end: line.value.End,
          },
        };
      });
    return { full: parsedAssSubtitle, events };
  }
  throw new Error("Unsupported file extension");
}

function saveTranslated(
  outputPath: string,
  parsedSubtitle: any,
  fileExtension: string,
  multiLangSave: string = "none"
) {
  function parseTranslatedText(
    originalSubtitle: string = "",
    translatedText: string = "",
    splitText: string = "\n"
  ) {
    switch (multiLangSave) {
      case "none":
        return translatedText;
      case "translate+original":
        return `${translatedText}${splitText}${originalSubtitle}`;
      case "original+translate":
        return `${originalSubtitle}${splitText}${translatedText}`;
    }
  }

  let newSubtitle;
  if (["srt", "vtt"].includes(fileExtension)) {
    newSubtitle = stringifySync(
      parsedSubtitle.map((x) => {
        return {
          type: x.type,
          data: {
            ...x.data,
            text: parseTranslatedText(
              x.data.text,
              x.data.translatedText || x.data.text
            ),
          },
        };
      }),
      { format: "SRT" }
    );
  }

  if (["ass", "ssa"].includes(fileExtension)) {
    const { full, events } = parsedSubtitle;
    newSubtitle = assStringify(
      full.map((x: any) => {
        if (x.section === "Events") {
          x.body = x.body.map((line: any) => {
            if (line.key === "Dialogue") {
              const eventIndex = events.findIndex(
                (e: any) => e.data.text === line.value.Text
              );
              const translatedText =
                eventIndex >= 0
                  ? events[eventIndex].data.translatedText || line.value.Text
                  : line.value.Text;
              return {
                key: "Dialogue",
                value: {
                  ...line.value,
                  Text: parseTranslatedText(
                    line.value.Text,
                    translatedText,
                    "\\n"
                  ),
                },
              };
            }
            return line;
          });
        }
        return x;
      })
    );
  }

  fs.writeFileSync(outputPath, newSubtitle, "utf8");
}

export {
  translateSubtitleChunk,
  translateSubtitleSingle,
  parseSubtitle,
  saveTranslated,
  splitIntoChunk,
};
