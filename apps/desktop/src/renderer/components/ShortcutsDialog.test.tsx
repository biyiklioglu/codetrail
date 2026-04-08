// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createShortcutRegistry } from "../lib/shortcutRegistry";
import { ShortcutsDialog } from "./ShortcutsDialog";

describe("ShortcutsDialog", () => {
  it("renders the redesigned help layout with syntax and filter sections", () => {
    const { container } = render(
      <ShortcutsDialog
        shortcuts={createShortcutRegistry("darwin")}
        commonSyntaxItems={[{ syntax: "react", description: "Match a word" }]}
        advancedSyntaxItems={[{ syntax: "A OR B", description: "Match either term" }]}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Code Trail Help");
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Search Syntax")).toBeInTheDocument();
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Views & Panels")).toBeInTheDocument();
    expect(screen.getByText("Message Filters")).toBeInTheDocument();
    expect(screen.getAllByText("System").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText((_, element) => (element?.textContent ?? "").trim() === "react").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Match a word")).toBeInTheDocument();
    expect(
      screen.getAllByText((_, element) => (element?.textContent ?? "").trim() === "A OR B").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Match either term")).toBeInTheDocument();
    expect(screen.getByText("Advanced")).toBeInTheDocument();
    expect(screen.getByText("Focus (solo)")).toBeInTheDocument();
    expect(container.querySelector(".help-header")).toBeInTheDocument();
  });

  it("renders platform-specific shortcuts from the live registry", () => {
    render(
      <ShortcutsDialog
        shortcuts={createShortcutRegistry("win32")}
        commonSyntaxItems={[]}
        advancedSyntaxItems={[]}
      />,
    );

    const toggleSessionsRow = screen
      .getByText("Toggle Sessions pane")
      .closest(".help-shortcut-row");
    expect(toggleSessionsRow?.textContent).toContain("⌃");
    expect(toggleSessionsRow?.textContent).toContain("⌥");
    expect(toggleSessionsRow?.textContent).toContain("B");

    const pageUpRow = screen.getByText("Page up").closest(".help-shortcut-row");
    expect(pageUpRow?.textContent).toContain("PgUp");
    expect(pageUpRow?.textContent).toContain("U");
  });
});
