import type { IpcMain, IpcMainInvokeEvent } from "electron";

import {
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
  IpcValidationError,
  ipcChannels,
  ipcContractSchemas,
} from "@codetrail/core";

type IpcHandlerMap = {
  [K in IpcChannel]: (
    payload: IpcRequest<K>,
    event: IpcMainInvokeEvent,
  ) => Promise<IpcResponse<K>> | IpcResponse<K>;
};

type RegisterIpcHandlersOptions = {
  onValidationError?: (args: {
    channel: IpcChannel;
    stage: "request" | "response";
    error: IpcValidationError;
    payload: unknown;
  }) => void;
};

// IPC registration validates both directions against the shared contract so renderer/main drift is
// caught immediately instead of surfacing as loosely-typed runtime bugs.
export function registerIpcHandlers(
  ipcMain: Pick<IpcMain, "handle">,
  handlers: IpcHandlerMap,
  options: RegisterIpcHandlersOptions = {},
): void {
  const registerChannel = <C extends IpcChannel>(channel: C) => {
    ipcMain.handle(channel, async (event, payload) => {
      const request = ipcContractSchemas[channel].request.safeParse(payload ?? {});
      if (!request.success) {
        const error = new IpcValidationError(
          `Invalid payload for ${channel}: ${request.error.message}`,
        );
        options.onValidationError?.({
          channel,
          stage: "request",
          error,
          payload: payload ?? {},
        });
        throw error;
      }

      const responsePayload = await handlers[channel](request.data, event);
      const response = ipcContractSchemas[channel].response.safeParse(responsePayload);

      if (!response.success) {
        const error = new IpcValidationError(
          `Invalid response for ${channel}: ${response.error.message}`,
        );
        options.onValidationError?.({
          channel,
          stage: "response",
          error,
          payload: responsePayload,
        });
        throw error;
      }

      return response.data;
    });
  };

  for (const channel of ipcChannels) {
    registerChannel(channel);
  }
}
