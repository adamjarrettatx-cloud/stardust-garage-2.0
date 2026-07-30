'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// The pad a first-time guest signs on when the attendant turns the iPad around.
//
// Built for that moment specifically:
//   * Pointer events, not touch events, so a finger, an Apple Pencil and a
//     desk mouse all take the same path, and pointer capture keeps a stroke
//     alive when a fingertip slides past the edge of the pad.
//   * `touch-action: none` on the canvas — without it iOS treats the first
//     drag as a scroll of the sheet behind and the guest's first stroke is
//     swallowed.
//   * Dark ink on white paper rather than the sheet's dark theme. The exported
//     PNG is a compliance record that staff open in a browser tab later, and a
//     white-on-transparent signature is invisible on a white page.
//   * Strokes are kept as normalized points and the whole thing is redrawn on
//     resize, so rotating the iPad mid-intake does not wipe a signature.
//
// Emits the PNG data URL to the parent on stroke end, and '' whenever there is
// nothing worth calling a signature — the parent gates its submit button on it.

const PAD_HEIGHT = 190;
const PAPER = '#ffffff';
const INK = '#111111';
const BASELINE = 'rgba(17,17,17,0.22)';
const LINE_WIDTH = 2.6;

// A single tap is a dot, not a signature. Requiring one stroke with real
// movement in it is what stops an untouched — or barely brushed — pad from
// being submitted as consent.
function hasRealSignature(strokes) {
  return strokes.some((stroke) => stroke.length >= 2);
}

export default function SignaturePad({ onChange, disabled = false }) {
  const canvasRef = useRef(null);
  const strokesRef = useRef([]);
  const activePointerRef = useRef(null);
  const dprRef = useRef(1);
  const [signed, setSigned] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const dpr = dprRef.current;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, width, height);

    // "Sign here" baseline, drawn under the ink so it reads as a line to sign
    // on rather than part of the signature.
    ctx.strokeStyle = BASELINE;
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(24 * dpr, height - 42 * dpr);
    ctx.lineTo(width - 24 * dpr, height - 42 * dpr);
    ctx.stroke();

    ctx.strokeStyle = INK;
    ctx.lineWidth = LINE_WIDTH * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokesRef.current) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x * width, stroke[0].y * height);
      for (let i = 1; i < stroke.length; i += 1) {
        ctx.lineTo(stroke[i].x * width, stroke[i].y * height);
      }
      // A one-point stroke has nothing to stroke; nudge it so the dot renders.
      if (stroke.length === 1) ctx.lineTo(stroke[0].x * width + 0.01, stroke[0].y * height);
      ctx.stroke();
    }
  }, []);

  // The backing store is sized in device pixels so finger strokes are not a
  // blurry mess on a retina iPad. Only the canvas attributes change here, never
  // its CSS box, so observing itself cannot loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return undefined;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      dprRef.current = dpr;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      redraw();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [redraw]);

  function pointAt(event) {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }

  function commit() {
    const canvas = canvasRef.current;
    const real = hasRealSignature(strokesRef.current);
    setSigned(real);
    onChange(real && canvas ? canvas.toDataURL('image/png') : '');
  }

  function handlePointerDown(event) {
    if (disabled) return;
    event.preventDefault();
    activePointerRef.current = event.pointerId;
    canvasRef.current?.setPointerCapture?.(event.pointerId);
    strokesRef.current.push([pointAt(event)]);
    redraw();
  }

  function handlePointerMove(event) {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    strokesRef.current[strokesRef.current.length - 1].push(pointAt(event));
    redraw();
  }

  function handlePointerUp(event) {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    canvasRef.current?.releasePointerCapture?.(event.pointerId);
    commit();
  }

  function handleClear() {
    strokesRef.current = [];
    activePointerRef.current = null;
    redraw();
    setSigned(false);
    onChange('');
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-[12px]" style={{ color: '#8a8a8a' }}>
          Guest signature
        </span>
        <button
          type="button"
          onClick={handleClear}
          disabled={disabled || !signed}
          className="text-[12px] font-bold px-3 py-1 rounded-lg"
          style={{
            background: '#1e1e1e',
            color: signed && !disabled ? '#cfcfcf' : '#5a5a5a',
          }}
        >
          Clear
        </button>
      </div>

      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        aria-label="Sign here to confirm consent to be contacted"
        className="signature-canvas"
        style={{ height: PAD_HEIGHT, opacity: disabled ? 0.6 : 1 }}
      />

      <div className="text-[12px] mt-1.5" style={{ color: signed ? '#7cfc9b' : '#8a8a8a' }}>
        {signed ? 'Signature captured.' : 'Hand the iPad to the guest to sign above.'}
      </div>

      <style jsx>{`
        .signature-canvas {
          display: block;
          width: 100%;
          border-radius: 14px;
          background: #ffffff;
          border: 1px solid rgba(255, 255, 255, 0.12);
          /* Without this the first drag scrolls the sheet instead of drawing. */
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
          -webkit-touch-callout: none;
          cursor: crosshair;
        }
      `}</style>
    </div>
  );
}
