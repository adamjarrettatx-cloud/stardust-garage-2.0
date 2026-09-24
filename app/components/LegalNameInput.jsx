'use client';

import { useId } from 'react';
import { LEGAL_NAME_NOTICE } from '@/lib/legal-name';

export default function LegalNameInput({ value, onChange, disabled = false, inputClassName = '', inputStyle = {}, bad = false, label = 'Legal first and last name', labelStyle = {}, placeholder = '' }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-[12px] font-semibold mb-2" style={labelStyle}>
        {label}
      </label>
      <input id={id} name="fullName" type="text" value={value} onChange={onChange}
        required maxLength={120} autoComplete="name" disabled={disabled} placeholder={placeholder}
        pattern=".*\S+\s+\S+.*" aria-describedby={`${id}-notice`} aria-invalid={bad || undefined}
        className={inputClassName || 'w-full px-4 py-3 rounded-xl border outline-none focus:border-white/50'}
        style={{ background: 'var(--auth-input-bg, #141414)', color: 'var(--auth-text, #f5f5f5)',
          borderColor: bad ? '#ff8a8a' : 'var(--auth-card-border, rgba(255,255,255,0.2))', fontSize: 16, ...inputStyle }} />
      <p id={`${id}-notice`} className="text-[12px] leading-relaxed mt-2" style={{ color: 'var(--auth-muted, #a0a0a0)' }}>
        {LEGAL_NAME_NOTICE}
      </p>
    </div>
  );
}
