import { contextBridge, ipcRenderer } from "electron";

import type { IpcChannel, IpcRequestInput, IpcResponse } from "@codetrail/core";

import { APP_COMMAND_CHANNEL, type AppCommand } from "../shared/appCommands";
import { normalizeDesktopPlatform } from "../shared/desktopPlatform";
import {
  HISTORY_EXPORT_PROGRESS_CHANNEL,
  type HistoryExportProgressPayload,
} from "../shared/historyExport";

type InvokeApi = {
  platform: ReturnType<typeof normalizeDesktopPlatform>;
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequestInput<C>): Promise<IpcResponse<C>>;
  onHistoryExportProgress(listener: (payload: HistoryExportProgressPayload) => void): () => void;
  onAppCommand(listener: (command: AppCommand) => void): () => void;
};

const api: InvokeApi = {
  platform: normalizeDesktopPlatform(process.platform),
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  onHistoryExportProgress: (listener) => {
    const handler = (_event: unknown, payload: HistoryExportProgressPayload) => {
      listener(payload);
    };
    ipcRenderer.on(HISTORY_EXPORT_PROGRESS_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(HISTORY_EXPORT_PROGRESS_CHANNEL, handler);
    };
  },
  onAppCommand: (listener) => {
    const handler = (_event: unknown, command: AppCommand) => {
      listener(command);
    };
    ipcRenderer.on(APP_COMMAND_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(APP_COMMAND_CHANNEL, handler);
    };
  },
};

contextBridge.exposeInMainWorld("codetrail", api);
