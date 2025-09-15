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
  }: {
    apiKeys: string[];
    apiHost: string;
    apiHeaders: { name: string; value: string }[];
    model: string;
    prompt: string;
    lang: string;
    additional: string;
    temperature: number;
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
    // Primary path: Ask for Markdown list to improve robustness across providers
    try {
      const { text } = await generateText({
        model: ai(model),
        temperature,
        system:
          systemPrompt +
          `\nOutput strictly in Markdown with the following structure:\n\n` +
          `## Translations\n` +
          `Provide exactly ${subtitles.length} bullet items, one per line, in the same order as input. Each item is ONLY the translated text, with no numbering or extra notes.`,
        prompt:
          `Translate the following ${subtitles.length} subtitles to ${lang} keeping order and count. Input (JSON array):\n` +
          JSON.stringify(subtitles),
        maxRetries: 3,
      });
      const md = text || "";
      const parsed = parseMarkdownTranslations(md, subtitles.length);
      if (Array.isArray(parsed) && parsed.length === subtitles.length) {
        return parsed;
      }
    } catch {
      // continue to tool calling fallback
    }

    // Fallback 1: tool calling
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
    apiHeaders,
    model,
    prompt,
    lang,
    additional,
    temperature,
  }: {
    apiKeys: string[];
    apiHost: string;
    apiHeaders: { name: string; value: string }[];
    model: string;
    prompt: string;
    lang: string;
    additional: string;
    temperature: number;
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
    // Primary path: Markdown single line for robustness
    try {
      const { text } = await generateText({
        model: ai(model),
        temperature,
        system:
          systemPrompt +
          `\nOutput strictly in Markdown with the following structure:\n\n` +
          `## Translation\n` +
          `Provide ONLY the translated text as plain text. Do not include explanations or extra sections.`,
        prompt:
          `Translate the following subtitle to {{lang}}:\n` +
          JSON.stringify(subtitle),
        maxRetries: 3,
      });
      const md = text || "";
      const parsed = parseMarkdownSingle(md);
      if (parsed && parsed.length > 0) {
        return parsed;
      }
    } catch {
      // continue to tool fallback
    }

    // Fallback 1: tool calling
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

/**
 * Even sampling helper to keep analysis prompt within token budget.
 */
function sampleSubtitlesForAnalysis(
  subtitles: string[],
  maxChars: number = 8000
) {
  const cleaned = (subtitles || [])
    .filter(Boolean)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);

  if (cleaned.length === 0) return "";

  const n = cleaned.length;
  const targetSamples = Math.min(300, n);
  const step = Math.max(1, Math.floor(n / targetSamples));

  let result = "";
  for (let i = 0; i < n && result.length < maxChars; i += step) {
    const line = cleaned[i];
    if (result.length + line.length + 1 <= maxChars) {
      result += (result ? "\n" : "") + line;
    } else {
      break;
    }
  }
  return result;
}

/**
 * Parse Markdown array of translations. Accepts:
 * - ## Translations section with bullet list (-, *, 1.)
 * - Fenced JSON code block containing an array
 */
