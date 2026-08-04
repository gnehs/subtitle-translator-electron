import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect, _electron as electron } from "@playwright/test";

test.describe.configure({ mode: "serial" });
let userDataDirectory: string;

test.beforeAll(async () => {
  userDataDirectory = await mkdtemp(
    path.join(os.tmpdir(), "subtitle-electron-e2e-profile-")
  );
});

test.afterAll(async () => {
  await rm(userDataDirectory, { recursive: true, force: true });
});

test("homepage has title and links to intro page", async () => {
  const app = await launchElectron();
  try {
    const page = await app.firstWindow();
    expect(await page.title()).toBe("Subtitle translator");
    await page.screenshot({ path: "e2e/screenshots/example.png" });
  } finally {
    await app.close();
  }
});

test("about shows project links and build metadata", async () => {
  const app = await launchElectron();
  try {
    const page = await app.firstWindow();

    await page.evaluate(() => {
      window.location.hash = "#/about";
    });

    await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
    await expect(page.getByText(/^\d+\.\d+\.\d+$/)).toBeVisible();
    await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/gnehs/subtitle-translator-electron"
    );
    await expect(
      page.getByRole("link", { name: "Buy Me a Coffee" })
    ).toHaveAttribute("href", "https://www.buymeacoffee.com/gnehs");
    await expect(
      page.getByRole("link").filter({ hasText: /^[0-9a-f]{7}$/i })
    ).toHaveAttribute(
      "href",
      /https:\/\/github\.com\/gnehs\/subtitle-translator-electron\/commit\/[0-9a-f]{7}$/i
    );
  } finally {
    await app.close();
  }
});

test("settings shows the API connection test control", async () => {
  const app = await launchElectron();
  try {
    const page = await app.firstWindow();

    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole("button", { name: "Settings" }).click();

    await expect(page.getByRole("heading", { name: "API connection" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Test connection" })
    ).toBeDisabled();
  } finally {
    await app.close();
  }
});

test("the selected language remains active after reload", async () => {
  const app = await launchElectron();
  try {
    const page = await app.firstWindow();

    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole("button", { name: "Settings" }).click();

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "繁體中文" }).click();

    await expect(page.getByRole("heading", { name: "API 連線" })).toBeVisible();
    await page.getByRole("button", { name: "關閉", exact: true }).click();
    await page.reload();

    await expect(page.getByRole("button", { name: "新增任務" })).toBeVisible();
    await page.getByRole("button", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "API 連線" })).toBeVisible();
  } finally {
    await app.close();
  }
});

test("coffee banner appears after more than ten successful translations", async () => {
  const app = await launchElectron();
  try {
    const page = await app.firstWindow();
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("language", "en-US");
      localStorage.setItem("translation_success_count", "10");
    });
    await page.reload();

    const bannerTitle = page.getByRole("heading", { name: "Buy Me a Coffee" });
    const chooseFileButton = page.getByRole("button", { name: "Choose files" });
    await expect(chooseFileButton).toBeVisible();
    await expect(bannerTitle).not.toBeVisible();

    await page.evaluate(() => {
      localStorage.setItem("translation_success_count", "11");
    });
    await page.reload();
    await expect(chooseFileButton).toBeVisible();
    await expect(bannerTitle).toBeVisible();

    await page.getByRole("button", { name: "Close" }).click();
    await expect(bannerTitle).not.toBeVisible();

    await page.reload();
    await expect(chooseFileButton).toBeVisible();
    await expect(bannerTitle).toBeVisible();
  } finally {
    await app.close();
  }
});

