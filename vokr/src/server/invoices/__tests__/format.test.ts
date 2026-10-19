import { describe, expect, it, vi } from "vitest";

// render.ts / issue.ts also import the database client; these tests are pure.
vi.mock("@/server/db/client", () => ({ prisma: {} }));

import {
  amountInWords,
  financialYearOf,
  GSTIN_PATTERN,
  invoiceNumberFor,
  InvoiceBlockedError,
  parseInvoiceSeller,
  rupeesInWords,
} from "../format";
import { assertInvoiceable } from "../issue";
import { renderInvoiceHtml, type InvoiceDocument } from "../render";

/** Obviously fake, test-only seller — not the answer to decision D3. */
const SELLER_ENV = {
  INVOICE_SELLER_LEGAL_NAME: "TEST SELLER (NOT REAL)",
  INVOICE_SELLER_GSTIN: "27AAAAA0000A1Z5",
  INVOICE_SELLER_ADDRESS: "1 Test Lane, Pune 411001",
  CHECKOUT_SELLER_STATE: "Maharashtra",
};

describe("financialYearOf (April–March, Asia/Kolkata)", () => {
  it("turns over at 1 April 00:00 IST, not UTC", () => {
    expect(financialYearOf(new Date("2027-03-31T18:29:59Z"))).toBe("2026-27"); // 31 Mar 23:59:59 IST
    expect(financialYearOf(new Date("2027-03-31T18:30:00Z"))).toBe("2027-28"); // 1 Apr 00:00 IST
    expect(financialYearOf(new Date("2026-10-17T00:00:00Z"))).toBe("2026-27");
    expect(financialYearOf(new Date("2099-12-31T00:00:00Z"))).toBe("2099-00");
  });
});

describe("invoiceNumberFor", () => {
  it("is at most 16 characters and unique per year", () => {
    expect(invoiceNumberFor("2026-27", 1)).toBe("VK/2627/000001");
    expect(invoiceNumberFor("2026-27", 999_999)).toBe("VK/2627/999999");
    expect(invoiceNumberFor("2026-27", 999_999).length).toBeLessThanOrEqual(16);
    expect(() => invoiceNumberFor("2026-27", 0)).toThrow();
    expect(() => invoiceNumberFor("2026-27", 1_000_000)).toThrow();
    expect(() => invoiceNumberFor("26-27", 1)).toThrow();
  });
});

describe("parseInvoiceSeller (decision D3)", () => {
  it("accepts complete, consistent details", () => {
    expect(parseInvoiceSeller(SELLER_ENV)).toEqual({
      legalName: "TEST SELLER (NOT REAL)",
      gstin: "27AAAAA0000A1Z5",
      address: "1 Test Lane, Pune 411001",
      state: "Maharashtra",
      stateCode: "27",
    });
  });
  it("names every missing value and invents none", () => {
    expect(() => parseInvoiceSeller({})).toThrow(
      /INVOICE_SELLER_LEGAL_NAME, INVOICE_SELLER_GSTIN, INVOICE_SELLER_ADDRESS, CHECKOUT_SELLER_STATE/,
    );
    expect(() => parseInvoiceSeller({ ...SELLER_ENV, INVOICE_SELLER_GSTIN: "  " })).toThrow(InvoiceBlockedError);
  });
  it("refuses a malformed GSTIN or one registered in another state", () => {
    expect(() => parseInvoiceSeller({ ...SELLER_ENV, INVOICE_SELLER_GSTIN: "27AAAAA0000A1X5" })).toThrow(/well-formed/);
    expect(() => parseInvoiceSeller({ ...SELLER_ENV, INVOICE_SELLER_GSTIN: "29AAAAA0000A1Z5" })).toThrow(/does not match/);
    expect(() => parseInvoiceSeller({ ...SELLER_ENV, CHECKOUT_SELLER_STATE: "Atlantis" })).toThrow(/not a GST state/);
  });
  it("normalises case", () => {
    expect(parseInvoiceSeller({ ...SELLER_ENV, INVOICE_SELLER_GSTIN: "27aaaaa0000a1z5" }).gstin).toBe("27AAAAA0000A1Z5");
    expect(GSTIN_PATTERN.test("27AAAAA0000A1Z5")).toBe(true);
  });
});

describe("amount in words (Indian system)", () => {
  it.each([
    [0, "Rupees Zero Only"],
    [100, "Rupees One Only"],
    [999_550, "Rupees Nine Thousand Nine Hundred Ninety-Five and Fifty Paise Only"],
    [29_500, "Rupees Two Hundred Ninety-Five Only"],
    [10_000_000, "Rupees One Lakh Only"],
    [123_456_789, "Rupees Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven and Eighty-Nine Paise Only"],
    [1_000_000_000, "Rupees One Crore Only"],
    [2_147_483_647, "Rupees Two Crore Fourteen Lakh Seventy-Four Thousand Eight Hundred Thirty-Six and Forty-Seven Paise Only"],
  ])("%i paise", (paise, words) => {
    expect(amountInWords(paise)).toBe(words);
  });
  it("handles teens and round tens", () => {
    expect(rupeesInWords(11_019)).toBe("Eleven Thousand Nineteen");
    expect(rupeesInWords(90)).toBe("Ninety");
  });
});

