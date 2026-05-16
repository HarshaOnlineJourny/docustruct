import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Multi-page PDF preview with page navigation, zoom controls, and box
// overlays. Boxes coming in are in PDF coordinates (origin bottom-left).
//
// Props:
//   fileUrl              same-origin URL to the PDF
//   initialPage          0-based starting page
//   boxes                [{ id, page (optional, defaults to initialPage), x, y, w, h, field_label, field_id }]
//   highlightedFieldId   when set, that box is emphasised
//   onBoxClick           called with the clicked box object
//
// Exposes via ref:
//   goToBox(box)         pages to box.page if needed and emphasises it briefly
const COLORS = [
  '#4f46e5', '#059669', '#d97706', '#dc2626', '#0284c7',
  '#7c3aed', '#db2777', '#65a30d', '#ea580c', '#0891b2',
];

const PdfPagePreview = forwardRef(function PdfPagePreview(
  { fileUrl, initialPage = 0, boxes = [], highlightedFieldId, onBoxClick },
  ref
) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [pageNum, setPageNum] = useState(initialPage);
  const [zoom, setZoom] = useState(1.4);
  const [viewport, setViewport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load the PDF document once.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const doc = await pdfjsLib.getDocument({ url: fileUrl, withCredentials: true }).promise;
        if (cancelled) return;
        setPdf(doc);
      } catch (e) {
        if (!cancelled) {
          setError(e.message || String(e));
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [fileUrl]);

  // Render the current page whenever pdf/pageNum/zoom change.
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const pdfPage = await pdf.getPage(pageNum + 1);
        if (cancelled) return;
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const targetWidth = Math.min(1100, baseViewport.width * zoom);
        const scale = targetWidth / baseViewport.width;
        const vp = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        canvas.width = vp.width;
        canvas.height = vp.height;
        await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
        if (cancelled) return;
        setViewport(vp);
        setLoading(false);
      } catch (e) {
        if (!cancelled) { setError(e.message || String(e)); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [pdf, pageNum, zoom]);

  useImperativeHandle(ref, () => ({
    goToBox(box) {
      if (!box) return;
      if (box.page != null && box.page !== pageNum) setPageNum(box.page);
      // Scroll the PDF view so the box is visible.
      requestAnimationFrame(() => {
        if (!viewport || !containerRef.current) return;
        const x = box.x * viewport.scale;
        const y = (viewport.viewBox[3] - (box.y + box.h)) * viewport.scale;
        containerRef.current.scrollTo({
          top: Math.max(0, y - 80),
          left: Math.max(0, x - 80),
          behavior: 'smooth',
        });
      });
    },
  }));

  const totalPages = pdf?.numPages ?? 0;
  const visibleBoxes = boxes.filter((b) => (b.page ?? initialPage) === pageNum);

  const overlay = viewport ? visibleBoxes.map((b, i) => {
    const x = b.x * viewport.scale;
    const y = (viewport.viewBox[3] - (b.y + b.h)) * viewport.scale;
    const w = Math.max(8, b.w * viewport.scale);
    const h = Math.max(10, b.h * viewport.scale);
    const color = b.color || COLORS[(b.field_id ?? i) % COLORS.length];
    const isHighlighted = highlightedFieldId != null && b.field_id === highlightedFieldId;
    return { ...b, x, y, w, h, color, isHighlighted };
  }) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface-2)', flex: 'none',
      }}>
        <button className="btn btn-secondary btn-sm" disabled={pageNum === 0}
                onClick={() => setPageNum((p) => Math.max(0, p - 1))}>◀</button>
        <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', minWidth: 90, textAlign: 'center' }}>
          Page <input type="number" min="1" max={totalPages || 1}
                      value={pageNum + 1}
                      onChange={(e) => {
                        const n = Math.max(1, Math.min(totalPages || 1, Number(e.target.value) || 1));
                        setPageNum(n - 1);
                      }}
                      style={{
                        width: 48, padding: '2px 4px', textAlign: 'center',
                        border: '1px solid var(--color-border-strong)', borderRadius: 4,
                        fontFamily: 'inherit', fontSize: 12,
                      }} /> / {totalPages || '?'}
        </span>
        <button className="btn btn-secondary btn-sm" disabled={pageNum >= totalPages - 1}
                onClick={() => setPageNum((p) => Math.min(totalPages - 1, p + 1))}>▶</button>

        <div style={{ width: 1, height: 20, background: 'var(--color-border)', margin: '0 4px' }} />

        <button className="btn btn-secondary btn-sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}>−</button>
        <span style={{ fontSize: 12, minWidth: 48, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button className="btn btn-secondary btn-sm" onClick={() => setZoom((z) => Math.min(3, z + 0.2))}>+</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setZoom(1.4)} title="Reset zoom">Fit</button>

        <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {visibleBoxes.length} field{visibleBoxes.length === 1 ? '' : 's'} on this page
        </span>
      </div>

      {/* Scrollable PDF viewport */}
      <div ref={containerRef} style={{ flex: 1, overflow: 'auto', background: '#f4f5fa', padding: 12 }}>
        {error && <div className="muted" style={{ padding: 12, fontSize: 12 }}>Couldn't render PDF: {error}</div>}
        {loading && !error && <div className="muted" style={{ padding: 12, fontSize: 12 }}>Rendering page {pageNum + 1}…</div>}
        <div style={{
          position: 'relative',
          width: viewport?.width, height: viewport?.height,
          margin: '0 auto', background: 'white',
          boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
        }}>
          <canvas ref={canvasRef} style={{ display: 'block' }} />
          <svg style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            pointerEvents: 'none',
          }}>
            {overlay.map((b, i) => (
              <g key={i}
                 style={{ pointerEvents: onBoxClick ? 'auto' : 'none', cursor: onBoxClick ? 'pointer' : 'default' }}
                 onClick={() => onBoxClick?.(b)}>
                <rect x={b.x - 2} y={b.y - 2} width={b.w + 4} height={b.h + 4}
                      fill={b.color}
                      fillOpacity={b.isHighlighted ? 0.32 : 0.16}
                      stroke={b.color}
                      strokeWidth={b.isHighlighted ? 3 : 1.5}
                      rx="3" />
                {b.field_label && (
                  <text x={b.x} y={Math.max(12, b.y - 4)}
                        fill={b.color} fontSize="11" fontWeight="600"
                        style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 3, strokeLinejoin: 'round' }}>
                    {b.field_label}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
});

export default PdfPagePreview;
export { COLORS };
