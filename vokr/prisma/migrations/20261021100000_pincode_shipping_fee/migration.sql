-- Shipping per delivery PIN code (owner decision, 21 Oct 2026): always
-- charged at the courier's rate, no free-shipping threshold. Additive: one
-- nullable column, filled from the rate card; checkout refuses to price a
-- PIN code whose fee is NULL.

ALTER TABLE "serviceable_pincodes" ADD COLUMN "shipping_fee_paise" INTEGER;

ALTER TABLE "serviceable_pincodes"
  ADD CONSTRAINT "serviceable_pincodes_shipping_fee_non_negative"
    CHECK ("shipping_fee_paise" IS NULL OR "shipping_fee_paise" >= 0);
