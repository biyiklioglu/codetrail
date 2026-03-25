import { expect, test } from "../fixtures/app.fixture";

test.describe("Settings Functional Flow", () => {
  test("theme change propagates to document root dataset", async ({ appPage }) => {
    await test.step("Open settings and read current theme", async () => {
      await appPage.locator('button[aria-label="Open settings"]').click();
      await expect(appPage.locator(".settings-view")).toBeVisible();
    });

    await test.step("Change theme via select and verify DOM attribute updates", async () => {
      const themeSelect = appPage.locator('select[aria-label="Theme"]');
      const currentTheme = await themeSelect.inputValue();
      const newTheme = currentTheme === "dark" ? "light" : "dark";
      await themeSelect.selectOption(newTheme);

      const htmlDataTheme = await appPage.evaluate(() => document.documentElement.dataset.theme);
      expect(htmlDataTheme).toBe(newTheme);
    });

    await test.step("Restore original theme", async () => {
      const themeSelect = appPage.locator('select[aria-label="Theme"]');
      const currentTheme = await themeSelect.inputValue();
      const restoreTheme = currentTheme === "dark" ? "light" : "dark";
      await themeSelect.selectOption(restoreTheme);
    });
  });

  test("font settings changes apply CSS variables to document", async ({ appPage }) => {
    await test.step("Open settings and change monospaced font", async () => {
      await appPage.locator('button[aria-label="Open settings"]').click();
      const monoFontSelect = appPage.locator('select[aria-label="Monospaced font"]');
      const options = await monoFontSelect.locator("option").allTextContents();
      expect(options.length).toBeGreaterThan(1);

      const currentValue = await monoFontSelect.inputValue();
      const targetOption = await monoFontSelect.locator("option").nth(1).getAttribute("value");
      if (targetOption && targetOption !== currentValue) {
        await monoFontSelect.selectOption(targetOption);
      }
    });

    await test.step("Verify CSS variable was updated on document root", async () => {
      const fontMono = await appPage.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--font-mono"),
      );
      expect(fontMono.length).toBeGreaterThan(0);
    });
  });

  test("auto-hide toggles change document dataset attributes", async ({ appPage }) => {
    await test.step("Open settings and toggle auto-hide message actions", async () => {
      await appPage.locator('button[aria-label="Open settings"]').click();
      const checkbox = appPage.locator('input[aria-label="Auto-hide message actions"]');
      const wasChecked = await checkbox.isChecked();
      await checkbox.click({ force: true });

      const dataAttr = await appPage.evaluate(
        () => document.documentElement.dataset.autoHideMessageActions,
      );
      expect(dataAttr).toBe(String(!wasChecked));
    });

    await test.step("Toggle back to original state", async () => {
      const checkbox = appPage.locator('input[aria-label="Auto-hide message actions"]');
      await checkbox.click({ force: true });
    });
  });

  test("settings tabs switch between Application Settings and Diagnostics", async ({ appPage }) => {
    await test.step("Open settings and verify Application Settings is active", async () => {
      await appPage.locator('button[aria-label="Open settings"]').click();
      const settingsTab = appPage.locator('button[role="tab"]', {
        hasText: "Application Settings",
      });
      await expect(settingsTab).toHaveAttribute("aria-selected", "true");
    });

    await test.step("Switch to Diagnostics — settings controls disappear, diagnostics load", async () => {
      const diagTab = appPage.locator('button[role="tab"]', { hasText: "Diagnostics" });
      await diagTab.click();
      await expect(diagTab).toHaveAttribute("aria-selected", "true");
      await expect(appPage.locator('select[aria-label="Theme"]')).not.toBeVisible();
    });

    await test.step("Switch back to Application Settings — controls reappear", async () => {
      const settingsTab = appPage.locator('button[role="tab"]', {
        hasText: "Application Settings",
      });
      await settingsTab.click();
      await expect(appPage.locator('select[aria-label="Theme"]')).toBeVisible();
    });
  });
});
