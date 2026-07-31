'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import { DOCUMENTS_THEMES as THEMES } from '@/lib/admin-theme';
import { useAuthenticatedTheme } from '@/app/components/AuthenticatedThemeProvider';

function formatDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function SopLibraryClient({ documents, error, isAdmin }) {
  const { theme } = useAuthenticatedTheme();
  const t = THEMES[theme];
  const [query, setQuery] = useState('');

  // The SOP set is small enough to filter in the browser, which keeps the
  // server query a plain category+status match with no user input in it.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) =>
      `${d.title} ${d.description || ''}`.toLowerCase().includes(q)
    );
  }, [documents, query]);

  return (
    <>
      <AuthenticatedPageHeader
        backHref={isAdmin ? '/bananas/documents' : '/team/calendar'}
        backLabel={isAdmin ? '← BACK TO DOCUMENTS' : '← BACK TO CALENDAR'}
        title="SOPs"
        description="Standard operating procedures for the whole team. Read-only — admins maintain them in the document hub."
        eyebrow="TEAM"
        titleClassName="text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1]"
      />

      {error && (
        <div
          className="mb-4 p-3 rounded-[10px] text-[13px]"
          style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, color: t.dangerText }}
        >
          {error}
        </div>
      )}

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search SOPs"
        aria-label="Search SOPs"
        className="w-full mb-5 px-3 py-2.5 text-[14px] rounded-[10px] outline-none"
        style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.inputText }}
      />

      {visible.length === 0 ? (
        <div className="rounded-[14px] border p-12 text-center" style={{ background: t.cardBg, borderColor: t.cardBorder }}>
          <p style={{ color: t.muted }}>
            {documents.length === 0 ? 'No SOPs have been published yet.' : 'No SOPs match that search.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((d) => (
            <Link
              key={d.id}
              href={`/team/documents/${d.id}`}
              className="block rounded-[12px] border p-4 transition-colors"
              style={{ background: t.cardBg, borderColor: t.cardBorder, color: t.text }}
            >
              <div className="text-[15px] font-semibold">{d.title}</div>
              {d.description && (
                <p className="text-[13px] mt-1 line-clamp-2" style={{ color: t.mutedStrong }}>
                  {d.description}
                </p>
              )}
              <div className="text-[11px] mt-2" style={{ color: t.muted }}>
                {d.document_versions?.filename || 'No file attached'} · updated {formatDate(d.updated_at)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
