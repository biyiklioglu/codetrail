import { contextBridge, ipcRenderer } from "electron";

import type { IpcChannel, IpcRequestInput, IpcResponse } from "@codetrail/core";

import {
  HISTORY_EXPORT_PROGRESS_CHANNEL,
  type HistoryExportProgressPayload,
} from "../shared/historyExport";

type InvokeApi = {
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequestInput<C>): Promise<IpcResponse<C>>;
  onHistoryExportProgress(listener: (payload: HistoryExportProgressPayload) => void): () => void;
};

const api: InvokeApi = {
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
};

contextBridge.exposeInMainWorld("codetrail", api);
