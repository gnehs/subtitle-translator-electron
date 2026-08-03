import {
  test,
  expect,
  _electron as electron,
  type TestInfo,
} from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function launchApp(testInfo: TestInfo) {
  const app = await electron.launch({
    args: [
      ".",
      "--no-sandbox",
      `--user-data-dir=${testInfo.outputPath(
        "electron-user-data",
        String(process.pid),
      )}`,
    ],
  });
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "Settings" }).waitFor();

  return { app, page };
}

test("homepage has title and links to intro page", async ({}, testInfo) => {
  const { app, page } = await launchApp(testInfo);
  try {
    expect(await page.title()).toBe("Subtitle translator");
    await page.screenshot({ path: "e2e/screenshots/example.png" });
  } finally {
    await app.close();
  }
});

test("about shows project links and build metadata", async ({}, testInfo) => {
  const { app, page } = await launchApp(testInfo);
  try {
    await page.evaluate(() => {
      window.location.hash = "#/about";
    });

    await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
    await expect(page.getByText(/^\d+\.\d+\.\d+$/)).toBeVisible();
    await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/gnehs/subtitle-translator-electron",
    );
    await expect(
      page.getByRole("link", { name: "Buy Me a Coffee" }),
    ).toHaveAttribute("href", "https://www.buymeacoffee.com/gnehs");
    await expect(
      page.getByRole("link").filter({ hasText: /^[0-9a-f]{7}$/i }),
    ).toHaveAttribute(
      "href",
      /https:\/\/github\.com\/gnehs\/subtitle-translator-electron\/commit\/[0-9a-f]{7}$/i,
    );
  } finally {
    await app.close();
  }
});

test("settings shows the API connection test control", async ({}, testInfo) => {
  const { app, page } = await launchApp(testInfo);
  try {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole("button", { name: "Settings" }).click();

    const categoryNavigation = page.getByRole("navigation", {
      name: "Settings categories",
    });
    await expect(categoryNavigation).toBeVisible();
    await expect(
      categoryNavigation.getByRole("button", { name: "General" }),
    ).toHaveAttribute("aria-current", "page");
    await categoryNavigation
      .getByRole("button", { name: "API connection" })
      .click();
    await expect(
      page.getByRole("heading", { name: "API connection" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Test connection" }),
    ).toBeDisabled();
  } finally {
    await app.close();
  }
});

test("the selected language remains active after reload", async ({}, testInfo) => {
  const { app, page } = await launchApp(testInfo);
  try {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole("button", { name: "Settings" }).click();

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "繁體中文" }).click();

    await expect(page.getByRole("heading", { name: "一般" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "設定分類" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "關閉" }).click();
    await page.reload();

    await expect(page.getByRole("button", { name: "新增任務" })).toBeVisible();
    await page.getByRole("button", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "一般" })).toBeVisible();
  } finally {
    await app.close();
  }
});

test("coffee banner appears after more than ten successful translations", async ({}, testInfo) => {
  const { app, page } = await launchApp(testInfo);
  try {
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
