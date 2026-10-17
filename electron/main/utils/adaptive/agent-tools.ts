import { z } from "zod";
import {
  ADAPTIVE_FILE_READ_MAX_CUES,
  ADAPTIVE_FILE_SEARCH_MAX_HITS,
  type AdaptiveFileIndex,
} from "./file-index.ts";
import {
  ADAPTIVE_WORKSPACE_MAX_SPAN,
  ADAPTIVE_WORKSPACE_MAX_TARGETS,
  type SceneWorkspace,
} from "./workspace.ts";

/**
 * One model-callable tool. `execute` receives input already parsed by
 * `inputSchema`; both the AI SDK adapter and the test driver parse first.
 */
export interface AdaptiveAgentTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  execute(input: unknown): unknown;
}

export interface AdaptiveAgentSession {
  tools: readonly AdaptiveAgentTool[];
  /** The workspace listing, so the first prompt need not spend a step on view_scene. */
  view(): string;
  isComplete(): boolean;
}

function defineTool<Schema extends z.ZodType>(
  name: string,
  description: string,
  inputSchema: Schema,
  execute: (input: z.output<Schema>) => unknown,
): AdaptiveAgentTool {
  return {
    name,
    description,
    inputSchema,
    execute: (input) => execute(input as z.output<Schema>),
  };
}

const cueIndex = z.number().int().min(0);

export function createAdaptiveAgentSession(
  workspace: SceneWorkspace,
  fileIndex: AdaptiveFileIndex,
): AdaptiveAgentSession {
  const tools: AdaptiveAgentTool[] = [
    defineTool(
      "view_scene",
      "Show the scene workspace: every core cue with its index, duration, gap to the next cue, source text, and the translation block currently covering it.",
      z.object({}),
      () => ({ workspace: workspace.view() }),
    ),
    defineTool(
      "edit",
      `Write a translation block covering core cues from..to (inclusive, at most ${ADAPTIVE_WORKSPACE_MAX_SPAN} cues) with 1 to ${ADAPTIVE_WORKSPACE_MAX_TARGETS} target subtitle texts. Any block overlapping the range is removed whole; cues it leaves uncovered are reported and must be edited again. Preserve every placeholder from the source cues exactly and in order.`,
      z.object({
        from: cueIndex,
        to: cueIndex,
        targets: z.array(z.string()).min(1).max(ADAPTIVE_WORKSPACE_MAX_TARGETS),
      }),
      (input) => workspace.edit(input),
    ),
    defineTool(
      "check",
      "Validate the whole workspace. Errors (uncovered cues, placeholder mismatches) block finishing; warnings are readability lint (reading speed, line length, short duration) to reduce by rewording, merging, or splitting.",
      z.object({}),
      () => workspace.check(),
    ),
    defineTool(
      "search_file",
      `Search source text across the entire subtitle file (not only this scene). Returns up to ${ADAPTIVE_FILE_SEARCH_MAX_HITS} cues with their global index and, when another scene already finished, its translation. Use it to keep names and terminology consistent.`,
      z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(ADAPTIVE_FILE_SEARCH_MAX_HITS).optional(),
      }),
      (input) => ({ hits: fileIndex.search(input.query, input.limit) }),
    ),
    defineTool(
      "read_file",
      `Read source cues by global index range anywhere in the file (at most ${ADAPTIVE_FILE_READ_MAX_CUES} cues per call), including translations of scenes already finished.`,
      z.object({ from: cueIndex, to: cueIndex }),
      (input) => fileIndex.read(input.from, input.to),
    ),
    defineTool(
      "finish",
      "Submit the workspace. Succeeds only when check reports no errors; otherwise returns the errors so you can fix them.",
      z.object({}),
      () => workspace.submit(),
    ),
  ];
  return {
    tools,
    view: () => workspace.view(),
    isComplete: () => workspace.submitted,
  };
}

export type AdaptiveAgentToolCallResult =
  | { ok: true; output: unknown }
  | { ok: false; error: string };

/** Parse at the tool boundary and execute; the AI SDK adapter does the same. */
export function callAdaptiveAgentTool(
  session: AdaptiveAgentSession,
  name: string,
  rawInput: unknown,
): AdaptiveAgentToolCallResult {
  const tool = session.tools.find((item) => item.name === name);
  if (!tool) return { ok: false, error: `Unknown tool ${name}` };
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, output: tool.execute(parsed.data) };
}
