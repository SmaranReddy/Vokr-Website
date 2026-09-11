import { describe, expect, it } from "vitest";

import { addressBodySchema } from "../schemas";

const validBody = {
  name: "Asha Rao",
  phone: "9876543210",
  line1: "12 MG Road",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560001",
};

describe("addressBodySchema (plan §5 Phase 6, task 2)", () => {
  it("accepts a valid address and normalises the phone to E.164", () => {
    const result = addressBodySchema.parse(validBody);
    expect(result.phone).toBe("+919876543210");
  });

  it("accepts an already-E.164 phone", () => {
    const result = addressBodySchema.parse({ ...validBody, phone: "+919876543210" });
    expect(result.phone).toBe("+919876543210");
  });

  it("rejects a PIN code starting with 0 or 9", () => {
    expect(() => addressBodySchema.parse({ ...validBody, pincode: "060001" })).toThrow();
    expect(() => addressBodySchema.parse({ ...validBody, pincode: "960001" })).toThrow();
  });

  it("rejects a PIN code of the wrong length", () => {
    expect(() => addressBodySchema.parse({ ...validBody, pincode: "5600" })).toThrow();
    expect(() => addressBodySchema.parse({ ...validBody, pincode: "5600011" })).toThrow();
  });

  it("rejects a state outside the fixed GST enumeration", () => {
    expect(() => addressBodySchema.parse({ ...validBody, state: "Narnia" })).toThrow();
  });

  it("rejects a phone number that is not a plausible Indian mobile number", () => {
    expect(() => addressBodySchema.parse({ ...validBody, phone: "12345" })).toThrow();
    // Landline-shaped (starts with a digit < 6) is rejected — only 6-9 leading digits are mobile.
    expect(() => addressBodySchema.parse({ ...validBody, phone: "5123456789" })).toThrow();
  });

  it("strips an extra, unrecognised field rather than silently accepting it (no client-supplied pricing)", () => {
    const result = addressBodySchema.safeParse({
      ...validBody,
      totalPaise: 1,
    });
    expect(result.success).toBe(false);
  });
});
