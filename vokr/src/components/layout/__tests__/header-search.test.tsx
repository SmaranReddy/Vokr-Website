import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The header search panel must close on Escape, like the cart drawer and
 * the menu panel — the production audit of 20 Oct 2026 found it ignored it.
 */

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const { HeaderSearch } = await import("@/components/layout/header-search");

afterEach(() => cleanup());

describe("HeaderSearch", () => {
  it("closes on Escape", () => {
    render(<HeaderSearch />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("search")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("ignores other keys", () => {
    render(<HeaderSearch />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    fireEvent.keyDown(window, { key: "a" });

    expect(screen.getByRole("search")).toBeTruthy();
  });
});
