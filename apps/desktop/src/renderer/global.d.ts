import type { IpcChannel, IpcRequestInput, IpcResponse } from "@codetrail/core/browser";
import type { AppCommand } from "../shared/appCommands";
import type { HistoryExportProgressPayload } from "../shared/historyExport";

declare global {
  interface Window {
    codetrail: {
      invoke<C extends IpcChannel>(
        channel: C,
        payload: IpcRequestInput<C>,
      ): Promise<IpcResponse<C>>;
      onHistoryExportProgress(
        listener: (payload: HistoryExportProgressPayload) => void,
      ): () => void;
      onAppCommand(listener: (command: AppCommand) => void): () => void;
    };
  }
}
