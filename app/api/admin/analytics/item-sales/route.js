import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

// GET /api/admin/analytics/item-sales
// Owner-only. Two modes:
//   (no query)        -> the full item-sales analytics bundle for the
//                        /bananas/financials "Item Sales" tab.
//   ?trend=<itemName>  -> weekly quantity/revenue trend for ONE item, merged
//                        across every underlying menu_item_id that shares
//                        that display name (see fragmentation note below).
//
// Why item_name is the public grouping key, not menu_item_id: SpotOn assigns
// a different "Menu Item ID" per channel/modifier for what is visually the
// same product to a human (e.g. "Elixir" shows up under two different
// menu_item_id values). Grouping strictly by menu_item_id under-counts real
// item popularity, so every response here rolls raw analytics_top_items()
// rows (grouped by menu_item_id in SQL) back up to item_name in JS. The raw
// per-key rows are still included (topItemsByKey) for anyone who wants to see
// the underlying split.
export async function GET(request) {
  try {
    const { unauthorized } = await requireOwner();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const trendQuery = new URL(request.url).searchParams.get('trend');

    if (trendQuery) {
      return await handleTrend(supabase, trendQuery);
    }
    return await handleOverview(supabase);
  } catch (err) {
    console.error('item-sales analytics route error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 }
    );
  }
}

async function handleOverview(supabase) {
  const [topItemsRes, hourRes, daypartRes, dailyRes, leadTimeRes] = await Promise.all([
    supabase.rpc('analytics_top_items', { limit_n: 500 }),
    supabase.rpc('analytics_sales_by_hour'),
    supabase.rpc('analytics_top_items_by_daypart'),
    supabase.rpc('analytics_daily_sales'),
    supabase.rpc('analytics_tickettailor_lead_time'),
  ]);

  for (const [label, res] of [
    ['analytics_top_items', topItemsRes],
    ['analytics_sales_by_hour', hourRes],
    ['analytics_top_items_by_daypart', daypartRes],
    ['analytics_daily_sales', dailyRes],
    ['analytics_tickettailor_lead_time', leadTimeRes],
  ]) {
    if (res.error) throw new Error(`${label}: ${res.error.message}`);
  }

  const byKey = topItemsRes.data || [];

  // Roll the per-menu_item_id rows up to per-item_name, so "Elixir" reads as
  // one product instead of splitting across its two SpotOn menu item ids.
  const byNameMap = new Map();
  for (const row of byKey) {
    const name = row.item_name || '(unnamed item)';
    const existing = byNameMap.get(name);
    if (existing) {
      existing.total_quantity += Number(row.total_quantity) || 0;
      existing.total_net_cents += Number(row.total_net_cents) || 0;
      existing.order_count += Number(row.order_count) || 0;
      existing.product_keys.push(row.product_key);
    } else {
      byNameMap.set(name, {
        item_name: name,
        category: row.category,
        total_quantity: Number(row.total_quantity) || 0,
        total_net_cents: Number(row.total_net_cents) || 0,
        order_count: Number(row.order_count) || 0,
        product_keys: [row.product_key],
      });
    }
  }
  const topItemsByName = Array.from(byNameMap.values()).sort(
    (a, b) => b.total_net_cents - a.total_net_cents
  );

  // Flag names that fragment across more than one menu_item_id, so the UI can
  // surface the caveat instead of silently merging without explanation.
  const fragmentedNames = topItemsByName
    .filter((r) => r.product_keys.length > 1)
    .map((r) => r.item_name);

  return NextResponse.json({
    topItemsByKey: byKey.slice(0, 30),
    topItemsByName: topItemsByName.slice(0, 30),
    itemCatalog: topItemsByName.map((r) => ({
      item_name: r.item_name,
      category: r.category,
      total_quantity: r.total_quantity,
    })),
    fragmentedNames,
    salesByHour: hourRes.data || [],
    topItemsByDaypart: daypartRes.data || [],
    dailySales: dailyRes.data || [],
    ticketTailorLeadTime: leadTimeRes.data || [],
  });
}

async function handleTrend(supabase, itemName) {
  // Resolve every menu_item_id that has ever been sold under this display
  // name, then merge their weekly trends into one series.
  const { data: topItems, error: topErr } = await supabase.rpc('analytics_top_items', { limit_n: 500 });
  if (topErr) throw new Error(`analytics_top_items: ${topErr.message}`);

  const keys = Array.from(
    new Set((topItems || []).filter((r) => r.item_name === itemName).map((r) => r.product_key))
  );
  if (keys.length === 0) {
    return NextResponse.json({ itemName, weeks: [] });
  }

  const results = await Promise.all(
    keys.map((key) => supabase.rpc('analytics_item_trend', { product_key_in: key }))
  );
  for (const res of results) {
    if (res.error) throw new Error(`analytics_item_trend: ${res.error.message}`);
  }

  const byWeek = new Map();
  for (const res of results) {
    for (const row of res.data || []) {
      const wk = row.week_start;
      const existing = byWeek.get(wk);
      if (existing) {
        existing.total_quantity += Number(row.total_quantity) || 0;
        existing.total_net_cents += Number(row.total_net_cents) || 0;
      } else {
        byWeek.set(wk, {
          week_start: wk,
          total_quantity: Number(row.total_quantity) || 0,
          total_net_cents: Number(row.total_net_cents) || 0,
        });
      }
    }
  }
  const weeks = Array.from(byWeek.values()).sort((a, b) => (a.week_start < b.week_start ? -1 : 1));

  return NextResponse.json({ itemName, weeks });
}
