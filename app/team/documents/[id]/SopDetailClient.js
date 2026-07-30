'use client';

import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import { DOCUMENTS_THEMES as THEMES } from '@/lib/admin-theme';
import { useAuthenticatedTheme } from '@/app/components/AuthenticatedThemeProvider';

const PREVIEWABLE = /^(application\/pdf|image\/)/;

function formatBytes(n) {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
function formatDateTime(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function SopDetailClient({ document: doc }) {
  const { theme } = useAuthenticatedTheme();
  const t = THEMES[theme];
  const ghostButtonStyle = { border: `1px solid ${t.ghostBorder}`, color: t.ghostText };

  const version = doc.document_versions || null;
  const tags = (doc.document_tags || []).map((row) => row.tag);
  const downloadHref = `/api/team/documents/${doc.id}/download`;
  const canPreview = Boolean(version?.mime_type && PREVIEWABLE.test(version.mime_type));

  return (
    <>
      <AuthenticatedPageHeader
        backHref="/team/documents"
        backLabel="← BACK TO SOPS"
        title={doc.title}
        eyebrow="SOP"
        titleClassName="text-[28px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-6"
      >
        {version && (
          <a href={downloadHref} className="text-[12px] px-3 py-1.5 rounded-[8px]" style={ghostButtonStyle}>
            Download
          </a>
        )}
      </AuthenticatedPageHeader>

      <div className="rounded-[14px] border p-5 mb-6" style={{ background: t.cardBg, borderColor: t.cardBorder }}>
        <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-[13px]">
          {doc.description && (
            <>
              <dt style={{ color: t.muted }}>Notes</dt>
              <dd className="whitespace-pre-wrap">{doc.description}</dd>
            </>
          )}
          {tags.length > 0 && (
            <>
              <dt style={{ color: t.muted }}>Tags</dt>
              <dd className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span key={tag} className="text-[11px] px-1.5 py-0.5 rounded-[4px]" style={{ background: t.chipBg, color: t.mutedStrong }}>
                    #{tag}
                  </span>
                ))}
              </dd>
            </>
          )}
          <dt style={{ color: t.muted }}>File</dt>
          <dd>{version ? `${version.filename} · ${formatBytes(version.size_bytes)}` : 'No file attached'}</dd>
          <dt style={{ color: t.muted }}>Updated</dt>
          <dd>{formatDateTime(doc.updated_at)}</dd>
        </dl>
      </div>

      {version && (
        canPreview ? (
          <iframe
            src={`${downloadHref}?inline=1`}
            title={doc.title}
            className="w-full h-[75vh] rounded-[14px] border"
            style={{ background: t.cardBg, borderColor: t.cardBorder }}
          />
        ) : (
          <div className="rounded-[14px] border p-8 text-center text-[13px]" style={{ background: t.cardBg, borderColor: t.cardBorder, color: t.muted }}>
            This file type can&apos;t be previewed in the browser — download it to read it.
          </div>
        )
      )}
    </>
  );
}
