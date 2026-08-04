import type { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

let tracingProvider: NodeTracerProvider | undefined;
let shutdownPromise: Promise<void> | undefined;

export async function startAgentPondTracing(): Promise<boolean> {
  if (!process.env.FILES_SDK_PROVIDER || tracingProvider) {
    return Boolean(tracingProvider);
  }

  try {
    const [
      { createFilesSpanExporterFromRuntimeEnv },
      { OpenTelemetry },
      { isOpenInferenceSpan, OpenInferenceBatchSpanProcessor },
      { NodeTracerProvider },
      { registerTelemetry },
    ] = await Promise.all([
      import("@agentpond/files-sdk/otel"),
      import("@ai-sdk/otel"),
      import("@arizeai/openinference-vercel"),
      import("@opentelemetry/sdk-trace-node"),
      import("ai"),
    ]);
    tracingProvider = new NodeTracerProvider({
      spanProcessors: [
        new OpenInferenceBatchSpanProcessor({
          exporter: createFilesSpanExporterFromRuntimeEnv(),
          spanFilter: isOpenInferenceSpan,
          reparentOrphanedSpans: true,
        }),
      ],
    });
    tracingProvider.register();
    registerTelemetry(
      new OpenTelemetry({
        usage: true,
        providerMetadata: true,
      })
    );
    return true;
  } catch (error: unknown) {
    tracingProvider = undefined;
    console.warn("AgentPond tracing is unavailable:", error);
    return false;
  }
}

export function shutdownAgentPondTracing(): Promise<void> {
  if (!tracingProvider) return Promise.resolve();
  shutdownPromise ??= tracingProvider.shutdown().finally(() => {
    tracingProvider = undefined;
  });
  return shutdownPromise;
}
