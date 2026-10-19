import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { AdminReturnForm } = await import("../admin-return-form");

/** The operator's on-behalf form sends exactly the admin schema's fields; the server does the checking. */
describe("AdminReturnForm", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ return: { id: "r1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("posts a return with the operator's note and no exchange size", async () => {
    render(<AdminReturnForm orderNumber="VK-10001" skus={["VK-A", "VK-B"]} />);
    fireEvent.change(screen.getByLabelText("Item"), { target: { value: "VK-B" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "defective" } });
    fireEvent.change(screen.getByLabelText("How the customer asked (required)"), { target: { value: "customer emailed" } });
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));
    await screen.findByText("Recorded as requested.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/orders/VK-10001/returns");
    expect(JSON.parse(init.body)).toEqual({ sku: "VK-B", quantity: 1, kind: "return", reason: "defective", note: "customer emailed" });
  });

  it("an exchange carries the wanted size", async () => {
    render(<AdminReturnForm orderNumber="VK-10001" skus={["VK-A"]} />);
    fireEvent.click(screen.getByLabelText("Exchange"));
    fireEvent.change(screen.getByLabelText("Size wanted instead (e.g. IN 9)"), { target: { value: " IN 9 " } });
    fireEvent.change(screen.getByLabelText("How the customer asked (required)"), { target: { value: "phone call" } });
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));
    await screen.findByText("Recorded as requested.");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ kind: "exchange", exchangeSize: "IN 9" });
  });

  it("shows the server's refusal", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "CONFLICT", message: "A return or exchange for this item is already open." } }), { status: 409 }),
    );
    render(<AdminReturnForm orderNumber="VK-10001" skus={["VK-A"]} />);
    fireEvent.change(screen.getByLabelText("How the customer asked (required)"), { target: { value: "phone call" } });
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));
    expect(await screen.findByText(/already open/)).toBeTruthy();
  });
});
