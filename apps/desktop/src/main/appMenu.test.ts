import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

import { buildAppMenuTemplate } from "./appMenu";

function getTopLevelMenu(
  template: ReturnType<typeof buildAppMenuTemplate>,
  matcher: string | { role: string },
) {
  return template.find((item) =>
    typeof matcher === "string" ? item.label === matcher : item.role === matcher.role,
  );
}

function getSubmenuItems(
  item: MenuItemConstructorOptions | undefined,
): MenuItemConstructorOptions[] {
  return Array.isArray(item?.submenu) ? item.submenu : [];
}

describe("buildAppMenuTemplate", () => {
  it("replaces the default View menu with app-owned actions", () => {
    const template = buildAppMenuTemplate({
      appName: "Code Trail",
      isDevelopment: false,
      dispatchAppCommand: vi.fn(),
      reloadFocusedWindow: vi.fn(),
      forceReloadFocusedWindow: vi.fn(),
      toggleFocusedWindowDevTools: vi.fn(),
    });

    const viewMenu = getTopLevelMenu(template, "View");
    expect(viewMenu).toBeDefined();
    const viewItems = getSubmenuItems(viewMenu).map((item) =>
      "label" in item ? item.label : item.role,
    );

    expect(viewItems).toContain("Refresh Now");
    expect(viewItems).toContain("Toggle Auto-Refresh");
    expect(viewItems).toContain("Zoom In");
    expect(viewItems).toContain("Zoom Out");
    expect(viewItems).toContain("Actual Size");
    expect(viewItems).toContain("Toggle Projects Pane");
    expect(viewItems).toContain("Toggle Sessions Pane");
    expect(viewItems).toContain("Toggle Focus Mode");
    expect(viewItems).toContain("Expand or Collapse All Messages");
    expect(viewItems).not.toContain("Reload");
    expect(viewItems).not.toContain("Force Reload");
    expect(viewItems).not.toContain("Toggle Developer Tools");
  });

  it("shows developer-only reload tooling outside the View menu", () => {
    const template = buildAppMenuTemplate({
      appName: "Code Trail",
      isDevelopment: true,
      dispatchAppCommand: vi.fn(),
      reloadFocusedWindow: vi.fn(),
      forceReloadFocusedWindow: vi.fn(),
      toggleFocusedWindowDevTools: vi.fn(),
    });

    const developerMenu = getTopLevelMenu(template, "Developer");
    expect(developerMenu).toBeDefined();
    const developerItems = getSubmenuItems(developerMenu);
    const developerLabels = developerItems.map((item) =>
      "label" in item ? item.label : item.role,
    );
    expect(developerLabels).toContain("Reload");
    expect(developerLabels).toContain("Force Reload");
    expect(developerLabels).toContain("Toggle Developer Tools");
    expect(developerItems.find((item) => item.label === "Reload")).not.toHaveProperty(
      "accelerator",
    );
    expect(developerItems.find((item) => item.label === "Force Reload")).not.toHaveProperty(
      "accelerator",
    );
  });

  it("shows accelerators for app-owned items without registering duplicate native handlers", () => {
    const template = buildAppMenuTemplate({
      appName: "Code Trail",
      isDevelopment: false,
      dispatchAppCommand: vi.fn(),
      reloadFocusedWindow: vi.fn(),
      forceReloadFocusedWindow: vi.fn(),
      toggleFocusedWindowDevTools: vi.fn(),
    });

    const viewMenu = getTopLevelMenu(template, "View");
    const refreshItem = getSubmenuItems(viewMenu).find(
      (item) => "label" in item && item.label === "Refresh Now",
    );
    expect(refreshItem).toMatchObject({
      accelerator: "CommandOrControl+R",
      registerAccelerator: false,
    });
  });
});
