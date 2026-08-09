export interface ErrorDetails {
  message: string;
  code?: string;
  name?: string;
  status?: number;
}

/** Normalize nested provider errors without repeating the same message. */
export function getErrorDetails(error: unknown): ErrorDetails {
  const errorRecord =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const cause =
    typeof errorRecord.cause === "object" && errorRecord.cause !== null
      ? (errorRecord.cause as Record<string, unknown>)
      : {};
  const messages = [
    error instanceof Error ? error.message : undefined,
    typeof error === "string" ? error : undefined,
    typeof errorRecord.message === "string" ? errorRecord.message : undefined,
    typeof cause.message === "string" ? cause.message : undefined,
  ].filter((message): message is string => Boolean(message));
  const response =
    typeof errorRecord.response === "object" && errorRecord.response !== null
      ? (errorRecord.response as Record<string, unknown>)
      : {};

  return {
    message: [...new Set(messages)].join(" | ") || "Unknown error",
    ...(typeof errorRecord.code === "string" ? { code: errorRecord.code } : {}),
    name:
      typeof errorRecord.name === "string"
        ? errorRecord.name
        : typeof cause.name === "string"
          ? cause.name
          : undefined,
    status:
      typeof errorRecord.statusCode === "number"
        ? errorRecord.statusCode
        : typeof errorRecord.status === "number"
          ? errorRecord.status
          : typeof response.status === "number"
            ? response.status
            : typeof cause.status === "number"
              ? cause.status
              : undefined,
  };
}
