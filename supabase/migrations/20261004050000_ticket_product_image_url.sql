-- Optional thumbnail image for a ticket product. Used by private-space
-- rentals so buyers can see the room before booking. Stored as a public
-- URL in the existing `event-images` bucket (same upload path as flyers).
alter table public.ticket_products
  add column if not exists image_url text;

comment on column public.ticket_products.image_url is
  'Optional public thumbnail URL (event-images bucket). Shown on private-space rentals.';
