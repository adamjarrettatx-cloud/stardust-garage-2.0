-- Repair the two financial FKs omitted by 20260912001000_backfill_yoga_sound_healing.sql.
-- That backfill has already run in production, so this intentionally updates only
-- financial rows that still point to its September 16 source occurrence.
--
-- Manual verification after deploy:
-- with yoga_events as (
--   select id, event_date
--   from public.events
--   where id = 'c5d89d5f-1b4e-4d61-894a-b21e7cba5f37'
--      or (slug = 'yoga-sound-healing-at-stardust-garage-2026-09-09'
--          and event_date = '2026-09-09')
-- )
-- select 'event_financial_config' as table_name, event_id, count(*)
-- from public.event_financial_config
-- where event_id in (select id from yoga_events)
-- group by event_id
-- union all
-- select 'pos_import_batches' as table_name, event_id, count(*)
-- from public.pos_import_batches
-- where event_id in (select id from yoga_events)
-- group by event_id
-- order by table_name, event_id;

do $$
declare
  v_old_id constant uuid := 'c5d89d5f-1b4e-4d61-894a-b21e7cba5f37';
  v_new_id uuid;
begin
  -- Use the original backfill's source predicate so this does not touch another
  -- occurrence if either historical row has been changed unexpectedly.
  if not exists (
    select 1
    from public.events
    where id = v_old_id and event_date = '2026-09-16'
  ) then
    return;
  end if;

  select id into v_new_id
  from public.events
  where slug = 'yoga-sound-healing-at-stardust-garage-2026-09-09'
    and event_date = '2026-09-09';

  -- If the recreated September 9 occurrence is absent, leave the financial rows
  -- untouched rather than guessing a target.
  if v_new_id is null then
    return;
  end if;

  update public.event_financial_config
  set event_id = v_new_id
  where event_id = v_old_id;

  update public.pos_import_batches
  set event_id = v_new_id
  where event_id = v_old_id;
end $$;
