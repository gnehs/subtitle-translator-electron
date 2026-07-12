import fs from "node:fs";
import path from "node:path";
import { parseSync, stringifySync } from "subtitle";
import assParser from "ass-parser";
import assStringify from "ass-stringify";
import { z } from "zod";
import { generateText, Output, streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export interface SubtitleCueData {
  text: string;
  start: number | string;
  end: number | string;
  translatedText?: string;
}

export interface SubtitleCue {
  type: "cue";
  data: SubtitleCueData;
}

interface SubtitleHeader {
  type: "header";
  data: string;
}

interface AssDescriptor {
  key?: string;
  type?: string;
  value?: Record<string, string> | string;
  [key: string]: unknown;
}

interface AssSection {
  section?: string;
  body?: AssDescriptor[];
  [key: string]: unknown;
}

export interface AssSubtitle {
  full: AssSection[];
  events: SubtitleCue[];
}

export type ParsedSubtitle = Array<SubtitleCue | SubtitleHeader> | AssSubtitle;
export type MultiLanguageSave =
  | "none"
  | "translate+original"
  | "original+translate";

function isCue(node: SubtitleCue | SubtitleHeader): node is SubtitleCue {
  return node.type === "cue";
}

export function getSubtitleCues(parsedSubtitle: ParsedSubtitle): SubtitleCue[] {
  return Array.isArray(parsedSubtitle)
    ? parsedSubtitle.filter(isCue)
    : parsedSubtitle.events;
}

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

function splitIntoChunk(array: SubtitleCue[], by = 5): SubtitleCue[][] {
  const chunks: SubtitleCue[][] = [];
  let chunk: SubtitleCue[] = [];
  for (const cue of array) {
    if (cue.data.translatedText) continue;
    chunk.push(cue);
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
    const result = streamText({
      model: ai(model),
      temperature,
      system: systemPrompt,
      output: Output.array({
        element: z.string().describe("The translated subtitle"),
      }),
      prompt:
        "Translate the following subtitles as an array of strings with the exact same length and order as input.\n\n" +
        JSON.stringify(subtitles),
      maxRetries: 3,
      onError({ error }) {
        console.error("Subtitle chunk streaming error:", error);
      },
    });

    const translated: string[] = [];
    for await (const subtitle of result.elementStream) {
      translated.push(subtitle);
    }

    // Validate the complete array as well as each streamed element.
    const completeOutput = await result.output;
    if (completeOutput.length !== translated.length) {
      throw new Error(
        "Structured translation stream produced inconsistent output"
      );
    }
    return completeOutput;
  } catch (e: unknown) {
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
    const result = streamText({
      model: ai(model),
      temperature,
      system: systemPrompt,
      output: Output.object({
        schema: z.object({ result: z.string() }),
      }),
      prompt:
        "Translate the following subtitle and return an object with a single `result` string property.\n\n" +
        JSON.stringify(subtitle),
      maxRetries: 3,
      onError({ error }) {
        console.error("Single subtitle streaming error:", error);
      },
    });

    const { output } = result;
    return (await output).result;
  } catch (e: unknown) {
    throw e;
  }
}

function parseSubtitle(
  fileContent: string,
  fileExtension: string
): ParsedSubtitle {
  if (["srt", "vtt"].includes(fileExtension)) {
    return parseSync(fileContent) as unknown as Array<
      SubtitleCue | SubtitleHeader
    >;
  }
  if (["ass", "ssa"].includes(fileExtension)) {
    const parsedAssSubtitle = assParser(fileContent) as AssSection[];
    const events = parsedAssSubtitle
      .find((section) => section.section === "Events")
      ?.body?.filter(
        (line) =>
          line.key === "Dialogue" &&
          typeof line.value === "object" &&
          line.value !== null &&
          typeof line.value.Text === "string"
      )
      .map((line) => {
        const value = line.value as Record<string, string>;
        return {
          type: "cue" as const,
          data: {
            text: value.Text,
            start: value.Start ?? "",
            end: value.End ?? "",
          },
        };
      }) ?? [];
    return { full: parsedAssSubtitle, events };
  }
  throw new Error("Unsupported file extension");
}

function saveTranslated(
  outputPath: string,
  parsedSubtitle: ParsedSubtitle,
  fileExtension: string,
  multiLangSave: MultiLanguageSave = "none"
): void {
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
      default:
        return translatedText;
    }
  }

  let newSubtitle = "";
  if (Array.isArray(parsedSubtitle)) {
    const format = fileExtension === "vtt" ? "WebVTT" : "SRT";
    newSubtitle = stringifySync(
      parsedSubtitle.map((node) => {
        if (!isCue(node)) return node;
        return {
          type: node.type,
          data: {
            ...node.data,
            text: parseTranslatedText(
              node.data.text,
              node.data.translatedText || node.data.text
            ),
          },
        };
      }),
      { format }
    );
  } else {
    const { full, events } = parsedSubtitle;
    // Use sequential alignment with Events order instead of text matching to avoid misalignment
    let dialogueIndex = 0;
    newSubtitle = assStringify(
      full.map((section) => {
        if (section.section === "Events" && section.body) {
          section.body = section.body.map((line) => {
            if (line.key === "Dialogue") {
              const currentEvent = events[dialogueIndex++];
              const translatedText =
                currentEvent &&
                currentEvent.data.translatedText &&
                typeof line.value === "object" &&
                line.value !== null
                  ? currentEvent.data.translatedText
                  : typeof line.value === "object" && line.value !== null
                    ? line.value.Text ?? ""
                    : "";
              const value =
                typeof line.value === "object" && line.value !== null
                  ? line.value
                  : {};
              return {
                key: "Dialogue",
                value: {
                  ...value,
                  Text: parseTranslatedText(
                    value.Text,
                    translatedText,
                    "\\n"
                  ),
                },
              };
            }
            return line;
          });
        }
        return section;
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
