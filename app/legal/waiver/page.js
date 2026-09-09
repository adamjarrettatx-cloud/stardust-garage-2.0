// Public, canonical URL for the current active ticket waiver.
// This page is what the ticket-purchase modal links to. It is a stable
// URL (/legal/waiver) that we can cite verbatim in a lawsuit or point
// buyers to for their records. The rendered body is generated from the
// exact same source string used to compute body_sha256 for every
// acceptance row — so the page a buyer saw is bit-for-bit the body
// hashed and stored in waiver_acceptances.
//
// Old versions remain accessible at /legal/waiver/v/<slug> for records
// requests / prior acceptances.

import Link from 'next/link';
import { activeWaiver } from '@/lib/waiver/versions';

export const dynamic = 'force-static';
export const revalidate = 3600; // 1 hour is plenty; content only moves on version bumps.

export const metadata = {
  title: 'Liability Waiver · Stardust Garage',
  description:
    'Assumption of Risk, Waiver, and Release of Liability, Photo/Video Release, and No-Refund Policy for Stardust Garage events.',
  robots: { index: true, follow: false },
};

// -------- tiny, safe markdown renderer ------------------------------------
// The waiver body uses a small, known subset: ### headings, **bold**,
// blank-line-separated paragraphs, and horizontal rules (---). We do not
// accept HTML or images. Everything else is escaped.

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(text) {
  // Escape first, then re-inject bold spans. Order matters.
  const escaped = escapeHtml(text);
  return escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// Slugify a heading for anchor links (used by inline links from the buy modal).
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function renderMarkdown(md) {
  const blocks = md.split(/\n{2,}/);
  const out = [];
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    if (block === '---') {
      out.push('<hr />');
      continue;
    }

    if (block.startsWith('### ')) {
      const text = block.slice(4).trim();
      out.push(`<h3 id="${slugify(text)}">${renderInline(text)}</h3>`);
      continue;
    }

    // Numbered section header (e.g., "**5. Conduct, Compliance, and Ejection.**\nbody...")
    // The first line is the header; the rest is the paragraph body.
    const lines = block.split('\n');
    const numberedHeader = lines[0].match(/^\*\*(\d+)\.\s+(.+?)\*\*$/);
    if (numberedHeader && lines.length > 1) {
      const [, num, title] = numberedHeader;
      const anchor = slugify(`${num}-${title}`);
      out.push(
        `<section id="${anchor}"><h4><span class="num">${num}.</span> ${renderInline(title)}</h4>` +
        `<p>${renderInline(lines.slice(1).join('\n')).replace(/\n/g, '<br />')}</p></section>`
      );
      continue;
    }

    // Default: paragraph, preserve single line breaks as <br>.
    out.push(`<p>${renderInline(block).replace(/\n/g, '<br />')}</p>`);
  }
  return out.join('\n');
}

// --------------------------------------------------------------------------

export default function WaiverPage() {
  const w = activeWaiver('ticket');
  const html = renderMarkdown(w.bodyMarkdown);

  return (
    <main className="waiver-page">
      <header className="waiver-header">
        <div className="crumb">
          <Link href="/">Stardust Garage</Link> <span>/</span>{' '}
          <span>Legal</span> <span>/</span> <span>Waiver</span>
        </div>
        <h1>Liability Waiver</h1>
        <p className="lede">
          The full text below is the current version of the Assumption of Risk,
          Waiver, and Release of Liability that applies to every Stardust Garage
          ticket, RSVP, and admission.
        </p>
        <dl className="meta">
          <div>
            <dt>Version</dt>
            <dd>
              {w.version} <span className="slug">({w.slug})</span>
            </dd>
          </div>
          <div>
            <dt>Effective</dt>
            <dd>{w.effectiveAt}</dd>
          </div>
          <div>
            <dt>Document hash (SHA-256)</dt>
            <dd className="hash">{w.bodySha256}</dd>
          </div>
        </dl>
        <p className="save">
          To save a copy for your records, print this page (Ctrl/Cmd+P) or use
          your browser&apos;s Save Page function.
        </p>
      </header>

      <article
        className="waiver-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <style>{`
        .waiver-page {
          max-width: 780px;
          margin: 0 auto;
          padding: 48px 24px 96px;
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
            'Helvetica Neue', Arial, sans-serif;
          font-size: 15px;
          line-height: 1.6;
        }
        .crumb {
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #8a8a8a;
          margin-bottom: 24px;
        }
        .crumb a { color: #b8b8b8; text-decoration: none; }
        .crumb span { margin: 0 6px; }
        .waiver-header h1 {
          font-size: 34px;
          font-weight: 700;
          letter-spacing: -0.02em;
          margin: 0 0 16px;
          color: #fff;
        }
        .lede { color: #b8b8b8; margin: 0 0 28px; }
        .meta {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px 24px;
          padding: 20px;
          background: #1a1a1a;
          border: 1px solid #2a2a2a;
          border-radius: 8px;
          margin: 0 0 24px;
        }
        .meta dt {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #8a8a8a;
          margin-bottom: 4px;
        }
        .meta dd {
          margin: 0;
          font-size: 14px;
          color: #ffffff;
        }
        .meta .slug { color: #8a8a8a; font-size: 12px; }
        .meta .hash {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          word-break: break-all;
          color: #b8b8b8;
        }
        .save {
          font-size: 12px;
          color: #8a8a8a;
          margin: 0 0 40px;
        }
        .waiver-body h3 {
          font-size: 20px;
          font-weight: 700;
          letter-spacing: -0.01em;
          margin: 40px 0 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid #2a2a2a;
          color: #fff;
        }
        .waiver-body section {
          margin: 24px 0;
          scroll-margin-top: 24px;
        }
        .waiver-body h4 {
          font-size: 15px;
          font-weight: 700;
          margin: 0 0 8px;
          color: #fff;
        }
        .waiver-body h4 .num { color: #b8b8b8; margin-right: 4px; }
        .waiver-body p {
          margin: 0 0 14px;
          color: #d0d0d0;
        }
        .waiver-body strong { color: #fff; font-weight: 700; }
        .waiver-body hr {
          border: 0;
          border-top: 1px solid #2a2a2a;
          margin: 32px 0;
        }
        @media print {
          .waiver-page { color: #000; padding: 24px; }
          .waiver-header h1, .waiver-body h3, .waiver-body h4,
          .waiver-body strong { color: #000; }
          .waiver-body p, .lede, .meta dd { color: #222; }
          .meta { background: #f4f4f4; border-color: #ccc; }
          .crumb, .save { display: none; }
        }
      `}</style>
    </main>
  );
}
