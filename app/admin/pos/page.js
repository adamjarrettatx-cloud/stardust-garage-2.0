import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import PosAdminClient from './PosAdminClient';

export const revalidate = 0;

// Admin POS surface. Server-loads all four datasets and hands them to the
// client, which renders tabbed Products / Terminals / Orders / Cash Sessions.
export default async function AdminPosPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const admin = createAdminClient();

  const [products, terminals, orders, sessions] = await Promise.all([
    admin.from('pos_products').select('*').order('sort_order').order('name'),
    admin.from('pos_terminals').select('*').order('terminal_type').order('label'),
    admin.from('pos_orders')
      .select('*, pos_order_items(*), pos_payments(*)')
      .order('created_at', { ascending: false })
      .limit(50),
    admin.from('pos_cash_sessions')
      .select('*, pos_terminals(label, terminal_type)')
      .order('opened_at', { ascending: false })
      .limit(50),
  ]);

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-16">
      <div className="flex items-center justify-between mb-10">
        <div>
          <Link href="/admin" className="text-[12px]" style={{ color: '#8a8a8a' }}>← Admin</Link>
          <h1 className="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1] mt-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Point of Sale</h1>
          <p className="text-[14px] mt-2" style={{ color: '#8a8a8a' }}>
            Phase 1 — no live card processing. Cash &amp; manual-external tenders only.
          </p>
        </div>
        <Link
          href="/team/pos"
          className="rounded-[10px] px-5 py-2.5 text-[14px] font-bold"
          style={{ background: '#ffb84d', color: '#0a0a0a' }}
        >
          Open Register →
        </Link>
      </div>

      <PosAdminClient
        initialProducts={products.data || []}
        initialTerminals={terminals.data || []}
        initialOrders={orders.data || []}
        initialSessions={sessions.data || []}
      />
    </main>
  );
}
