/** Extracted unchanged from public/demo-data/parts.snapshot.json (2026-11-18).
 * Test price and unverified product data; the GPU clearance field is genuinely absent. */
import type { Part } from "../types";

export const reviewCase: Part = {
  part_id: 8047,
  source_key: "docyx:71a4c5489e25010fcd8e83fe5e00dec2961eb83c1931ed13581d3d689737b0b5",
  category: "case",
  brand: "Unknown",
  name: "Zalman T8",
  specs: { type: "ATX Mid Tower", color: "Black", external_volume_l: 33.4, internal_35_bays: 2 },
  current_price: 58493,
  currency: "KRW",
  price_status: "test",
  data_status: "unverified",
  price_checked_at: "2026-11-18T07:24:32.006880+00:00",
  power_draw_w: 30,
  power_status: "unconfirmed",
  image_url: null,
};
