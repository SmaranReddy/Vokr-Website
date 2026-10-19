import { describe, expect, it } from "vitest";

import { CONTACT_DETAILS } from "@/config/support-content";

/**
 * The homepage "Contact Us" accordion and /support-contact once listed a
 * placeholder phone number and a chat that does not exist (production
 * audit, 20 Oct 2026). Neither may come back without a real one.
 */
describe("CONTACT_DETAILS", () => {
  it("lists no phone number or chat", () => {
    const titles = CONTACT_DETAILS.map((detail) => detail.title);
    expect(titles).toEqual(["Email", "Hours"]);
    const text = JSON.stringify(CONTACT_DETAILS);
    expect(text).not.toMatch(/0000|\+91|chat/i);
  });
});
