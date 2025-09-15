import fs from "node:fs";
import path from "node:path";
import { parseSync, stringifySync } from "subtitle";
import assParser from "ass-parser";
import assStringify from "ass-stringify";
import { z } from "zod";
import { generateObject, generateText, tool } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

function getAi({ apiKey, apiHost }: { apiKey: string; apiHost: string }) {
  return createOpenAICompatible({
    name: "openai",
    apiKey: apiKey,
    baseURL: apiHost,
    headers: {
      // OpenRouter Headers
      "HTTP-Referer": "https://github.com/gnehs/subtitle-translator-electron",
      "X-Title": "Subtitle Translator",
    },
  });
}

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
    model,
    prompt,
    lang,
    additional,
    temperature,
  }: {
    apiKeys: string[];
    apiHost: string;
    model: string;
    prompt: string;
    lang: string;
    additional: string;
    temperature: number;
  }
) {
  if (apiKeys.length === 0) {
    throw new Error("No valid API keys provided");
  }

  const ai = getAi({ apiKey: apiKeys[0], apiHost });

  const systemPrompt = prompt
    .replaceAll("{{lang}}", lang)
    .replaceAll("{{additional}}", additional);

  try {
    // tool calling
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

    // Fallback 2: JSON object generation
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
    model,
    prompt,
    lang,
    additional,
    temperature,
  }: {
    apiKeys: string[];
    apiHost: string;
    model: string;
    prompt: string;
    lang: string;
    additional: string;
    temperature: number;
  }
) {
  if (apiKeys.length === 0) {
    throw new Error("No valid API keys provided");
  }

  const ai = getAi({ apiKey: apiKeys[0], apiHost });

  const systemPrompt = prompt
    .replaceAll("{{lang}}", lang)
    .replaceAll("{{additional}}", additional);

  try {
    // tool calling
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

    // Fallback 2: JSON object generation
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
    const format = fileExtension === "vtt" ? "WebVTT" : "SRT";
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
      { format }
    );
  }

  if (["ass", "ssa"].includes(fileExtension)) {
    const { full, events } = parsedSubtitle;
    // Use sequential alignment with Events order instead of text matching to avoid misalignment
    let dialogueIndex = 0;
    newSubtitle = assStringify(
      full.map((x: any) => {
        if (x.section === "Events") {
          x.body = x.body.map((line: any) => {
            if (line.key === "Dialogue") {
              const currentEvent = events[dialogueIndex++];
              const translatedText =
                currentEvent && currentEvent.data
                  ? currentEvent.data.translatedText || line.value.Text
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

  // Atomic write to avoid renderer reading partial file during concurrent updates
  const tmpPath = `${outputPath}.tmp`;
  fs.writeFileSync(tmpPath, newSubtitle, "utf8");
  try {
    fs.renameSync(tmpPath, outputPath);
  } catch {
    // Fallback for filesystems where rename might not be atomic
    fs.writeFileSync(outputPath, newSubtitle, "utf8");
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
  }
}

async function analyzeSubtitlesForContext(
  subtitles: string[],
  {
    apiKeys,
    apiHost,
    model,
    lang,
    temperature = 0.3,
  }: {
    apiKeys: string[];
    apiHost: string;
    model: string;
    lang: string;
    temperature?: number;
  }
): Promise<string> {
  if (apiKeys.length === 0) {
    throw new Error("No valid API keys provided");
  }
  const ai = getAi({ apiKey: apiKeys[0], apiHost });

  //   tool calling (some providers are more reliable with tools)
  try {
    const result = await generateText({
      model: ai(model),
      temperature,
      system: `# System Prompt

You are a subtitle content analyst assisting a translation and glossary extraction system.

## Task
Analyze subtitle samples and return two outputs:
1. **Plot Summary**
   - Language: ${lang}
   - Length: 5–10 sentences
   - Must be clear, coherent, and written in natural ${lang}
   - Avoid literal stitching of subtitles

2. **Glossary**
   - Up to 50 items
   - Include rare words, character names, places, organizations, fictional elements, or jargon
   - Each entry must follow the schema:
     - term (required)
     - description (required)
     - category (optional: person, place, organization, jargon, fictional, other)
     - preferredTranslation (optional)
     - notes (optional)  `,
      prompt:
        `Produce plot summary in ${lang} and glossary from this sample:\n` +
        subtitles.join("\n"),
      maxRetries: 2,
    });
    return result.text;
  } catch (e) {
    return "";
  }
}

export {
  translateSubtitleChunk,
  translateSubtitleSingle,
  parseSubtitle,
  saveTranslated,
  splitIntoChunk,
  analyzeSubtitlesForContext,
};
