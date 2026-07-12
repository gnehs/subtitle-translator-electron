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

test("settings shows the API connection test control", async () => {
  const app = await electron.launch({ args: [".", "--no-sandbox"] });
  try {
    const page = await app.firstWindow();

    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole("button", { name: "設定" }).click();

    await expect(page.getByRole("heading", { name: "API 連線" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Test connection" })
    ).toBeDisabled();
  } finally {
    await app.close();
  }
});
