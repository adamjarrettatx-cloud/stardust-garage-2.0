// Small pill "quick action" buttons for contact fields on admin detail pages
// (venue inquiries, micro-parties, collaborations, applications). Server
// components — these are plain anchors, no client interactivity needed.
// `mailto:`/`wa.me` links work the same whether rendered server- or
// client-side, so no 'use client' directive is required here.

// Turns whatever format a phone number was typed in into the digits-only,
// country-code-prefixed format WhatsApp's click-to-chat links expect
// (https://wa.me/<countrycode><number>, no +, spaces, or punctuation).
// Assumes a US/Canada number (Stardust Garage is Austin, TX-based) when a
// bare 10-digit number is given, since that's how phone fields are entered
// throughout this app.
export function toWhatsAppNumber(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return digits;
  if (digits.length >= 8 && digits.length <= 15) return digits; // already has some country code
  return null; // too short/long to plausibly be a real number
}

export function EmailButton({ email, style }) {
  if (!email) return null;
  return (
    <a
      href={`mailto:${email}`}
      className="inline-flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-[0.08em] hover:opacity-80 transition-opacity"
      style={{
        background: 'var(--auth-card-bg-alt)',
        border: '1px solid var(--auth-card-border-strong)',
        color: 'var(--auth-text)',
        textDecoration: 'none',
        ...style,
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M3 5.5C3 4.67157 3.67157 4 4.5 4H19.5C20.3284 4 21 4.67157 21 5.5V18.5C21 19.3284 20.3284 20 19.5 20H4.5C3.67157 20 3 19.3284 3 18.5V5.5Z" stroke="currentColor" strokeWidth="1.6" />
        <path d="M4 6L12 13L20 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      EMAIL
    </a>
  );
}

export function WhatsAppButton({ phone, style }) {
  const waNumber = toWhatsAppNumber(phone);
  if (!waNumber) return null;
  return (
    <a
      href={`https://wa.me/${waNumber}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-[0.08em] hover:opacity-85 transition-opacity"
      style={{
        background: '#25D366',
        border: '1px solid #1DA851',
        color: '#052e16',
        textDecoration: 'none',
        ...style,
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M12.01 2C6.48 2 2 6.48 2 12.01c0 1.99.58 3.85 1.58 5.42L2 22l4.71-1.55a9.95 9.95 0 0 0 5.3 1.53h.01c5.52 0 10-4.48 10-9.99C22.02 6.48 17.54 2 12.01 2Zm5.83 14.19c-.25.7-1.24 1.29-2.02 1.45-.55.11-1.26.2-3.65-.78-2.98-1.23-4.9-4.22-5.05-4.42-.15-.2-1.21-1.6-1.21-3.06 0-1.45.76-2.17 1.03-2.47.27-.29.6-.36.8-.36.2 0 .4.002.57.01.19.008.43-.07.67.51.25.6.85 2.08.92 2.23.07.15.12.33.02.53-.1.2-.15.33-.3.5-.15.18-.31.4-.44.53-.15.15-.3.31-.13.6.17.3.76 1.25 1.63 2.02 1.12 1 2.06 1.31 2.36 1.46.3.15.47.13.65-.08.18-.2.75-.87.95-1.17.2-.3.4-.25.67-.15.28.1 1.75.83 2.05.98.3.15.5.23.57.35.08.13.08.73-.17 1.43Z" />
      </svg>
      WHATSAPP
    </a>
  );
}
