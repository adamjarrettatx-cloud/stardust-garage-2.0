// The Left Door: permanent private-space add-on on every event.
// Defaults mirror supabase/migrations/20261016020000_left_door_default_private_space.sql
// (the database creates the row; these are used for "Reset to default").

export const LEFT_DOOR_SYSTEM_KEY = 'left_door';
export const LEFT_DOOR_NAME = 'The Left Door';
export const LEFT_DOOR_DEFAULT_DESCRIPTION =
  'Upstairs Green Room / Vip Room (ask staff to tour the space if you are interested before purchasing). Requires a minimum of 2 people to 10 people max in the room.';
export const LEFT_DOOR_DEFAULT_IMAGE_URL =
  'https://auth.sdgatx.com/storage/v1/object/public/event-images/1791591824753-44444444.jpg';

export function isLeftDoor(product) {
  return product?.system_key === LEFT_DOOR_SYSTEM_KEY;
}

// The price tier an admin set for this event, if any.
export function leftDoorPriceTier(product) {
  return (product?.tiers || []).find((t) => t && t.status !== 'hidden' && t.is_active !== false) || null;
}

// 'off' | 'needs_price' | 'sold' | 'selling'
export function leftDoorState(product) {
  if (!product) return 'missing';
  if (product.is_active === false) return 'off';
  const tier = leftDoorPriceTier(product);
  if (!tier || !(tier.price_cents > 0)) return 'needs_price';
  if ((product.sold_count || 0) >= 1) return 'sold';
  return 'selling';
}
