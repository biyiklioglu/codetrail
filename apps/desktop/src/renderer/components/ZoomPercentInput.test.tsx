// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ZoomPercentInput } from "./ZoomPercentInput";

describe("ZoomPercentInput", () => {
  it("commits arbitrary percent values entered with a percent sign", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();

    render(<ZoomPercentInput value={100} onCommit={onCommit} ariaLabel="Zoom" />);

    const input = screen.getByRole("textbox", { name: "Zoom" });
    await user.clear(input);
    await user.type(input, "104%");
    await user.keyboard("{Enter}");

    expect(onCommit).toHaveBeenCalledWith(104);
  });

  it("clamps zoom values to the supported range", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();

    render(<ZoomPercentInput value={100} onCommit={onCommit} ariaLabel="Zoom" />);

    const input = screen.getByRole("textbox", { name: "Zoom" });
    await user.clear(input);
    await user.type(input, "999");
    await user.tab();

    expect(onCommit).toHaveBeenCalledWith(175);
  });
});
