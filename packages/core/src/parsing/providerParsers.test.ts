import { describe, expect, it } from "vitest";

import type { ParserDiagnostic } from "./contracts";
import { parseProviderPayload } from "./providerParsers";

const baseEvent = {
  type: "user",
  created_at: "2024-01-01T00:00:00Z",
};

describe("parseProviderPayload (Gemini attachment normalization)", () => {
  it("summarizes large referenced file dumps", () => {
    const payload = {
      messages: [
        {
          ...baseEvent,
          parts: [
            {
              text: [
                "Do the task described below.",
                "--- Content from referenced files ---",
                "Content from @src/README.md:",
                "# Project",
                "Content from @src/checkpoints/model-1.bin:",
                "Cannot display content of binary file: model-1.bin",
                "Content from @src/checkpoints/model-2.bin:",
                "Cannot display content of binary file: model-2.bin",
                "Content from @src/checkpoints/model-3.bin:",
                "Cannot display content of binary file: model-3.bin",
                "Content from @src/checkpoints/model-4.bin:",
                "Cannot display content of binary file: model-4.bin",
                "Content from @src/checkpoints/model-5.bin:",
                "Cannot display content of binary file: model-5.bin",
                "Content from @src/checkpoints/model-6.bin:",
                "Cannot display content of binary file: model-6.bin",
                "Content from @src/checkpoints/model-7.bin:",
                "Cannot display content of binary file: model-7.bin",
              ].join("\n"),
            },
          ],
        },
      ],
    };
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "gemini",
      sessionId: "sess-1",
      payload,
      diagnostics,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].category).toBe("user");
    expect(messages[0].content).toContain("Do the task described below.");
    expect(messages[1].category).toBe("system");
    expect(messages[1].content).toContain("Gemini attachment dump truncated");
    expect(messages[1].content).toContain("@src/README.md");
    expect(messages.map((msg) => msg.content).join("\n")).not.toContain(
      "Cannot display content of binary file",
    );
  });

  it("leaves small attachment blocks untouched", () => {
    const payload = {
      messages: [
        {
          ...baseEvent,
          parts: [
            {
              text: [
                "Task details",
                "--- Content from referenced files ---",
                "Content from @src/small.txt:",
                "Just a short snippet",
              ].join("\n"),
            },
          ],
        },
      ],
    };
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "gemini",
      sessionId: "sess-2",
      payload,
      diagnostics,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].category).toBe("user");
    expect(messages[0].content).toContain("Content from @src/small.txt:");
  });
});
