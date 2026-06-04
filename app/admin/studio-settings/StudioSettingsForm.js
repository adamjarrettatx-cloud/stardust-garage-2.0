'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const DAYS = [
  { num: 0, label: 'Sun' },
  { num: 1, label: 'Mon' },
  { num: 2, label: 'Tue' },
  { num: 3, label: 'Wed' },
  { num: 4, label: 'Thu' },
  { num: 5, label: 'Fri' },
  { num: 6, label: 'Sat' },
];

function HourSelector({ value, onChange, label }) {
  const hours = [];
  for (let h = 0; h <= 24; h++) hours.push(h);

  function format(h) {
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    if (h === 24) return '12 AM (next day)';
    if (h < 12) return `${h} AM`;
    return `${h - 12} PM`;
  }

  return (
    <div>
      <label
        className="block text-[11px] font-semibold tracking-[0.14em] mb-2"
        style={{ color: '#8a8a8a' }}
      >
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30"
        style={{
          background: '#141414',
          borderColor: 'rgba(255,255,255,0.1)',
          color: '#f5f5f5',
        }}
      >
        {hours.map((h) => (
          <option key={h} value={h}>
            {format(h)}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function StudioSettingsForm({ settings }) {
  const router = useRouter();
  const [rate, setRate] = useState(
    settings?.hourly_rate_cents ? settings.hourly_rate_cents / 100 : 75
  );
  const [openHour, setOpenHour] = useState(settings?.open_hour ?? 9);
  const [closeHour, setCloseHour] = useState(settings?.close_hour ?? 21);
  const [openDays, setOpenDays] = useState(
    settings?.open_days ?? [1, 2, 3, 4, 5]
  );
  const [minAdvance, setMinAdvance] = useState(
    settings?.min_advance_hours ?? 24
  );
  const [minBooking, setMinBooking] = useState(
    settings?.min_booking_hours ?? 2
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState('');

  function toggleDay(dayNum) {
    setOpenDays((prev) =>
      prev.includes(dayNum)
        ? prev.filter((d) => d !== dayNum)
        : [...prev, dayNum].sort()
    );
  }

  async function handleSave() {
    setError('');
    setSaving(true);

    const rateCents = Math.round(rate * 100);

    if (openHour >= closeHour) {
      setError('Close hour must be after open hour.');
      setSaving(false);
      return;
    }
    if (openDays.length === 0) {
      setError('Pick at least one open day.');
      setSaving(false);
      return;
    }

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from('studio_settings')
      .update({
        hourly_rate_cents: rateCents,
        open_hour: openHour,
        close_hour: closeHour,
        open_days: openDays,
        min_advance_hours: minAdvance,
        min_booking_hours: minBooking,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);

    if (updateError) {
      setError('Save failed: ' + updateError.message);
      setSaving(false);
      return;
    }

    setSavedAt(new Date());
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <label
          className="block text-[11px] font-semibold tracking-[0.14em] mb-2"
          style={{ color: '#8a8a8a' }}
        >
          HOURLY RATE (USD)
        </label>
        <div className="relative">
          <span
            className="absolute left-5 top-1/2 -translate-y-1/2 text-[14px]"
            style={{ color: '#a0a0a0' }}
          >
            $
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
            className="w-full pl-10 pr-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30"
            style={{
              background: '#141414',
              borderColor: 'rgba(255,255,255,0.1)',
              color: '#f5f5f5',
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <HourSelector value={openHour} onChange={setOpenHour} label="OPEN AT" />
        <HourSelector value={closeHour} onChange={setCloseHour} label="CLOSE AT" />
      </div>

      <div>
        <label
          className="block text-[11px] font-semibold tracking-[0.14em] mb-3"
          style={{ color: '#8a8a8a' }}
        >
          OPEN DAYS
        </label>
        <div className="flex gap-2 flex-wrap">
          {DAYS.map((d) => {
            const isOn = openDays.includes(d.num);
            return (
              <button
                key={d.num}
                type="button"
                onClick={() => toggleDay(d.num)}
                className="px-4 py-2 rounded-full text-[12px] font-semibold tracking-[0.1em] border transition-all"
                style={{
                  background: isOn ? '#ffffff' : 'transparent',
                  color: isOn ? '#0a0a0a' : '#f5f5f5',
                  borderColor: isOn ? '#ffffff' : 'rgba(255,255,255,0.15)',
                }}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            className="block text-[11px] font-semibold tracking-[0.14em] mb-2"
            style={{ color: '#8a8a8a' }}
          >
            MIN ADVANCE (HOURS)
          </label>
          <input
            type="number"
            min="0"
            value={minAdvance}
            onChange={(e) => setMinAdvance(parseInt(e.target.value, 10) || 0)}
            className="w-full px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30"
            style={{
              background: '#141414',
              borderColor: 'rgba(255,255,255,0.1)',
              color: '#f5f5f5',
            }}
          />
        </div>
        <div>
          <label
            className="block text-[11px] font-semibold tracking-[0.14em] mb-2"
            style={{ color: '#8a8a8a' }}
          >
            MIN BOOKING (HOURS)
          </label>
          <input
            type="number"
            min="1"
            value={minBooking}
            onChange={(e) => setMinBooking(parseInt(e.target.value, 10) || 1)}
            className="w-full px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30"
            style={{
              background: '#141414',
              borderColor: 'rgba(255,255,255,0.1)',
              color: '#f5f5f5',
            }}
          />
        </div>
      </div>

      {error && (
        <div className="text-[13px] text-red-400">{error}</div>
      )}

      {savedAt && !error && (
        <div className="text-[13px]" style={{ color: '#80c878' }}>
          Saved.
        </div>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-full py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
        style={{ background: '#ffffff', color: '#0a0a0a' }}
      >
        {saving ? 'SAVING…' : 'SAVE SETTINGS'}
      </button>
    </div>
  );
}
