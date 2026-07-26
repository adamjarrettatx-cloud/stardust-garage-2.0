'use client';

// Visual contract field editor. Renders each page of a PDF (via pdfjs-dist) to a
// canvas at a known scale, then overlays absolutely-positioned field boxes that
// staff can create (click-drag), move, resize, relabel, retype, reassign, and
// delete. The stored layout is always in the PDF-native BOTTOM-LEFT / points
// coordinate space (see lib/contract-fields.js COORDINATE SYSTEM note); this
// component only converts to/from screen pixels for display, using the shared
// screenBoxToLayout / layoutBoxToScreen helpers so there is exactly one source
// of truth for the transform.
//
// Reused by BOTH the template editor and the per-contract field editor — the
// only difference is the PDF URL and the onSave target.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FIELD_TYPES,
  ASSIGNABLE_ROLES,
  roleColor,
  roleLabel,
  newFieldId,
  screenBoxToLayout,
  layoutBoxToScreen,
} from '@/lib/contract-fields';
import { DOCUMENTS_THEMES as THEMES } from '@/lib/admin-theme';
import { useAuthenticatedTheme } from '@/app/components/AuthenticatedThemeProvider';

const TARGET_WIDTH = 680; // css px target for the widest page; scale derived from it
const MIN_BOX = 8; // ignore accidental micro-drags (screen px)

