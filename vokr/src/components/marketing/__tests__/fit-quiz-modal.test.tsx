import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FitQuizModal } from "@/components/marketing/fit-quiz-modal";

/**
 * The fit quiz overlay must close on Escape, like the cart drawer and the
 * menu panel — the production audit of 20 Oct 2026 found it ignored it —
 * and closing that way must reset progress exactly like the × button.
 */

afterEach(() => cleanup());

function overlay() {
  // The overlay is always mounted and toggled with `hidden` (legacy parity).
  return screen.getByRole("button", { name: "Close", hidden: true }).parentElement!.parentElement!;
}

describe("FitQuizModal", () => {
  it("closes on Escape and resets the answers", () => {
    render(<FitQuizModal />);
    fireEvent.click(screen.getByRole("button", { name: "Take the Quiz" }));
    expect(overlay().hidden).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Men" }));
    expect(screen.getByRole("button", { name: "Men" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(overlay().hidden).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Take the Quiz" }));
    expect(screen.getByRole("button", { name: "Men" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("ignores other keys", () => {
    render(<FitQuizModal />);
    fireEvent.click(screen.getByRole("button", { name: "Take the Quiz" }));

    fireEvent.keyDown(window, { key: "Enter" });

    expect(overlay().hidden).toBe(false);
  });
});
