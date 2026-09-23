'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { safePreviewPath, VIEWPORT_PRESETS } from '@/lib/view-portal/viewport';

const MODE_KEY = 'sdg-view-viewport';
const PATH_MESSAGE = 'sdg-preview-path';

export default function ViewPortalControls({ label }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [embedded, setEmbedded] = useState(null);
  const [mode, setMode] = useState('desktop');
  const [width, setWidth] = useState(390);
  const [source, setSource] = useState('');
  const [stageWidth, setStageWidth] = useState(0);
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const frameRef = useRef(null);
  const currentPath = useRef('');
  const preset = VIEWPORT_PRESETS.find((item) => item.width === width);

  useEffect(() => {
    const inFrame = window.self !== window.top;
    setEmbedded(inFrame);
    if (inFrame) return;
    const path = window.location.pathname + window.location.search + window.location.hash;
    currentPath.current = path;
    setSource(path);
    try {
      if (sessionStorage.getItem(MODE_KEY) === 'mobile') setMode('mobile');
    } catch { /* Storage is optional; controls still work without it. */ }
  }, []);

  // The real site inside the phone frame announces client-side navigation.
  // Its session and all route/data authorization remain completely unchanged.
  useEffect(() => {
    if (!embedded) return;
    const announce = () => window.parent.postMessage({
      type: PATH_MESSAGE,
      path: window.location.pathname + window.location.search + window.location.hash,
    }, window.location.origin);
    announce();
    window.addEventListener('hashchange', announce);
    return () => window.removeEventListener('hashchange', announce);
  }, [embedded, pathname, search]);

  useEffect(() => {
    if (embedded !== false) return;
    const receive = (event) => {
      if (event.origin !== window.location.origin
        || event.source !== frameRef.current?.contentWindow
        || event.data?.type !== PATH_MESSAGE) return;
      const path = safePreviewPath(event.data.path, window.location.origin);
      if (path) currentPath.current = path;
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [embedded]);

  useEffect(() => {
    if (mode !== 'mobile' || embedded !== false) return;
    const stage = stageRef.current;
    const observer = new ResizeObserver(() => setStageWidth(stage.clientWidth));
    observer.observe(stage);
    setStageWidth(stage.clientWidth);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const siblings = Array.from(document.body.children)
      .filter((element) => !element.contains(rootRef.current) && element.tagName !== 'SCRIPT')
      .map((element) => ({ element, inert: element.inert }));
    siblings.forEach(({ element }) => { element.inert = true; });
    return () => {
      observer.disconnect();
      document.body.style.overflow = overflow;
      siblings.forEach(({ element, inert }) => { element.inert = inert; });
    };
  }, [mode, embedded]);

  const selectMode = useCallback((nextMode) => {
    if (nextMode === mode) return;
    try { sessionStorage.setItem(MODE_KEY, nextMode); } catch { /* Optional. */ }
    if (nextMode === 'desktop') {
      const path = safePreviewPath(currentPath.current, window.location.origin);
      const current = window.location.pathname + window.location.search + window.location.hash;
      if (path && path !== current) {
        window.location.assign(path);
        return;
      }
    } else {
      const path = window.location.pathname + window.location.search + window.location.hash;
      currentPath.current = path;
      setSource(path);
    }
    setMode(nextMode);
  }, [mode]);

  if (embedded !== false) return null;
  const mobile = mode === 'mobile';
  const scale = stageWidth ? Math.min(1, Math.max(0.1, (stageWidth - 40) / width)) : 1;
  return (
    <div ref={rootRef} className={mobile ? 'view-portal-shell' : 'view-portal-controls'}>
      <aside className="view-portal-banner" aria-label="Preview mode">
        <div>
          <span className="view-portal-banner__eyebrow">Isolated preview</span>
          <strong>Viewing as: {label}</strong>
        </div>
        <div className="view-portal-banner__tools">
          <div className="view-portal-viewport" role="group" aria-label="Preview viewport">
            <button type="button" aria-pressed={!mobile} onClick={() => selectMode('desktop')}>Desktop</button>
            <button type="button" aria-pressed={mobile} onClick={() => selectMode('mobile')}>Mobile</button>
          </div>
          {mobile && (
            <select aria-label="Phone viewport size" value={width} onChange={(event) => setWidth(Number(event.target.value))}>
              {VIEWPORT_PRESETS.map((item) => <option key={item.width} value={item.width}>{item.label}</option>)}
            </select>
          )}
          <div className="view-portal-banner__actions">
            <form action="/view-preview/exit" method="post"><button type="submit">Change view</button></form>
            <form action="/view-preview/exit" method="post"><button type="submit">Exit preview</button></form>
          </div>
        </div>
      </aside>
      {mobile && (
        <>
          <p className="view-portal-mobile-note">Responsive website preview · {preset.width} × {preset.height} · Not a native device simulator</p>
          <div ref={stageRef} className="view-portal-mobile-stage">
            <div style={{ width: width * scale, height: preset.height * scale, position: 'relative', flexShrink: 0 }}>
              <iframe
                ref={frameRef}
                title={`${label} mobile website preview`}
                src={source}
                className="view-portal-phone"
                style={{ width, height: preset.height, transform: `scale(${scale})` }}
                sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
                onLoad={() => {
                  try {
                    const location = frameRef.current.contentWindow.location;
                    const path = safePreviewPath(location.pathname + location.search + location.hash, window.location.origin);
                    if (location.origin === window.location.origin && path) currentPath.current = path;
                  } catch { /* Never follow a cross-origin frame destination. */ }
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
