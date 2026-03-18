import { vi } from "vitest";

import type { IpcChannel, IpcRequestInput, IpcResponse } from "@codetrail/core/browser";

import type { CodetrailClient } from "../lib/codetrailClient";

type MockInvoke = <C extends IpcChannel>(
  channel: C,
  payload: IpcRequestInput<C>,
) => Promise<IpcResponse<C>>;

export type MockCodetrailClient = CodetrailClient & {
  invoke: ReturnType<typeof vi.fn<MockInvoke>>;
};

export function createMockCodetrailClient(): MockCodetrailClient {
  const invoke = vi.fn<MockInvoke>(async () => {
    throw new Error("Mock codetrail client response not configured for this invocation.");
  });

  return { invoke };
}
