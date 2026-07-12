import { z } from "zod";
import type { AvailableModel } from "../../../src/types/electron-api";
import { parseAllowedApiHost } from "./api-host";

const modelListSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string().min(1),
        owned_by: z.string().nullable().optional(),
      })
      .passthrough()
  ),
});

function getModelsUrl(apiHost: string): string {
  const baseUrl = parseAllowedApiHost(apiHost);

  baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, "")}/models`;
  baseUrl.search = "";
  baseUrl.hash = "";
  return baseUrl.toString();
}

export async function fetchAvailableModels({
  apiKey,
  apiHost,
}: {
  apiKey: string;
  apiHost: string;
}): Promise<AvailableModel[]> {
  const modelsUrl = getModelsUrl(apiHost);
  const response = await fetch(modelsUrl, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Unable to load models (HTTP ${response.status})`);
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    throw new Error("Model list response was not valid JSON");
  }

  const parsed = modelListSchema.safeParse(responseBody);
  if (!parsed.success) {
    throw new Error("Model list response had an unexpected format");
  }

  return parsed.data.data.map(({ id, owned_by: ownedBy }) => ({
    id,
    ...(ownedBy ? { ownedBy } : {}),
  }));
}
