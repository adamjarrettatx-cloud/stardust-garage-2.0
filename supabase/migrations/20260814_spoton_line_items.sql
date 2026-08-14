-- Persistent item-level SpotOn sales data + read-only analytics RPCs.
--
-- spoton_import_batches.raw_rows already keeps every CSV row verbatim
-- forever (see 20260726_financial_ledger.sql), but it's one big jsonb blob
-- per batch — fine for audit/re-derivation, unusable for "top 15 items this
-- month" style queries. This migration unpacks those raw rows into a real
-- table, indexed for the item-sales analytics page on /bananas/financials.
--
-- Existing confirmed batches are backfilled once, inline, at the bottom of
-- this file. New imports get their line items written by the PATCH route in
-- app/api/admin/financial-ledger/spoton-import/route.js at confirm time —
-- this migration does not change that route's behavior, it only adds
-- somewhere for it to additionally write to.

create table if not exists public.spoton_line_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.spoton_import_batches(id) on delete cascade,

  item_name text not null,
  -- Raw per-line "Item ID" from the CSV (looks like "<order_id>-<n>") — unique
  -- per sold line, NOT a stable product key. Kept for order-level traceability.
  item_id text,
  -- SpotOn's actual menu/product identifier — stable across every sale of the
  -- same product. This is the correct group-by key for "top selling items".
  menu_item_id text,
  category text,

  quantity numeric not null default 0,
  unit_price_cents integer not null default 0,
  net_sales_cents integer not null default 0,
  gross_sales_cents integer not null default 0,
  taxes_cents integer not null default 0,
  discounts_cents integer not null default 0,

  business_date date,
  added_date date,
  added_time text,
  -- 0-23, parsed from "Added Time" (e.g. "6:08 AM"). Null when unparseable.
  added_hour smallint check (added_hour is null or (added_hour >= 0 and added_hour <= 23)),
  day_of_week text,

  order_id text,
  order_number text,
  table_number text,
  employee_name text,

  is_void boolean not null default false,
  is_refund boolean not null default false,
  is_gift_card boolean not null default false,

  created_at timestamptz not null default now()
);

create index if not exists spoton_line_items_batch_id_idx on public.spoton_line_items(batch_id);
create index if not exists spoton_line_items_business_date_idx on public.spoton_line_items(business_date);
create index if not exists spoton_line_items_menu_item_id_idx on public.spoton_line_items(menu_item_id);
create index if not exists spoton_line_items_added_hour_idx on public.spoton_line_items(added_hour);

alter table public.spoton_line_items enable row level security;

drop policy if exists spoton_line_items_owner_select on public.spoton_line_items;
drop policy if exists spoton_line_items_owner_insert on public.spoton_line_items;
drop policy if exists spoton_line_items_owner_update on public.spoton_line_items;
drop policy if exists spoton_line_items_owner_delete on public.spoton_line_items;
create policy spoton_line_items_owner_select on public.spoton_line_items for select to authenticated using (public.is_owner());
create policy spoton_line_items_owner_insert on public.spoton_line_items for insert to authenticated with check (public.is_owner());
create policy spoton_line_items_owner_update on public.spoton_line_items for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy spoton_line_items_owner_delete on public.spoton_line_items for delete to authenticated using (public.is_owner());

-- ---------------------------------------------------------------------------
-- Analytics RPCs. All owner-gated (SECURITY INVOKER, so RLS above still
-- applies) and read-only. The Next.js route calls these via supabase-js
-- .rpc() rather than re-implementing the aggregation in JS on every request.
-- ---------------------------------------------------------------------------

-- Top selling products by quantity and revenue, grouped by the stable
-- menu_item_id (falls back to item_name when menu_item_id is blank so
-- nothing silently disappears from the ranking).
create or replace function public.analytics_top_items(limit_n integer default 20)
returns table (
  product_key text,
  item_name text,
  category text,
  total_quantity numeric,
  total_net_cents bigint,
  order_count bigint
)
language sql
security invoker
stable
as $$
  select
    coalesce(li.menu_item_id, li.item_name) as product_key,
    (array_agg(li.item_name order by li.added_date desc))[1] as item_name,
    (array_agg(li.category order by li.added_date desc))[1] as category,
    sum(li.quantity) as total_quantity,
    sum(li.net_sales_cents) as total_net_cents,
    count(distinct li.order_id) as order_count
  from public.spoton_line_items li
  where not li.is_void
  group by coalesce(li.menu_item_id, li.item_name)
  order by total_net_cents desc
  limit limit_n;
$$;
revoke all on function public.analytics_top_items(integer) from public;
grant execute on function public.analytics_top_items(integer) to authenticated;

-- Transactions and revenue by hour of day (0-23), for "most popular times".
create or replace function public.analytics_sales_by_hour()
returns table (
  hour_of_day smallint,
  line_item_count bigint,
  order_count bigint,
  total_net_cents bigint
)
language sql
security invoker
stable
as $$
  select
    li.added_hour as hour_of_day,
    count(*) as line_item_count,
    count(distinct li.order_id) as order_count,
    sum(li.net_sales_cents) as total_net_cents
  from public.spoton_line_items li
  where not li.is_void and li.added_hour is not null
  group by li.added_hour
  order by li.added_hour;
