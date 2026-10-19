import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NavMenu } from "@/components/layout/nav-menu";

/**
 * The hamburger panel must close on Escape, like the cart drawer — the
 * production audit of 20 Oct 2026 found it stayed open, leaving keyboard
 * users to tab to "Close menu".
 */

afterEach(() => cleanup());

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: /menu/i }));
}

describe("NavMenu", () => {
  it("opens the panel and reports it as expanded", () => {
    render(<NavMenu />);
    openMenu();

    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^menu$/i }).getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("closes on Escape", () => {
    render(<NavMenu />);
    openMenu();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /^menu$/i }).getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("ignores other keys", () => {
    render(<NavMenu />);
    openMenu();

    fireEvent.keyDown(window, { key: "Enter" });

    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
  });
});
