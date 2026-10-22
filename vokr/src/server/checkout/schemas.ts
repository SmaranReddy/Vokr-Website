import { z } from "zod";

import { PINCODE_REGEX, normalizeIndianPhoneToE164 } from "@/lib/address";
import { isValidGstState } from "@/lib/gst-states";

/**
 * `.strict()` throughout — same reasoning as `server/cart/schemas.ts`:
 * an address body carrying a stray `pricePaise` or `total` field fails
 * validation before the service layer is ever reached (plan §5 Phase 6,
 * Security Requirements: "No pricing field is ever accepted from the
 * client").
 */
export const createCheckoutSessionBodySchema = z
  .object({
    idempotencyKey: z.string().min(1).max(200),
  })
  .strict();

export const addressBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    phone: z
      .string()
      .trim()
      .transform((value, ctx) => {
        const normalized = normalizeIndianPhoneToE164(value);
        if (!normalized) {
          ctx.addIssue({
            code: "custom",
            message: "phone must be a valid Indian mobile number.",
          });
          return z.NEVER;
        }
        return normalized;
      }),
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    state: z.string().refine(isValidGstState, {
      message: "state must be one of the recognised GST states.",
    }),
    pincode: z.string().regex(PINCODE_REGEX, "pincode must be 6 digits, first digit 1-8."),
    /** Required for guests (order updates, order lookup); a signed-in customer's account email is used instead. */
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()).optional(),
  })
  .strict();

export type AddressBody = z.infer<typeof addressBodySchema>;

/** Online payment only: Vokr does not offer cash on delivery (owner decision, 21 Oct 2026). */
export const pricingQuerySchema = z.object({
  paymentMethod: z.enum(["prepaid"]).default("prepaid"),
});

export const serviceabilityQuerySchema = z.object({
  pincode: z.string().regex(PINCODE_REGEX, "pincode must be 6 digits, first digit 1-8."),
});