$$;
revoke all on function public.analytics_sales_by_hour() from public;
grant execute on function public.analytics_sales_by_hour() to authenticated;

-- Top 5 items within each of 4 day-parts, so "most popular times + most
-- popular products at those times" reads as one compact table instead of a
-- 24-way item breakdown.
create or replace function public.analytics_top_items_by_daypart()
returns table (
  day_part text,
  item_name text,
  total_quantity numeric,
  rank_in_daypart bigint
)
language sql
security invoker
stable
as $$
  with bucketed as (
    select
      case
        when li.added_hour between 6 and 10 then 'Morning (6a-11a)'
        when li.added_hour between 11 and 16 then 'Afternoon (11a-5p)'
        when li.added_hour between 17 and 20 then 'Evening (5p-9p)'
        else 'Late Night (9p-6a)'
      end as day_part,
      coalesce(li.menu_item_id, li.item_name) as product_key,
      li.item_name,
      li.quantity
    from public.spoton_line_items li
    where not li.is_void and li.added_hour is not null
  ),
  totals as (
    select day_part, product_key, (array_agg(item_name))[1] as item_name, sum(quantity) as total_quantity
    from bucketed
    group by day_part, product_key
  ),
  ranked as (
    select
      day_part, item_name, total_quantity,
      row_number() over (partition by day_part order by total_quantity desc) as rank_in_daypart
    from totals
  )
  select day_part, item_name, total_quantity, rank_in_daypart
  from ranked
  where rank_in_daypart <= 5
  order by
    case day_part
      when 'Morning (6a-11a)' then 1
      when 'Afternoon (11a-5p)' then 2
      when 'Evening (5p-9p)' then 3
      else 4
    end,
    rank_in_daypart;
$$;
revoke all on function public.analytics_top_items_by_daypart() from public;
grant execute on function public.analytics_top_items_by_daypart() to authenticated;

-- Weekly quantity/revenue trend for ONE product (by product_key, i.e.
-- menu_item_id or item_name fallback) — "is this item becoming more popular
-- the longer we've been open, or flat?"
create or replace function public.analytics_item_trend(product_key_in text)
returns table (
  week_start date,
  total_quantity numeric,
  total_net_cents bigint
)
language sql
security invoker
stable
as $$
  select
    date_trunc('week', li.business_date)::date as week_start,
    sum(li.quantity) as total_quantity,
    sum(li.net_sales_cents) as total_net_cents
  from public.spoton_line_items li
  where not li.is_void
    and coalesce(li.menu_item_id, li.item_name) = product_key_in
    and li.business_date is not null
  group by 1
  order by 1;
$$;
revoke all on function public.analytics_item_trend(text) from public;
grant execute on function public.analytics_item_trend(text) to authenticated;

-- Every calendar day's total net sales, full history, for the single-screen
-- all-time bar chart.
create or replace function public.analytics_daily_sales()
returns table (
  business_date date,
  total_net_cents bigint,
  total_quantity numeric
)
language sql
security invoker
stable
as $$
  select
    li.business_date,
    sum(li.net_sales_cents) as total_net_cents,
    sum(li.quantity) as total_quantity
  from public.spoton_line_items li
  where not li.is_void and li.business_date is not null
  group by li.business_date
  order by li.business_date;
$$;
revoke all on function public.analytics_daily_sales() from public;
grant execute on function public.analytics_daily_sales() to authenticated;

-- Distinct products, for the item-trend picker's dropdown.
create or replace function public.analytics_item_catalog()
returns table (
  product_key text,
  item_name text,
  category text,
  total_quantity numeric
)
language sql
security invoker
stable
as $$
  select
    coalesce(li.menu_item_id, li.item_name) as product_key,
    (array_agg(li.item_name order by li.added_date desc))[1] as item_name,
    (array_agg(li.category order by li.added_date desc))[1] as category,
    sum(li.quantity) as total_quantity
  from public.spoton_line_items li
  where not li.is_void
  group by coalesce(li.menu_item_id, li.item_name)
  order by total_quantity desc;
$$;
revoke all on function public.analytics_item_catalog() from public;
grant execute on function public.analytics_item_catalog() to authenticated;

