import { useEffect, useState } from "react";

import { MAX_ZOOM_PERCENT, MIN_ZOOM_PERCENT, parseZoomPercent } from "../lib/zoom";

export function ZoomPercentInput({
  value,
  onCommit,
  ariaLabel = "Zoom percentage",
  title,
  wrapperClassName,
  inputClassName,
}: {
  value: number;
  onCommit: (value: number) => void;
  ariaLabel?: string;
  title?: string;
  wrapperClassName?: string;
  inputClassName?: string;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commitDraft = () => {
    const parsed = parseZoomPercent(draft);
    if (parsed === null) {
      setDraft(String(value));
      return;
    }

    setDraft(String(parsed));
    if (parsed !== value) {
      onCommit(parsed);
    }
  };

  return (
    <div className={wrapperClassName}>
      <input
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel}
        className={inputClassName}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
        title={title ?? `Zoom level (${MIN_ZOOM_PERCENT}%-${MAX_ZOOM_PERCENT}%)`}
      />
      <span className="zoom-percent-suffix" aria-hidden>
        %
      </span>
    </div>
  );
}
