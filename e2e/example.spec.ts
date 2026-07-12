import { test, expect, _electron as electron } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("homepage has title and links to intro page", async () => {
  const app = await electron.launch({ args: [".", "--no-sandbox"] });
  try {
    const page = await app.firstWindow();
    expect(await page.title()).toBe("Subtitle translator");
    await page.screenshot({ path: "e2e/screenshots/example.png" });
  } finally {
    await app.close();
  }
});

test("about shows project links and build metadata", async () => {
  const app = await electron.launch({ args: [".", "--no-sandbox"] });
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
  const app = await electron.launch({ args: [".", "--no-sandbox"] });
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

test("switching language updates the active task and settings UI", async () => {
  const app = await electron.launch({ args: [".", "--no-sandbox"] });
  try {
    const page = await app.firstWindow();

    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole("button", { name: "Settings" }).click();

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "简体中文" }).click();

    await expect(page.getByRole("heading", { name: "API 连接" })).toBeVisible();
    await expect(page.getByRole("button", { name: "新增任务" })).toBeVisible();
    await expect(page.getByRole("button", { name: "关闭设置" })).toBeVisible();
  } finally {
    await app.close();
  }
});

test("coffee banner appears after more than ten successful translations", async () => {
  const app = await electron.launch({ args: [".", "--no-sandbox"] });
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
