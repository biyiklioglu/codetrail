import { type Ref, type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

function assignRef<T>(ref: Ref<T> | undefined, value: T): void {
  if (!ref) {
    return;
  }
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  ref.current = value;
}

export function useVirtualListWindow({
  itemCount,
  itemHeight,
  overscan = 6,
  activeIndex = -1,
  enabled = true,
  externalRef,
}: {
  itemCount: number;
  itemHeight: number;
  overscan?: number;
  activeIndex?: number;
  enabled?: boolean;
  externalRef?: Ref<HTMLDivElement> | undefined;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      assignRef(externalRef, node);
      setViewportHeight(node?.clientHeight ?? 0);
      setScrollTop(node?.scrollTop ?? 0);
    },
    [externalRef],
  );

  useEffect(() => {
    if (!enabled || typeof ResizeObserver === "undefined") {
      return;
    }
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setViewportHeight(node.clientHeight);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [enabled]);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const windowState = useMemo(() => {
    if (!enabled || itemCount <= 0) {
      return {
        startIndex: 0,
        endIndex: itemCount,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
        isVirtualized: false,
      };
    }

    if (viewportHeight <= 0) {
      return {
        startIndex: 0,
        endIndex: itemCount,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
        isVirtualized: false,
      };
    }

    const safeOverscan = Math.max(1, overscan);
    const windowSize = Math.max(1, Math.ceil(viewportHeight / itemHeight) + safeOverscan * 2);

    let startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - safeOverscan);
    let endIndex = Math.min(itemCount, startIndex + windowSize);

    if (activeIndex >= 0 && activeIndex < itemCount) {
      if (activeIndex < startIndex) {
        startIndex = Math.max(0, activeIndex - safeOverscan);
        endIndex = Math.min(itemCount, startIndex + windowSize);
      } else if (activeIndex >= endIndex) {
        endIndex = Math.min(itemCount, activeIndex + safeOverscan + 1);
        startIndex = Math.max(0, endIndex - windowSize);
      }
    }

    return {
      startIndex,
      endIndex,
      topSpacerHeight: startIndex * itemHeight,
      bottomSpacerHeight: Math.max(0, (itemCount - endIndex) * itemHeight),
      isVirtualized: endIndex - startIndex < itemCount,
    };
  }, [activeIndex, enabled, itemCount, itemHeight, overscan, scrollTop, viewportHeight]);

  return {
    containerRef,
    setContainerRef,
    handleScroll,
    ...windowState,
  };
}