export default function FieldEditor({ fileUrl, initialLayout = [], onSave, saving = false, saveLabel = 'Save fields' }) {
  const { theme } = useAuthenticatedTheme();
  const t = THEMES[theme];
  const inputStyle = { background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.inputText };
  const [pages, setPages] = useState([]); // [{ width, height }] in PDF points
  const [scale, setScale] = useState(1);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState(() => (Array.isArray(initialLayout) ? initialLayout : []));
  const [selectedId, setSelectedId] = useState(null);
  const [dirty, setDirty] = useState(false);

  // New-field tool defaults applied to the next box drawn.
  const [tool, setTool] = useState({ type: 'text', assigned_to: 'business', required: true });

  // Transient drag state (screen-space); null when idle.
  const dragRef = useRef(null);
  const [draft, setDraft] = useState(null); // { page, px, py, pw, ph } while creating

  const canvasRefs = useRef({}); // page_number -> canvas element
  const pdfPagesRef = useRef([]); // pdfjs page proxies, indexed by page number

  // ---- Load the PDF + measure pages -----------------------------------------
  // Rendering to canvas happens in a SEPARATE effect below, because the canvas
  // elements only mount after `pages` state is set — drawing here would target
  // refs that don't exist yet on the first pass.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    pdfPagesRef.current = [];
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();

        const res = await fetch(fileUrl, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`Could not load PDF (${res.status})`);
        const data = await res.arrayBuffer();
        const doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;

        const dims = [];
        const proxies = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const vp1 = page.getViewport({ scale: 1 });
          dims.push({ width: vp1.width, height: vp1.height });
          proxies.push(page);
        }
        if (cancelled) return;

        const widest = Math.max(...dims.map((d) => d.width), 1);
        pdfPagesRef.current = proxies;
        setScale(Math.min(2, Math.max(0.5, TARGET_WIDTH / widest)));
        setPages(dims);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err?.message || 'Failed to render PDF');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [fileUrl]);

  // ---- Render each measured page to its (now-mounted) canvas ----------------
  useEffect(() => {
    if (pages.length === 0 || pdfPagesRef.current.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        for (let i = 0; i < pdfPagesRef.current.length; i++) {
          const canvas = canvasRefs.current[i];
          const page = pdfPagesRef.current[i];
          if (!canvas || !page) continue;
          const viewport = page.getViewport({ scale });
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
        }
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err?.message || 'Failed to render PDF');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [pages, scale]);

  const selected = useMemo(() => fields.find((f) => f.id === selectedId) || null, [fields, selectedId]);

  const markDirty = useCallback(() => setDirty(true), []);

  function updateField(id, patch) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    markDirty();
  }
  function removeField(id) {
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (selectedId === id) setSelectedId(null);
    markDirty();
  }

  // Pointer position relative to a page's overlay, in screen px.
  function relativePoint(e, overlay) {
    const rect = overlay.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onOverlayPointerDown(e, pageIndex) {
    // Only start a NEW field when the target is the overlay itself (not a field
    // box or handle, which stop propagation / set their own drag).
    if (e.target.dataset?.role !== 'overlay') return;
    const overlay = e.currentTarget;
    overlay.setPointerCapture?.(e.pointerId);
    const p = relativePoint(e, overlay);
    dragRef.current = { kind: 'create', pageIndex, startX: p.x, startY: p.y, overlay };
    setSelectedId(null);
    setDraft({ page: pageIndex, px: p.x, py: p.y, pw: 0, ph: 0 });
  }

  function onOverlayPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const p = relativePoint(e, d.overlay);
    if (d.kind === 'create') {
      const px = Math.min(d.startX, p.x);
      const py = Math.min(d.startY, p.y);
      const pw = Math.abs(p.x - d.startX);
      const ph = Math.abs(p.y - d.startY);
      setDraft({ page: d.pageIndex, px, py, pw, ph });
    } else if (d.kind === 'move') {
      const nx = clamp(d.originPx + (p.x - d.startX), 0, d.overlay.clientWidth - d.field.pw);
      const ny = clamp(d.originPy + (p.y - d.startY), 0, d.overlay.clientHeight - d.field.ph);
      commitScreenBox(d.field.id, d.pageIndex, { px: nx, py: ny, pw: d.field.pw, ph: d.field.ph }, false);
    } else if (d.kind === 'resize') {
      const pw = Math.max(MIN_BOX, p.x - d.originPx);
      const ph = Math.max(MIN_BOX, p.y - d.originPy);
      commitScreenBox(d.field.id, d.pageIndex, { px: d.originPx, py: d.originPy, pw, ph }, false);
    }
  }

  function onOverlayPointerUp(e) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    d.overlay.releasePointerCapture?.(e.pointerId);
    if (d.kind === 'create') {
      const box = draft;
      setDraft(null);
      if (!box || box.pw < MIN_BOX || box.ph < MIN_BOX) return;
      const layout = screenBoxToLayout({
        px: box.px, py: box.py, pw: box.pw, ph: box.ph,
        pageHeightPts: pages[d.pageIndex]?.height || 792,
        renderScale: scale,
      });
      const field = {
        id: newFieldId(),
        type: tool.type,
        label: '',
        page_number: d.pageIndex,
        x: round2(layout.x),
        y: round2(layout.y),
        width: round2(layout.width),
        height: round2(layout.height),
        required: tool.required,
        assigned_to: tool.assigned_to,
      };
      field.label = roleLabel(field.assigned_to);
      setFields((prev) => [...prev, field]);
      setSelectedId(field.id);
      markDirty();
    }
    // move/resize commit already happened live in pointer-move.
  }

  // Convert a screen-space box for a field back to stored layout coords and
  // commit it. `finalizeDirty` marks the layout dirty (used on discrete edits).
  function commitScreenBox(id, pageIndex, box, finalizeDirty = true) {
    const layout = screenBoxToLayout({
      px: box.px, py: box.py, pw: box.pw, ph: box.ph,
      pageHeightPts: pages[pageIndex]?.height || 792,
      renderScale: scale,
    });
    setFields((prev) => prev.map((f) => (f.id === id
      ? { ...f, x: round2(layout.x), y: round2(layout.y), width: round2(layout.width), height: round2(layout.height) }
      : f)));
    if (finalizeDirty) markDirty();
    else setDirty(true);
  }

  function onFieldPointerDown(e, field, pageIndex) {
    e.stopPropagation();
    const overlay = e.currentTarget.parentElement;
    overlay.setPointerCapture?.(e.pointerId);
    setSelectedId(field.id);
    const screen = layoutBoxToScreen({ ...field, pageHeightPts: pages[pageIndex]?.height || 792, renderScale: scale });
    const p = relativePoint(e, overlay);
    dragRef.current = {
      kind: 'move', pageIndex, field: { id: field.id, pw: screen.pw, ph: screen.ph },
      startX: p.x, startY: p.y, originPx: screen.px, originPy: screen.py, overlay,
    };
  }

  function onResizePointerDown(e, field, pageIndex) {
    e.stopPropagation();
    const overlay = e.currentTarget.parentElement.parentElement;
    overlay.setPointerCapture?.(e.pointerId);
    setSelectedId(field.id);
    const screen = layoutBoxToScreen({ ...field, pageHeightPts: pages[pageIndex]?.height || 792, renderScale: scale });
    dragRef.current = {
      kind: 'resize', pageIndex, field: { id: field.id },
      originPx: screen.px, originPy: screen.py, overlay,
    };
  }

  async function handleSave() {
    if (!onSave) return;
    await onSave(fields);
    setDirty(false);
  }

  return (
    <div>
      {/* Toolbar: defaults for the next field drawn */}
      <div className="rounded-[12px] border p-4 mb-4 flex flex-wrap items-end gap-3"
        style={{ background: t.cardBg, borderColor: t.cardBorder }}>
        <label className="text-[12px]" style={{ color: t.muted }}>
          New field type
          <select value={tool.type} onChange={(e) => setTool({ ...tool, type: e.target.value })}
            className="mt-1 block px-3 py-2 text-[13px] rounded-[8px] outline-none cursor-pointer" style={inputStyle}>
            {FIELD_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
          </select>
        </label>
        <label className="text-[12px]" style={{ color: t.muted }}>
          Assigned to
          <select value={tool.assigned_to} onChange={(e) => setTool({ ...tool, assigned_to: e.target.value })}
            className="mt-1 block px-3 py-2 text-[13px] rounded-[8px] outline-none cursor-pointer" style={inputStyle}>
            {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </label>
        <label className="text-[12px] flex items-center gap-2 pb-2" style={{ color: t.muted }}>
          <input type="checkbox" checked={tool.required} onChange={(e) => setTool({ ...tool, required: e.target.checked })} />
          Required
        </label>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {dirty && <span className="text-[11px]" style={{ color: t.warn }}>Unsaved changes</span>}
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-[13px] font-semibold rounded-[10px] tracking-[0.06em] uppercase"
            style={{ background: t.solidBg, color: t.solidText, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : saveLabel}
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-3 text-[11px]" style={{ color: t.muted }}>
        {ASSIGNABLE_ROLES.map((r) => (
          <span key={r} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-[3px]" style={{ background: roleColor(r) }} />
            {roleLabel(r)}
          </span>
        ))}
        <span className="ml-auto">Drag on a page to place a field. Click a field to edit it.</span>
      </div>

      {loadError && (
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, color: t.dangerText }}>
          {loadError}
        </div>
      )}
      {loading && !loadError && (
        <p className="text-[13px] mb-4" style={{ color: t.muted }}>Rendering PDF…</p>
      )}

      {/* Selected-field inspector */}
      {selected && (
        <div className="rounded-[12px] border p-4 mb-4 grid grid-cols-[1fr_auto_auto_auto] gap-3 items-end"
          style={{ background: t.cardBg, borderColor: `${roleColor(selected.assigned_to)}55` }}>
          <label className="text-[12px]" style={{ color: t.muted }}>
            Label
            <input value={selected.label} onChange={(e) => updateField(selected.id, { label: e.target.value })}
              className="mt-1 w-full px-3 py-2 text-[13px] rounded-[8px] outline-none" style={inputStyle} />
          </label>
          <label className="text-[12px]" style={{ color: t.muted }}>
            Type
            <select value={selected.type} onChange={(e) => updateField(selected.id, { type: e.target.value })}
              className="mt-1 block px-3 py-2 text-[13px] rounded-[8px] outline-none cursor-pointer" style={inputStyle}>
              {FIELD_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
            </select>
          </label>
          <label className="text-[12px]" style={{ color: t.muted }}>
            Assigned to
            <select value={selected.assigned_to} onChange={(e) => updateField(selected.id, { assigned_to: e.target.value })}
              className="mt-1 block px-3 py-2 text-[13px] rounded-[8px] outline-none cursor-pointer" style={inputStyle}>
              {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2 pb-1">
            <label className="text-[12px] flex items-center gap-1.5" style={{ color: t.muted }}>
              <input type="checkbox" checked={selected.required !== false}
                onChange={(e) => updateField(selected.id, { required: e.target.checked })} />
              Req
            </label>
            <button onClick={() => removeField(selected.id)}
              className="text-[12px] px-3 py-2 rounded-[8px]"
              style={{ border: `1px solid ${t.dangerBorder}`, color: t.dangerText }}>Delete</button>
          </div>
        </div>
      )}

      {/* Pages */}
      <div className="space-y-6">
        {pages.map((pg, i) => {
          const w = Math.round(pg.width * scale);
          const h = Math.round(pg.height * scale);
          const pageFields = fields.filter((f) => f.page_number === i);
          return (
            <div key={i}>
              <div className="text-[11px] mb-1" style={{ color: t.faint }}>Page {i + 1}</div>
              <div className="relative mx-auto" style={{ width: w, height: h }}>
                <canvas
                  ref={(el) => { if (el) canvasRefs.current[i] = el; }}
                  className="block rounded-[4px]"
                  style={{ width: w, height: h, background: 'white' }}
                />
                <div
                  data-role="overlay"
                  className="absolute inset-0"
                  style={{ cursor: 'crosshair', touchAction: 'none' }}
                  onPointerDown={(e) => onOverlayPointerDown(e, i)}
                  onPointerMove={onOverlayPointerMove}
                  onPointerUp={onOverlayPointerUp}
                >
                  {pageFields.map((f) => {
                    const b = layoutBoxToScreen({ ...f, pageHeightPts: pg.height, renderScale: scale });
                    const color = roleColor(f.assigned_to);
                    const isSel = f.id === selectedId;
                    return (
                      <div
                        key={f.id}
                        onPointerDown={(e) => onFieldPointerDown(e, f, i)}
                        className="absolute rounded-[3px] overflow-hidden"
                        style={{
                          left: b.px, top: b.py, width: b.pw, height: b.ph,
                          background: `${color}33`,
                          border: `1.5px solid ${color}`,
                          outline: isSel ? `2px solid ${t.textStrong}` : 'none',
                          cursor: 'move',
                        }}
                        title={`${roleLabel(f.assigned_to)} · ${f.type}${f.required !== false ? ' · required' : ''}`}
                      >
                        <span className="absolute top-0 left-0 text-[9px] px-1 leading-[1.4] font-semibold truncate max-w-full"
                          style={{ background: color, color: t.fieldTagText }}>
                          {f.label || roleLabel(f.assigned_to)}
                        </span>
                        {isSel && (
                          <span
                            onPointerDown={(e) => onResizePointerDown(e, f, i)}
                            className="absolute bottom-0 right-0 w-3 h-3"
                            style={{ background: color, cursor: 'nwse-resize' }}
                          />
                        )}
                      </div>
                    );
                  })}
                  {draft && draft.page === i && draft.pw > 0 && (
                    <div className="absolute rounded-[3px]"
                      style={{
                        left: draft.px, top: draft.py, width: draft.pw, height: draft.ph,
                        background: `${roleColor(tool.assigned_to)}33`,
                        border: `1.5px dashed ${roleColor(tool.assigned_to)}`,
                      }} />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