describe("assertInvoiceable", () => {
  const seller = parseInvoiceSeller(SELLER_ENV);
  const line = { hsnCode: "6404", gstRateBps: 1800, lineSubtotalPaise: 999_500, lineTaxPaise: 152_466, cgstPaise: 76_233, sgstPaise: 76_233, igstPaise: 0 };
  const order = {
    id: "o1",
    sellerState: "Maharashtra",
    shipState: "Maharashtra",
    gstSplit: "intra_state",
    subtotalPaise: 999_500,
    taxPaise: 152_466,
    shippingPaise: 0,
    codFeePaise: 0,
    totalPaise: 999_500,
    items: [line],
  };

  it("accepts an order whose snapshot reconciles", () => {
    expect(() => assertInvoiceable(order, seller)).not.toThrow();
  });
  it("refuses fees whose GST treatment is undecided", () => {
    expect(() => assertInvoiceable({ ...order, shippingPaise: 9_900, totalPaise: 1_009_400 }, seller)).toThrow(/D11/);
    expect(() => assertInvoiceable({ ...order, codFeePaise: 4_900, totalPaise: 1_004_400 }, seller)).toThrow(/D11/);
  });
  it("refuses a seller-state, split, line or total mismatch", () => {
    expect(() => assertInvoiceable({ ...order, sellerState: "Karnataka" }, seller)).toThrow(/seller state/);
    expect(() => assertInvoiceable({ ...order, gstSplit: "inter_state" }, seller)).toThrow(/GST split/);
    expect(() => assertInvoiceable({ ...order, items: [{ ...line, hsnCode: "" }] }, seller)).toThrow(/HSN/);
    expect(() => assertInvoiceable({ ...order, items: [{ ...line, sgstPaise: 1 }] }, seller)).toThrow(/does not add up/);
    expect(() => assertInvoiceable({ ...order, items: [{ ...line, cgstPaise: 0, sgstPaise: 0, igstPaise: 152_466 }] }, seller)).toThrow(/contradicts/);
    expect(() => assertInvoiceable({ ...order, taxPaise: 1 }, seller)).toThrow(/totals/);
    expect(() => assertInvoiceable({ ...order, totalPaise: 1 }, seller)).toThrow(/total does not reconcile/);
    expect(() => assertInvoiceable({ ...order, items: [] }, seller)).toThrow(/no lines/);
  });
  it("accepts an inter-state sale split as IGST", () => {
    const inter = { ...order, shipState: "Karnataka", gstSplit: "inter_state", items: [{ ...line, cgstPaise: 0, sgstPaise: 0, igstPaise: 152_466 }] };
    expect(() => assertInvoiceable(inter, seller)).not.toThrow();
  });
});

describe("renderInvoiceHtml", () => {
  const doc: InvoiceDocument = {
    invoiceNumber: "VK/2627/000001",
    issuedAt: new Date("2026-10-17T06:00:00Z"),
    orderNumber: "VK-10001",
    placedAt: new Date("2026-10-16T06:00:00Z"),
    seller: parseInvoiceSeller(SELLER_ENV),
    buyer: { name: `Asha <b>"Rao"</b>`, line1: "12 MG Road & Co", line2: null, city: "Pune", state: "Maharashtra", pincode: "411001" },
    placeOfSupply: { state: "Maharashtra", code: "27" },
    paymentMethod: "prepaid",
    lines: [
      {
        description: "Model X · IN 8 · <Black>",
        sku: "VK-MX-BLK-IN08",
        hsnCode: "6404",
        gstRateBps: 1800,
        quantity: 1,
        unitPricePaise: 999_500,
        lineSubtotalPaise: 999_500,
        lineTaxPaise: 152_466,
        cgstPaise: 76_233,
        sgstPaise: 76_233,
        igstPaise: 0,
      },
    ],
    subtotalPaise: 999_500,
    taxPaise: 152_466,
    totalPaise: 999_500,
  };

  it("carries the r.46 particulars", () => {
    const html = renderInvoiceHtml(doc);
    for (const expected of [
      "Tax Invoice",
      "VK/2627/000001",
      "TEST SELLER (NOT REAL)",
      "GSTIN: 27AAAAA0000A1Z5",
      "State: Maharashtra (27)",
      "Place of supply: Maharashtra (27)",
      "6404",
      "9%", // CGST and SGST rates
      "8,470.34", // taxable value = 9,995.00 − 1,524.66
      "762.33",
      "9,995.00",
      "Rupees Nine Thousand Nine Hundred Ninety-Five Only",
      "Tax payable on reverse charge: No",
      "GSTIN: Unregistered",
      "Authorised signatory",
    ]) {
      expect(html).toContain(expected);
    }
    expect(html).not.toContain("IGST");
  });

  it("escapes customer-entered values", () => {
    const html = renderInvoiceHtml(doc);
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<Black>");
    expect(html).toContain("Asha &lt;b&gt;&quot;Rao&quot;&lt;/b&gt;");
    expect(html).toContain("12 MG Road &amp; Co");
  });

  it("shows IGST alone for an inter-state sale", () => {
    const html = renderInvoiceHtml({
      ...doc,
      placeOfSupply: { state: "Karnataka", code: "29" },
      lines: [{ ...doc.lines[0]!, cgstPaise: 0, sgstPaise: 0, igstPaise: 152_466 }],
    });
    expect(html).toContain("<th>IGST</th>");
    expect(html).toContain("18%");
    expect(html).not.toContain("<th>CGST</th>");
  });
});
