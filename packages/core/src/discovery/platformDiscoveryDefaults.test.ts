import { describe, expect, it } from "vitest";

import { createDefaultDiscoveryConfig } from "./platformDiscoveryDefaults";

describe("createDefaultDiscoveryConfig", () => {
  it("uses LOCALAPPDATA for OpenCode on Windows", () => {
    const config = createDefaultDiscoveryConfig("win32", {
      homeDir: "C:/Users/test",
      appDataDir: "C:/Users/test/AppData/Roaming",
      localAppDataDir: "C:/Users/test/AppData/Local",
    });

    expect(config.copilotRoot).toBe("C:/Users/test/AppData/Roaming/Code/User/workspaceStorage");
    expect(config.opencodeRoot).toBe("C:/Users/test/AppData/Local/opencode");
  });
});
