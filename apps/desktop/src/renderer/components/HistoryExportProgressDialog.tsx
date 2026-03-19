import { useEffect, useRef } from "react";

export function HistoryExportProgressDialog({
  open,
  percent,
  message,
  scopeLabel,
}: {
  open: boolean;
  percent: number;
  message: string;
  scopeLabel: string;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog export-progress-dialog"
      onCancel={(event) => {
        event.preventDefault();
      }}
    >
      <div className="confirm-dialog-content">
        <h3 className="confirm-dialog-title">Exporting Markdown</h3>
        <p className="confirm-dialog-message">
          {scopeLabel} export in progress. Large exports can take a while.
        </p>
        <progress className="export-progress-meter" max={100} value={percent} />
        <div className="export-progress-meta">
          <span>{message}</span>
          <span>{percent}%</span>
        </div>
      </div>
    </dialog>
  );
}
