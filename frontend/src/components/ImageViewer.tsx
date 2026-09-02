import { useCallback, useEffect, useRef, useState } from "react";

interface ImageViewerProps {
  blob: Blob;
  alt: string;
  onClose: () => void;
  onSave?: (annotatedBlob: Blob) => void;
}

type Tool = "none" | "arrow" | "rect" | "freehand" | "text";
type Color = "#ff0000" | "#ffff00" | "#00ff00" | "#ffffff" | "#000000";

interface Annotation {
  tool: Tool;
  color: Color;
  startX: number;
  startY: number;
  endX?: number;
  endY?: number;
  points?: { x: number; y: number }[];
  text?: string;
}

const COLORS: Color[] = ["#ff0000", "#ffff00", "#00ff00", "#ffffff", "#000000"];

export default function ImageViewer({ blob, alt, onClose, onSave }: ImageViewerProps) {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [naturalW, setNaturalW] = useState(0);
  const [naturalH, setNaturalH] = useState(0);

  // Zoom/pan state. panX/panY are the center offset in screen pixels.
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [panning, setPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Annotation state
  const [tool, setTool] = useState<Tool>("none");
  const [color, setColor] = useState<Color>("#ff0000");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [drawing, setDrawing] = useState<Annotation | null>(null);
  const [editingTextIdx, setEditingTextIdx] = useState<number | null>(null);
  const [textValue, setTextValue] = useState("");
  const [showToolbar, setShowToolbar] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinchDist = useRef(0);

  // Load image and fit to screen
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      setImgEl(img);
      setNaturalW(img.naturalWidth);
      setNaturalH(img.naturalHeight);
      // Fit to screen and center
      const containerW = window.innerWidth;
      const containerH = window.innerHeight;
      const fitZoom = Math.min(containerW / img.naturalWidth, containerH / img.naturalHeight, 1);
      setZoom(fitZoom);
      // Center: pan offset so the image center aligns with container center.
      // With transformOrigin "50% 50%", panX=0/panY=0 means centered.
      setPanX(0);
      setPanY(0);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  // Convert screen coords to image coords.
  // The canvas is centered in the container via flexbox + transformOrigin 50%.
  // Screen position → image position:
  //   imgX = (screenX - containerCenterX - panX) / zoom + naturalW/2
  //   imgY = (screenY - containerCenterY - panY) / zoom + naturalH/2
  const toImgCoords = useCallback((screenX: number, screenY: number) => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const x = (screenX - rect.left - cx - panX) / zoom + naturalW / 2;
    const y = (screenY - rect.top - cy - panY) / zoom + naturalH / 2;
    return { x, y };
  }, [zoom, panX, panY, naturalW, naturalH]);

  // Render canvas
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgEl) return;
    canvas.width = naturalW;
    canvas.height = naturalH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw image
    ctx.drawImage(imgEl, 0, 0);

    // Draw annotations
    const allAnns = drawing ? [...annotations, drawing] : annotations;
    for (const ann of allAnns) {
      ctx.strokeStyle = ann.color;
      ctx.fillStyle = ann.color;
      ctx.lineWidth = Math.max(3, naturalW / 400);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (ann.tool === "arrow" && ann.endX != null && ann.endY != null) {
        drawArrow(ctx, ann.startX, ann.startY, ann.endX, ann.endY);
      } else if (ann.tool === "rect" && ann.endX != null && ann.endY != null) {
        ctx.strokeRect(
          Math.min(ann.startX, ann.endX),
          Math.min(ann.startY, ann.endY),
          Math.abs(ann.endX - ann.startX),
          Math.abs(ann.endY - ann.startY)
        );
      } else if (ann.tool === "freehand" && ann.points && ann.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x, ann.points[0].y);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x, ann.points[i].y);
        }
        ctx.stroke();
      } else if (ann.tool === "text" && ann.text) {
        const fontSize = Math.max(20, naturalW / 40);
        ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
        ctx.lineWidth = fontSize / 4;
        ctx.strokeStyle = ann.color === "#ffffff" || ann.color === "#ffff00" ? "#000000" : "#ffffff";
        ctx.strokeText(ann.text, ann.startX, ann.startY);
        ctx.fillText(ann.text, ann.startX, ann.startY);
      }
    }
  }, [imgEl, naturalW, naturalH, annotations, drawing]);

  useEffect(() => { render(); }, [render]);

  // Pointer handlers
  function onPointerDown(e: React.PointerEvent) {
    if (editingTextIdx !== null) return;
    if (tool === "none") {
      setPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX, panY };
    } else if (tool === "text") {
      const { x, y } = toImgCoords(e.clientX, e.clientY);
      const newAnn: Annotation = { tool, color, startX: x, startY: y, text: "" };
      setAnnotations((a) => [...a, newAnn]);
      setEditingTextIdx(annotations.length);
      setTextValue("");
    } else {
      const { x, y } = toImgCoords(e.clientX, e.clientY);
      if (tool === "freehand") {
        setDrawing({ tool, color, startX: x, startY: y, points: [{ x, y }] });
      } else {
        setDrawing({ tool, color, startX: x, startY: y, endX: x, endY: y });
      }
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (panning) {
      setPanX(panStart.current.panX + (e.clientX - panStart.current.x));
      setPanY(panStart.current.panY + (e.clientY - panStart.current.y));
    } else if (drawing) {
      const { x, y } = toImgCoords(e.clientX, e.clientY);
      if (drawing.tool === "freehand") {
        setDrawing({ ...drawing, points: [...(drawing.points ?? []), { x, y }] });
      } else {
        setDrawing({ ...drawing, endX: x, endY: y });
      }
    }
  }

  function onPointerUp() {
    if (panning) setPanning(false);
    if (drawing) {
      setAnnotations((a) => [...a, drawing]);
      setDrawing(null);
    }
  }

  // Pinch zoom
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchDist.current = Math.hypot(dx, dy);
    }
  }
  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinchDist.current > 0) {
        const scale = dist / pinchDist.current;
        setZoom((z) => Math.max(0.1, Math.min(8, z * scale)));
      }
      pinchDist.current = dist;
    }
  }

  function commitText() {
    if (editingTextIdx !== null && textValue.trim()) {
      setAnnotations((a) => a.map((ann, i) => i === editingTextIdx ? { ...ann, text: textValue.trim() } : ann));
    } else if (editingTextIdx !== null) {
      setAnnotations((a) => a.filter((_, i) => i !== editingTextIdx));
    }
    setEditingTextIdx(null);
    setTextValue("");
  }

  function undo() {
    setAnnotations((a) => a.slice(0, -1));
  }

  function clearAll() {
    setAnnotations([]);
  }

  async function saveAnnotated() {
    if (!canvasRef.current) return;
    if (annotations.length === 0) {
      onClose();
      return;
    }
    canvasRef.current.toBlob((annotatedBlob) => {
      if (annotatedBlob && onSave) {
        onSave(annotatedBlob);
      }
      onClose();
    }, "image/jpeg", 0.9);
  }

  // The canvas is centered in the container via flexbox.
  // The transform scales from the center (transformOrigin 50% 50%).
  // panX/panY offset from the centered position.
  const canvasStyle: React.CSSProperties = {
    transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
    transformOrigin: "50% 50%",
    maxWidth: "none",
    maxHeight: "none",
    touchAction: "none",
    cursor: tool === "none" ? (panning ? "grabbing" : "grab") : "crosshair",
    // Constrain display size so the canvas doesn't overflow before transform.
    // The actual canvas pixel size is naturalW x naturalH, but we display
    // it at a size that fits the screen, then scale with transform.
    width: naturalW || undefined,
    height: naturalH || undefined,
  };

  return (
    <div
      ref={containerRef}
      className="image-viewer"
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "#000", display: "flex", flexDirection: "column",
        touchAction: "none", userSelect: "none",
      }}
    >
      {/* Top bar */}
      <div className="iv-topbar" style={{
        position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
        display: "flex", alignItems: "center", gap: 8, padding: "calc(var(--safe-top) + 8px) 12px 8px",
        background: "linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)",
      }}>
        <button className="iv-btn" onClick={onClose} style={ivBtnStyle}>✕</button>
        <span style={{ color: "#fff", fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{alt}</span>
        {annotations.length > 0 && (
          <button className="iv-btn" onClick={undo} style={ivBtnStyle}>Undo</button>
        )}
        {annotations.length > 0 && (
          <button className="iv-btn" onClick={clearAll} style={ivBtnStyle}>Clear</button>
        )}
        <button className="iv-btn" onClick={() => setShowToolbar(!showToolbar)} style={ivBtnStyle}>
          {showToolbar ? "Hide" : "Tools"}
        </button>
        {onSave && (
          <button className="iv-btn iv-save" onClick={saveAnnotated} style={{ ...ivBtnStyle, background: "var(--brand-accent)" }}>
            Save
          </button>
        )}
      </div>

      {/* Canvas area — flex centers the canvas, transform handles zoom/pan */}
      <div
        style={{
          flex: 1, overflow: "hidden", position: "relative",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
      >
        <canvas ref={canvasRef} style={canvasStyle} />
      </div>

      {/* Text input overlay */}
      {editingTextIdx !== null && (
        <div style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          zIndex: 20, display: "flex", gap: 8, alignItems: "center",
          background: "rgba(0,0,0,0.8)", padding: 12, borderRadius: 10,
        }}>
          <input
            autoFocus
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitText(); }}
            placeholder="Type annotation…"
            style={{
              fontSize: 18, padding: "8px 12px", borderRadius: 6, border: "1px solid #555",
              background: "#fff", color: "#000", minWidth: 200,
            }}
          />
          <button className="iv-btn iv-save" onClick={commitText} style={{ ...ivBtnStyle, background: "var(--brand-accent)" }}>✓</button>
        </div>
      )}

      {/* Bottom toolbar */}
      {showToolbar && (
        <div className="iv-toolbar" style={{
          position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 10,
          display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
          padding: "10px 12px calc(8px + var(--safe-bottom))",
          background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)",
        }}>
          {/* Tool buttons */}
          {(["none", "arrow", "rect", "freehand", "text"] as Tool[]).map((t) => (
            <button
              key={t}
              onClick={() => setTool(t)}
              style={{
                ...ivBtnStyle,
                background: tool === t ? "var(--brand-accent)" : "rgba(255,255,255,0.15)",
                color: "#fff", border: "1px solid rgba(255,255,255,0.3)",
                padding: "8px 12px", fontSize: 13, borderRadius: 8,
              }}
            >
              {t === "none" ? "🖐 Pan" : t === "arrow" ? "→ Arrow" : t === "rect" ? "▭ Box" : t === "freehand" ? "✏ Draw" : "T Text"}
            </button>
          ))}
          {/* Color swatches */}
          <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: c, border: color === c ? "3px solid #fff" : "2px solid rgba(255,255,255,0.4)",
                  cursor: "pointer", flexShrink: 0,
                }}
              />
            ))}
          </div>
          {/* Zoom controls */}
          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            <button onClick={() => setZoom((z) => Math.max(0.1, z * 0.8))} style={ivBtnStyle}>−</button>
            <span style={{ color: "#fff", fontSize: 12, alignSelf: "center", minWidth: 40, textAlign: "center" }}>
              {Math.round(zoom * 100)}%
            </span>
            <button onClick={() => setZoom((z) => Math.min(8, z * 1.25))} style={ivBtnStyle}>+</button>
          </div>
        </div>
      )}
    </div>
  );
}

const ivBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.15)",
  color: "#fff",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 14,
  cursor: "pointer",
  minHeight: 36,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  const headLen = Math.max(15, ctx.lineWidth * 4);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}