test("a subtitle translation writes a privacy-safe AgentPond trace", async () => {
  const testRoot = await mkdtemp(path.join(os.tmpdir(), "subtitle-tracing-e2e-"));
  const traceRoot = process.env.AGENTPOND_E2E_ROOT ?? path.join(testRoot, "traces");
  const subtitlePath = path.join(testRoot, "sample.srt");
  const translatedPath = path.join(testRoot, "sample.translated.srt");
  const privatePrompt = "PRIVATE_SYSTEM_PROMPT_SENTINEL {{lang}} {{additional}}";
  const privateSubtitle = "PRIVATE_SUBTITLE_SENTINEL";
  const requestBodies: string[] = [];
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const traceDirectory = path.join(traceRoot, "otel", "default-project");
  const traceFilesBefore = await collectJsonFiles(traceDirectory).catch(() => []);

  await writeFile(
    subtitlePath,
    `1\n00:00:00,000 --> 00:00:01,000\n${privateSubtitle}\n`,
    "utf8"
  );

  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requestBodies.push(body);
      response.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "keep-alive",
      });
      response.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-agentpond-e2e",
          object: "chat.completion.chunk",
          created: 1,
          model: "subtitle-agentpond-fixture",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "" },
              finish_reason: null,
            },
          ],
        })}\n\n`
      );
      response.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-agentpond-e2e",
          object: "chat.completion.chunk",
          created: 1,
          model: "subtitle-agentpond-fixture",
          choices: [
            {
              index: 0,
              delta: { content: '{"elements":["hola"]}' },
              finish_reason: null,
            },
          ],
        })}\n\n`
      );
      response.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-agentpond-e2e",
          object: "chat.completion.chunk",
          created: 1,
          model: "subtitle-agentpond-fixture",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 7,
            completion_tokens: 4,
            total_tokens: 11,
          },
        })}\n\n`
      );
      response.end("data: [DONE]\n\n");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not bind to a TCP port");
  }

  try {
    app = await launchElectron({
      executablePath: process.env.SUBTITLE_E2E_EXECUTABLE,
      env: {
        ...process.env,
        AGENTPOND_PROJECT_ID: "default-project",
        FILES_SDK_PROVIDER: "fs",
        FILES_SDK_ROOT: traceRoot,
      },
    });
    const page = await app.firstWindow();
    const progress = await page.evaluate(
      async ({ apiHost, filePath, prompt }) => {
        const completion = new Promise<{
          status: string;
          error?: string;
          outputPath?: string;
        }>((resolve) => {
          const unsubscribe = window.electronAPI.onBatchProgress((event) => {
            if (event.filePath !== filePath) return;
            if (event.status !== "done" && event.status !== "error") return;
            unsubscribe();
            resolve(event);
          });
        });

        await window.electronAPI.translateBatch({
          files: [{ path: filePath, name: "sample.srt" }],
          params: {
            apiKeys: ["fixture-key"],
            apiHost,
            model: "subtitle-agentpond-fixture",
            prompt,
            lang: "Spanish",
            additional: "",
            temperature: 0,
            outputFormat: "srt-translation",
            assFonts: { translationFont: "", originalFont: "" },
            concurrency: 1,
            delay: 0,
            requestsPerMinute: 1000,
            contextSize: 0,
          },
        });
        return await completion;
      },
      {
        apiHost: `http://127.0.0.1:${address.port}/v1`,
        filePath: subtitlePath,
        prompt: privatePrompt,
      }
    );

    expect(progress).toMatchObject({
      status: "done",
      outputPath: translatedPath,
    });
    expect(await readFile(translatedPath, "utf8")).toContain("hola");
    expect(requestBodies.join("\n")).toContain(privatePrompt.split(" ")[0]);
    expect(requestBodies.join("\n")).toContain(privateSubtitle);

    await app.close();
    app = undefined;

    const traceFiles = await collectJsonFiles(traceDirectory);
    expect(traceFiles.length).toBeGreaterThan(traceFilesBefore.length);
    const traceJson = (
      await Promise.all(traceFiles.map((file) => readFile(file, "utf8")))
    ).join("\n");
    expect(traceJson).toContain("subtitle-translation");
    expect(traceJson).toContain("subtitle-agentpond-fixture");
    expect(traceJson).not.toContain(privatePrompt.split(" ")[0]);
    expect(traceJson).not.toContain(privateSubtitle);
  } finally {
    await app?.close().catch(() => undefined);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(testRoot, { recursive: true, force: true });
  }
});

async function collectJsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? collectJsonFiles(entryPath)
        : Promise.resolve(entry.name.endsWith(".json") ? [entryPath] : []);
    })
  );
  return files.flat();
}

function launchElectron({
  env,
  executablePath,
}: {
  env?: NonNullable<Parameters<typeof electron.launch>[0]>["env"];
  executablePath?: string;
} = {}) {
  return electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(executablePath ? [] : [".", "--no-sandbox"]),
      `--user-data-dir=${userDataDirectory}`,
    ],
    env,
  });
}
