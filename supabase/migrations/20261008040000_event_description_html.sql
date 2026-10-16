-- Formatted event descriptions (bold, italic, underline, lists, links).
--
-- events.description stays the plain-text source of truth for the mobile app,
-- team schedule, TicketTailor and calendar previews. description_html is an
-- optional formatted copy rendered only by the website event page, which
-- re-sanitizes it against a strict allow-list on every render.
alter table public.events
  add column if not exists description_html text;

comment on column public.events.description_html is
  'Optional formatted copy of description (sanitized HTML subset). Website only; description remains the plain-text source of truth.';

-- If something rewrites the plain description without also writing the
-- formatted copy (the mobile admin form, imports, SQL fixes), drop the stale
-- formatted copy so the website falls back to the new plain text instead of
-- showing old wording.
create or replace function public.events_clear_stale_description_html()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.description is distinct from old.description
     and new.description_html is not distinct from old.description_html then
    new.description_html := null;
  end if;
  if new.description is null then
    new.description_html := null;
  end if;
  return new;
end;
$$;

drop trigger if exists events_clear_stale_description_html on public.events;
create trigger events_clear_stale_description_html
  before update of description, description_html on public.events
  for each row execute function public.events_clear_stale_description_html();
