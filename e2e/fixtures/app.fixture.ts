import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type ElectronApplication,
  type Page,
  type TestInfo,
  _electron,
  test as base,
} from "@playwright/test";

type AppFixtures = {
  electronApp: ElectronApplication;
  appPage: Page;
};

function getProviderFixturesRoot(): string {
  return path.resolve(__dirname, "../../packages/core/test-fixtures/providers");
}

function copyFixturePath(sourcePath: string, destinationPath: string): void {
  if (!fs.existsSync(sourcePath)) {
    return;
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.cpSync(sourcePath, destinationPath, { recursive: true });
}

function seedProviderFixtureData(input: {
  homeDir: string;
  appDataDir: string;
  xdgConfigHome: string;
}): void {
  const fixturesRoot = getProviderFixturesRoot();
  copyFixturePath(
    path.join(fixturesRoot, "claude", "projects"),
    path.join(input.homeDir, ".claude", "projects"),
  );
  copyFixturePath(
    path.join(fixturesRoot, "codex", "sessions"),
    path.join(input.homeDir, ".codex", "sessions"),
  );
  copyFixturePath(
    path.join(fixturesRoot, "gemini", "tmp"),
    path.join(input.homeDir, ".gemini", "tmp"),
  );
  copyFixturePath(
    path.join(fixturesRoot, "gemini", "projects.json"),
    path.join(input.homeDir, ".gemini", "projects.json"),
  );
  copyFixturePath(
    path.join(fixturesRoot, "cursor", "projects"),
    path.join(input.homeDir, ".cursor", "projects"),
  );

  const copilotRoot =
    process.platform === "darwin"
      ? path.join(
          input.homeDir,
          "Library",
          "Application Support",
          "Code",
          "User",
          "workspaceStorage",
        )
      : process.platform === "win32"
        ? path.join(input.appDataDir, "Code", "User", "workspaceStorage")
        : path.join(input.xdgConfigHome, "Code", "User", "workspaceStorage");
  copyFixturePath(path.join(fixturesRoot, "copilot", "workspaceStorage"), copilotRoot);
}

function resolveElectronBinary(): string {
  const electronDir = path.resolve(__dirname, "../../apps/desktop/node_modules/electron");
  const binRelative = fs.readFileSync(path.join(electronDir, "path.txt"), "utf-8").trim();
  return path.join(electronDir, "dist", binRelative);
}

let testCounter = 0;

async function closeElectronApp(app: ElectronApplication): Promise<void> {
  await app
    .evaluate(({ app: electronApp }) => {
      electronApp.quit();
    })
    .catch(() => undefined);
  await app.close().catch(() => undefined);
}

export const test = base.extend<AppFixtures>({
  electronApp: async ({ browserName: _browserName }, use, testInfo) => {
    const appDir = path.resolve(__dirname, "../../apps/desktop");
    const electronBin = resolveElectronBinary();
    const instanceId = `pw-${process.pid}-${++testCounter}-${crypto.randomBytes(4).toString("hex")}`;
    const isHeaded = process.env.HEADED === "1";
    const runtimeRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), `codetrail-e2e-${testInfo.parallelIndex}-`),
    );
    const homeDir = path.join(runtimeRoot, "home");
    const appDataDir = path.join(runtimeRoot, "appdata");
    const localAppDataDir = path.join(runtimeRoot, "localappdata");
    const xdgConfigHome = path.join(runtimeRoot, "xdg-config");
    for (const dir of [homeDir, appDataDir, localAppDataDir, xdgConfigHome]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    seedProviderFixtureData({ homeDir, appDataDir, xdgConfigHome });

    const electronArgs = [appDir];
    if (!isHeaded) {
      electronArgs.push("--disable-gpu", "--disable-software-rasterizer");
    }

    let app: ElectronApplication | null = null;
    try {
      app = await _electron.launch({
        executablePath: electronBin,
        args: electronArgs,
        env: {
          ...process.env,
          HOME: homeDir,
          USERPROFILE: homeDir,
          APPDATA: appDataDir,
          LOCALAPPDATA: localAppDataDir,
          XDG_CONFIG_HOME: xdgConfigHome,
          CODETRAIL_INSTANCE: instanceId,
          ...(isHeaded ? {} : { ELECTRON_DISABLE_SANDBOX: "1" }),
        },
        cwd: appDir,
      });

      if (!isHeaded) {
        await app.evaluate(({ BrowserWindow }) => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.setPosition(-10000, -10000);
          }
        });
      }

      await use(app);
    } finally {
      if (app) {
        await closeElectronApp(app).catch((error: unknown) => {
          console.error("[fixture] Electron app close failed:", error);
        });
      }
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  },

  appPage: async ({ electronApp }, use, testInfo) => {
    const page = await electronApp.firstWindow();
    await page.waitForSelector(".app-shell", { timeout: 30_000 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForSelector('.workspace[aria-busy="false"]', { timeout: 30_000 });

    const tracing = page.context().tracing;
    await tracing.start({ screenshots: true, snapshots: true, sources: true });

    await use(page);

    const failed = testInfo.status !== testInfo.expectedStatus;

    const tracePath = testInfo.outputPath("trace.zip");
    await tracing.stop({ path: tracePath });

    if (failed) {
      try {
        if (!page.isClosed()) {
          const screenshotPath = testInfo.outputPath("failure.png");
          await page.screenshot({ path: screenshotPath, type: "png" });
          await testInfo.attach("screenshot", {
            path: screenshotPath,
            contentType: "image/png",
          });
        }
      } catch (err) {
        console.error("[fixture] Screenshot capture failed:", err);
      }

      await testInfo.attach("trace", {
        path: tracePath,
        contentType: "application/zip",
      });
    } else {
      fs.rmSync(tracePath, { force: true });
    }
  },
});

export { expect } from "@playwright/test";
