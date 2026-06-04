'use client';

import { useState } from 'react';
import Link from 'next/link';
import { STRIPE_PRICES, PLAN_DISPLAY } from '@/lib/stripe-prices';

export default function ActivateClient({ initialPlan }) {
  const [plan, setPlan] = useState(initialPlan || 'cowork');
  const [period, setPeriod] = useState('monthly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const periods = STRIPE_PRICES[plan];

  async function handleCheckout() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, period }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || 'Failed to start checkout.');
        setLoading(false);
        return;
      }
      // Redirect to Stripe Checkout
      window.location.href = body.url;
    } catch (err) {
      setError(err?.message || 'Failed to start checkout.');
      setLoading(false);
    }
  }

  return (
    <main className="max-w-[700px] mx-auto px-6 py-16">
      <Link href="/member" className="text-[12px] tracking-[0.14em] mb-4 inline-block hover:text-white transition-colors" style={{ color: '#8a8a8a' }}>
        ← BACK TO MEMBER HOME
      </Link>
      <div className="text-[11px] font-semibold tracking-[0.28em] mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>
        ACTIVATE MEMBERSHIP
      </div>
      <h1 className="text-[32px] font-extrabold -tracking-[0.02em] leading-[1.15] mb-3" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        Choose your billing.
      </h1>
      <p className="text-[14px] mb-10" style={{ color: '#8a8a8a' }}>
        Pick a billing period for your <span style={{ color: '#f5f5f5' }}>{PLAN_DISPLAY[plan]}</span> membership. You can cancel anytime by emailing us.
      </p>

      {/* Plan switcher (only if they need to choose) */}
      {!initialPlan && (
        <div className="mb-8">
          <div className="text-[11px] font-semibold tracking-[0.18em] mb-3" style={{ color: '#8a8a8a' }}>
            PLAN
          </div>
          <div className="flex gap-2">
            {Object.entries(PLAN_DISPLAY).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPlan(key)}
                className="px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] border transition-all"
                style={{
                  background: plan === key ? '#ffffff' : 'transparent',
                  color: plan === key ? '#0a0a0a' : '#f5f5f5',
                  borderColor: plan === key ? '#ffffff' : 'rgba(255,255,255,0.15)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3 mb-8">
        {Object.entries(periods).map(([periodKey, info]) => {
          const isSelected = period === periodKey;
          return (
            <button
              key={periodKey}
              type="button"
              onClick={() => setPeriod(periodKey)}
              className="w-full text-left rounded-[14px] border p-5 transition-all"
              style={{
                background: isSelected ? '#1f1c14' : '#141414',
                borderColor: isSelected ? 'rgba(255,200,80,0.4)' : 'rgba(255,255,255,0.08)',
              }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                  style={{
                    borderColor: isSelected ? '#ffb84d' : 'rgba(255,255,255,0.3)',
                  }}
                >
                  {isSelected && (
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#ffb84d' }} />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-baseline justify-between">
                    <div className="text-[15px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                      {info.label}
                    </div>
                    <div className="text-[18px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                      {info.displayPrice}
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between mt-1">
                    <div className="text-[12px]" style={{ color: '#8a8a8a' }}>
                      {info.savingsLabel || '\u00A0'}
                    </div>
                    <div className="text-[12px]" style={{ color: '#8a8a8a' }}>
                      {info.periodLabel}
                    </div>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {error && <div className="text-[13px] text-red-400 mb-4">{error}</div>}

      <button
        type="button"
        onClick={handleCheckout}
        disabled={loading}
        className="w-full py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
        style={{ background: '#ffffff', color: '#0a0a0a' }}
      >
        {loading ? 'STARTING CHECKOUT…' : 'CONTINUE TO PAYMENT'}
      </button>

      <p className="text-[11px] text-center mt-4" style={{ color: 'rgba(255,255,255,0.4)' }}>
        Payments processed securely by Stripe. You can cancel by emailing hello@sdgatx.com.
      </p>
    </main>
  );
}