function parseMarkdownTranslations(md: string, expected: number): string[] {
  if (!md || typeof md !== "string") return [];
  const text = md.replace(/\r\n/g, "\n");

  // Try code block JSON first
  const codeBlockMatch = text.match(
    /```(?:json|js|javascript)?\s*([\s\S]*?)```/i
  );
  if (codeBlockMatch) {
    const payload = codeBlockMatch[1].trim();
    try {
      const parsed = JSON.parse(payload);
      if (Array.isArray(parsed)) {
        return parsed.slice(0, expected).map((s) => String(s));
      }
    } catch {}
  }

  // Narrow to "## Translations" section if present
  let scope = text;
  const transHeader = /^##\s*Translations\s*$/im;
  const nextHeaderRe = /^##\s+/gm;
  const m = transHeader.exec(text);
  if (m) {
    const from = m.index + m[0].length;
    nextHeaderRe.lastIndex = from;
    const next = nextHeaderRe.exec(text);
    const end = next ? next.index : text.length;
    scope = text.slice(from, end);
  }

  const lines = scope.split("\n");
  const results: string[] = [];
  for (const raw of lines) {
    const li = raw.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (!li) continue;
    let val = li[1].trim();
    // strip wrapping quotes/backticks
    val = val.replace(/^["'`]|["'`]$/g, "").trim();
    if (val.length > 0) results.push(val);
    if (results.length >= expected) break;
  }
  return results;
}

/**
 * Parse Markdown single translation. Accepts:
 * - ## Translation section, first non-empty line
 * - Fenced JSON/object/string code block
 * - Otherwise first non-empty line of text
 */
function parseMarkdownSingle(md: string): string {
  if (!md || typeof md !== "string") return "";

  const text = md.replace(/\r\n/g, "\n").trim();
  // Try code block first
  const codeBlockMatch = text.match(
    /```(?:json|js|javascript|text)?\s*([\s\S]*?)```/i
  );
  if (codeBlockMatch) {
    const payload = codeBlockMatch[1].trim();
    try {
      // string JSON
      if (
        (payload.startsWith('"') && payload.endsWith('"')) ||
        (payload.startsWith("'") && payload.endsWith("'"))
      ) {
        return JSON.parse(payload);
      }
      // object with { result }
      const obj = JSON.parse(payload);
      if (typeof obj === "string") return obj;
      if (obj && typeof obj.result === "string") return obj.result;
    } catch {
      // not JSON, just use payload first line
      const first = payload
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      if (first) return first.replace(/^["'`]|["'`]$/g, "");
    }
  }

  // Narrow to "## Translation"
  const header = /^##\s*Translation\s*$/im;
  const nextHeaderRe = /^##\s+/gm;
  const m = header.exec(text);
  let scope = text;
  if (m) {
    const from = m.index + m[0].length;
    nextHeaderRe.lastIndex = from;
    const next = nextHeaderRe.exec(text);
    const end = next ? next.index : text.length;
    scope = text.slice(from, end);
  }

  const first = scope
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("##"))[0];

  return (first || "").replace(/^["'`]|["'`]$/g, "");
}

async function analyzeSubtitlesForContext(
  subtitles: string[],
  {
    apiKeys,
    apiHost,
    apiHeaders,
    model,
    lang,
    temperature = 0.3,
  }: {
    apiKeys: string[];
    apiHost: string;
    apiHeaders: { name: string; value: string }[];
    model: string;
    lang: string;
    temperature?: number;
  }
): Promise<{
  plotSummary: string;
  glossary: {
    term: string;
    category?: string;
    description: string;
    preferredTranslation?: string;
    notes?: string;
  }[];
}> {
  // helper: parse markdown result into structured object
  function parseAnalysisMarkdown(md: string) {
    const out = {
      plotSummary: "",
      glossary: [] as {
        term: string;
        category?: string;
        description: string;
        preferredTranslation?: string;
        notes?: string;
      }[],
    };

    if (!md || typeof md !== "string") return out;
    const text = md.replace(/\r\n/g, "\n");

    // Locate sections
    const plotRe = /^##\s*Plot\s*Summary\s*$/im;
    const glossaryRe = /^##\s*Glossary\s*$/im;

    const plotMatch = plotRe.exec(text);
    const glossaryMatch = glossaryRe.exec(text);

    const nextHeaderRe = /^##\s+/gm;

    const getSection = (fromIdx: number) => {
      nextHeaderRe.lastIndex = fromIdx;
      const next = nextHeaderRe.exec(text);
      const end = next ? next.index : text.length;
      return text.slice(fromIdx, end).trim();
    };

    if (plotMatch) {
      const plotBody = getSection(plotMatch.index + plotMatch[0].length);
      out.plotSummary = plotBody.replace(/^[-*]\s*/gm, "").trim();
    }

    if (glossaryMatch) {
      const glBody = getSection(glossaryMatch.index + glossaryMatch[0].length);
      const lines = glBody.split("\n").filter((l) => /^\s*[-*]\s+/.test(l));
      for (const raw of lines) {
        // remove leading bullet
        let line = raw.replace(/^\s*[-*]\s+/, "").trim();

        // split at first colon for description
        let header = line;
        let description = "";
        const colonIdx = line.indexOf(":");
        if (colonIdx >= 0) {
          header = line.slice(0, colonIdx).trim();
          description = line.slice(colonIdx + 1).trim();
        }

        // extract trailing notes "(...)" at end of description
        let notes: string | undefined;
        const notesMatch = description.match(/\(([^()]*)\)\s*$/);
        if (notesMatch) {
          notes = notesMatch[1].trim();
          description = description.replace(/\(([^()]*)\)\s*$/, "").trim();
        }

        // extract [category] anywhere in header
        let category: string | undefined;
        const catMatch = header.match(/\[([^[\]]+)\]/);
        if (catMatch) {
          category = catMatch[1].trim();
          header = header.replace(/\[([^[\]]+)\]/, "").trim();
        }

        // extract (preferred) in header
        let preferredTranslation: string | undefined;
        const prefMatch = header.match(/\(([^()]*)\)/);
        if (prefMatch) {
          preferredTranslation = prefMatch[1].trim();
          header = header.replace(/\(([^()]*)\)/, "").trim();
        }

        const term = header.trim();
        if (!term && !description) continue;

        out.glossary.push({
          term,
          category,
          description,
          preferredTranslation,
          notes,
        });
      }
    }

    return out;
  }

  // build providers
  let openAIProviders: any[] = [];
  for (let apiKey of apiKeys || []) {
    if (apiKey && apiKey.length > 0) {
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

  // Define schema for fallback paths
  const GlossaryItemSchema = z.object({
    term: z.string(),
    category: z
      .enum(["person", "place", "organization", "jargon", "fictional", "other"])
      .optional(),
    description: z.string().describe("Brief meaning or who/what it is"),
    preferredTranslation: z
      .string()
      .optional()
      .describe(
        `Preferred translation into target language (${lang}) if applicable`
      ),
    notes: z.string().optional(),
  });

  const AnalysisSchema = z.object({
    plotSummary: z
      .string()
      .describe(
        `Concise plot summary (5-10 sentences) in target language (${lang})`
      ),
    glossary: z
      .array(GlossaryItemSchema)
      .max(50)
      .describe(
        "Key rare terms, names, places, organizations, and jargon with brief explanations"
      ),
  });

  const sampled = sampleSubtitlesForAnalysis(subtitles, 8000);

  // Primary path: ask for Markdown and parse it (more robust across providers)
  try {
    const { text } = await generateText({
      model: ai(model),
      temperature,
      system:
        `You are a subtitle content analyst assisting a translation system.\n` +
        `Output strictly in Markdown with the following structure:\n\n` +
        `## Plot Summary\n` +
        `Write a concise plot summary in ${lang}.\n\n` +
        `## Glossary\n` +
        `Use bullet points, one term per line, with the format:\n` +
        `- term [category] (preferredTranslation): description (notes)\n\n` +
        `Rules:\n` +
        `- Prefer canonical spellings/romanization for non-Latin names.\n` +
        `- Include preferredTranslation in ${lang} if applicable.\n` +
        `- Do not include any extra sections besides the two above.`,
      prompt:
        `Target translation language: ${lang}\n\n` +
        `Subtitles sample (not exhaustive):\n` +
        sampled,
      maxRetries: 3,
    });

    const parsed = parseAnalysisMarkdown(text);
    // Minimal validation
    if (
      (parsed.plotSummary && parsed.plotSummary.length > 0) ||
      (parsed.glossary && parsed.glossary.length > 0)
    ) {
      return parsed;
    }
  } catch (e) {
    // continue to fallback
  }

  // Fallback 1: tool calling (some providers are more reliable with tools)
  try {
    let toolAnalysis: {
      plotSummary: string;
      glossary: {
        term: string;
        category?: string;
        description: string;
        preferredTranslation?: string;
        notes?: string;
      }[];
    } | null = null;

    const tools = {
      submit_analysis: tool({
        description:
          "Provide the final analysis containing a concise plot summary and a glossary of key terms.",
        inputSchema: AnalysisSchema,
        execute: async ({ plotSummary, glossary }) => {
          toolAnalysis = { plotSummary, glossary };
          return "ok";
        },
      }),
    } as const;

    await generateText({
      model: ai(model),
      temperature,
      tools,
      toolChoice: "required",
      system:
        `You are a subtitle content analyst assisting a translation system.\n` +
        `Return ONLY using the tool, do not include any extra text.`,
      prompt:
        `Produce plot summary in ${lang} and glossary from this sample:\n` +
        sampled,
      maxRetries: 2,
    });

    if (toolAnalysis) {
      return toolAnalysis;
    }
  } catch (e) {
    // continue to fallback 2
  }

  // Fallback 2: JSON object generation
  const { object } = await generateObject({
    model: ai(model),
    temperature,
    schema: AnalysisSchema,
    prompt:
      `You are a subtitle content analyst assisting a translation system.\n` +
      `Return a JSON object matching the provided schema.\n` +
      `Target translation language: ${lang}\n` +
      `Subtitles sample (not exhaustive):\n` +
      sampled,
    maxRetries: 3,
  });
  return object;
}

export {
  translateSubtitleChunk,
  translateSubtitleSingle,
  parseSubtitle,
  saveTranslated,
  splitIntoChunk,
  analyzeSubtitlesForContext,
};
