import fs from "node:fs";
import path from "node:path";
import { parseSync, stringifySync } from "subtitle";
import assParser from "ass-parser";
import assStringify from "ass-stringify";
import { z } from "zod";
import { generateText, Output, streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { translationErrorCodes } from "../../../src/types/electron-api";
import type { RequestRateLimiter } from "./request-rate-limiter";

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

export type SubtitleFileExtension = "ass" | "ssa" | "srt" | "vtt";

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

export interface TranslationCacheDocument {
  version: 1;
  format: SubtitleFileExtension;
  source: {
    name: string;
  };
  subtitle: ParsedSubtitle;
  analysis?: string;
}

const savedSubtitleSeparators = ["\r\n", "\n", "\\N", "\\n"] as const;

/**
 * Recover the translation portion from a cue saved in bilingual mode.
 *
 * Bilingual output is serialized into one cue so subtitle timing stays
 * aligned. The preview needs the two logical values separately again.
 */
export function getTranslatedPreviewText(
  savedText: string,
  originalText: string
): string {
  if (!savedText || !originalText || savedText === originalText) {
    return savedText;
  }

  for (const separator of savedSubtitleSeparators) {
    const originalFirst = `${originalText}${separator}`;
    if (savedText.startsWith(originalFirst)) {
      return savedText.slice(originalFirst.length);
    }

    const originalLast = `${separator}${originalText}`;
    if (savedText.endsWith(originalLast)) {
      return savedText.slice(0, -originalLast.length);
    }
  }

  return savedText;
}

function isCue(node: SubtitleCue | SubtitleHeader): node is SubtitleCue {
  return node.type === "cue";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSubtitleFileExtension(value: unknown): value is SubtitleFileExtension {
  return value === "ass" || value === "ssa" || value === "srt" || value === "vtt";
}

function isSubtitleCueData(value: unknown): value is SubtitleCueData {
  if (!isRecord(value)) return false;
  if (typeof value.text !== "string") return false;
  if (typeof value.start !== "number" && typeof value.start !== "string") return false;
  if (typeof value.end !== "number" && typeof value.end !== "string") return false;
  return value.translatedText === undefined || typeof value.translatedText === "string";
}

function isSubtitleCueNode(value: unknown): value is SubtitleCue {
  return (
    isRecord(value) &&
    value.type === "cue" &&
    isSubtitleCueData(value.data)
  );
}

function isParsedSubtitle(value: unknown): value is ParsedSubtitle {
  if (Array.isArray(value)) {
    return value.every((node) => {
      if (isSubtitleCueNode(node)) return true;
      return (
        isRecord(node) &&
        node.type === "header" &&
        typeof node.data === "string"
      );
    });
  }

  return (
    isRecord(value) &&
    Array.isArray(value.full) &&
    value.full.every(isRecord) &&
    Array.isArray(value.events) &&
    value.events.every(isSubtitleCueNode)
  );
}

export function createTranslationCacheDocument(
  subtitle: ParsedSubtitle,
  sourceName: string,
  format: SubtitleFileExtension,
  analysis?: string
): TranslationCacheDocument {
  return {
    version: 1,
    format,
    source: { name: sourceName },
    subtitle,
    ...(analysis ? { analysis } : {}),
  };
}

export function parseTranslationCache(
  content: string
): TranslationCacheDocument {
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    throw new Error(translationErrorCodes.invalidCheckpoint);
  }

  if (!isRecord(value)) {
    throw new Error(translationErrorCodes.invalidCheckpoint);
  }

  const source = value.source;
  if (
    value.version !== 1 ||
    !isSubtitleFileExtension(value.format) ||
    !isRecord(source) ||
    typeof source.name !== "string" ||
    source.name.trim().length === 0 ||
    !isParsedSubtitle(value.subtitle) ||
    getSubtitleCues(value.subtitle).length === 0 ||
    (value.analysis !== undefined && typeof value.analysis !== "string")
  ) {
    throw new Error(translationErrorCodes.incompatibleCheckpoint);
  }

  return value as unknown as TranslationCacheDocument;
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
    // Output.object/array require the provider to send the JSON schema so the
    // model returns the shape that the AI SDK validates.
    supportsStructuredOutputs: true,
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
    requestRateLimiter,
  }: {
    apiKeys: string[];
    apiHost: string;
    model: string;
    prompt: string;
    lang: string;
    additional: string;
    temperature: number;
    requestRateLimiter?: RequestRateLimiter;
  }
) {
  if (apiKeys.length === 0) {
    throw new Error(translationErrorCodes.noValidApiKeys);
  }

  const ai = getAi({ apiKey: apiKeys[0], apiHost });

  const systemPrompt = prompt
    .replaceAll("{{lang}}", lang)
    .replaceAll("{{additional}}", additional);

  try {
    await requestRateLimiter?.waitForSlot();
    const result = streamText({
      model: ai(model),
      temperature,
      system: systemPrompt,
      output: Output.array({
        element: z.string().describe("The translated subtitle"),
        description:
          "Return one translated subtitle per input subtitle in the same order.",
      }),
      prompt:
        "Translate the following subtitles. Return an object with an `elements` array containing exactly one translated string per input subtitle, in the same order. Do not add any other properties.\n\n" +
        JSON.stringify(subtitles),
      maxRetries: 0,
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
        "Translation output validation failed: structured translation stream produced inconsistent output"
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
    requestRateLimiter,
  }: {
    apiKeys: string[];
    apiHost: string;
    model: string;
    prompt: string;
    lang: string;
    additional: string;
    temperature: number;
    requestRateLimiter?: RequestRateLimiter;
  }
) {
  if (apiKeys.length === 0) {
    throw new Error(translationErrorCodes.noValidApiKeys);
  }

  const ai = getAi({ apiKey: apiKeys[0], apiHost });

  const systemPrompt = prompt
    .replaceAll("{{lang}}", lang)
    .replaceAll("{{additional}}", additional);

  try {
    await requestRateLimiter?.waitForSlot();
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
      maxRetries: 0,
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
  throw new Error(translationErrorCodes.unsupportedFileExtension);
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
          return {
            ...section,
            body: section.body.map((line) => {
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
            }),
          };
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
    requestRateLimiter,
  }: {
    apiKeys: string[];
    apiHost: string;
    model: string;
    lang: string;
    temperature?: number;
    requestRateLimiter?: RequestRateLimiter;
  }
): Promise<string> {
  if (apiKeys.length === 0) {
    throw new Error(translationErrorCodes.noValidApiKeys);
  }
  const ai = getAi({ apiKey: apiKeys[0], apiHost });

  //   tool calling (some providers are more reliable with tools)
  try {
    await requestRateLimiter?.waitForSlot();
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
      maxRetries: 0,
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