-- TicketTailor purchase lead time: how many days before an event people buy,
-- bucketed. Reads straight from ticket_order_attribution.raw_payload, which
-- carries the real TicketTailor order-creation unix time and the event's
-- real start-date unix time — both more reliable than this table's own
-- created_at (that column is when OUR sync ran, not when the order happened).
create or replace function public.analytics_tickettailor_lead_time()
returns table (
  lead_bucket text,
  order_count bigint,
  sort_order smallint
)
language sql
security invoker
stable
as $$
  with orders as (
    select
      to_timestamp((toa.raw_payload->>'created_at')::bigint) as purchased_at,
      to_timestamp((toa.raw_payload->'event_summary'->'start_date'->>'unix')::bigint) as event_starts_at
    from public.ticket_order_attribution toa
    where toa.status = 'completed'
      and toa.raw_payload->>'created_at' is not null
      and toa.raw_payload->'event_summary'->'start_date'->>'unix' is not null
  ),
  with_lead as (
    select extract(epoch from (event_starts_at - purchased_at)) / 86400.0 as lead_days
    from orders
  ),
  bucketed as (
    select
      case
        when lead_days < 0 then 'After event (data issue)'
        when lead_days < 1 then 'Same day'
        when lead_days < 4 then '1-3 days before'
        when lead_days < 8 then '4-7 days before'
        when lead_days < 15 then '1-2 weeks before'
        when lead_days < 31 then '2-4 weeks before'
        else '1+ month before'
      end as lead_bucket,
      case
        when lead_days < 0 then 0
        when lead_days < 1 then 1
        when lead_days < 4 then 2
        when lead_days < 8 then 3
        when lead_days < 15 then 4
        when lead_days < 31 then 5
        else 6
      end::smallint as sort_order
    from with_lead
  )
  select lead_bucket, count(*) as order_count, sort_order
  from bucketed
  group by lead_bucket, sort_order
  order by sort_order;
$$;
revoke all on function public.analytics_tickettailor_lead_time() from public;
grant execute on function public.analytics_tickettailor_lead_time() to authenticated;

-- ---------------------------------------------------------------------------
-- One-time backfill: unpack every already-confirmed batch's raw_rows into
-- spoton_line_items. Idempotent — skips a batch that's already been
-- unpacked, so re-running this migration (or a future manual re-run) is safe.
-- ---------------------------------------------------------------------------
do $$
declare
  b record;
  r jsonb;
  qty numeric;
  hour_val smallint;
  time_str text;
  hour_part text;
  ampm text;
  h_num integer;
begin
  for b in
    select id, raw_rows
    from public.spoton_import_batches
    where status = 'confirmed'
      and raw_rows is not null
      and not exists (select 1 from public.spoton_line_items where batch_id = spoton_import_batches.id)
  loop
    for r in select * from jsonb_array_elements(b.raw_rows)
    loop
      qty := nullif(r->>'Quantity', '')::numeric;

      hour_val := null;
      time_str := r->>'Added Time';
      if time_str is not null and time_str ~* '^\s*\d{1,2}:\d{2}\s*(AM|PM)\s*$' then
        hour_part := split_part(split_part(trim(time_str), ':', 1), ' ', 1);
        ampm := upper(trim(substring(trim(time_str) from '(?i)(AM|PM)\s*$')));
        h_num := hour_part::integer;
        if ampm = 'AM' then
          hour_val := case when h_num = 12 then 0 else h_num end;
        else
          hour_val := case when h_num = 12 then 12 else h_num + 12 end;
        end if;
      end if;

      insert into public.spoton_line_items (
        batch_id, item_name, item_id, menu_item_id, category,
        quantity, unit_price_cents, net_sales_cents, gross_sales_cents, taxes_cents, discounts_cents,
        business_date, added_date, added_time, added_hour, day_of_week,
        order_id, order_number, table_number, employee_name,
        is_void, is_refund, is_gift_card
      ) values (
        b.id,
        coalesce(r->>'Item Name', '(unnamed item)'),
        r->>'Item ID',
        r->>'Menu Item ID',
        nullif(r->>'Category', ''),
        coalesce(qty, 0),
        round(coalesce(nullif(r->>'Menu Item Price', '')::numeric, 0) * 100)::integer,
        round(coalesce(nullif(r->>'Net Sales', '')::numeric, 0) * 100)::integer,
        round(coalesce(nullif(r->>'Gross Sales', '')::numeric, 0) * 100)::integer,
        round(coalesce(nullif(r->>'Taxes', '')::numeric, 0) * 100)::integer,
        round(coalesce(nullif(r->>'Discounts', '')::numeric, 0) * 100)::integer,
        case
          when r->>'Business Date' ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'Business Date')::date
          when r->>'Business Date' ~ '^\d{8}$' then to_date(r->>'Business Date', 'YYYYMMDD')
          else null
        end,
        case when r->>'Added Date' ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'Added Date')::date else null end,
        r->>'Added Time',
        hour_val,
        r->>'Day of Week',
        r->>'Order ID',
        r->>'Order Number',
        nullif(r->>'Table Number', ''),
        nullif(r->>'Employee Name', ''),
        lower(coalesce(r->>'Is Void', 'No')) in ('yes', 'y', 'true', '1'),
        lower(coalesce(r->>'Is Refund', 'No')) in ('yes', 'y', 'true', '1'),
        lower(coalesce(r->>'Is Gift Card', 'No')) in ('yes', 'y', 'true', '1')
      );
    end loop;
  end loop;
end $$;
