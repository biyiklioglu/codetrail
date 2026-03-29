import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { PaneFocusProvider, useCreatePaneFocusController } from "../lib/paneFocusController";

export function renderWithPaneFocus(element: ReactElement) {
  function Wrapper({ children }: { children: ReactNode }) {
    const controller = useCreatePaneFocusController();
    return <PaneFocusProvider controller={controller}>{children}</PaneFocusProvider>;
  }

  return render(element, { wrapper: Wrapper });
}
