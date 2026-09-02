import { useCallback, useEffect, useRef, useState } from "react";
import { getSetting } from "../db";

interface ImageViewerProps {
  blob?: Blob;
  serverUrl?: string;
  alt: string;
  onClose: () => void;
  onSave?: (annotatedBlob: Blob) => void;
}

type Tool = "none" | "select" | "arrow" | "rect" | "freehand" | "text";
type Color = "#ff0000" | "#ffff00" | "#00ff00" | "#ffffff" | "#000000";

interface Annotation {
  id: number;
  tool: "arrow" | "rect" | "freehand" | "text";
  color: Color;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  points: { x: number; y: number }[];
  text: string;
}

const COLORS: Color[] = ["#ff0000", "#ffff00", "#00ff00", "#ffffff", "#000000"];

let annIdCounter = 1;

export default function ImageViewer({ blob, serverUrl, alt, onClose, onSave }: ImageViewerProps) {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [naturalW, setNaturalW] = useState(0);
  const [naturalH, setNaturalH] = useState(0);
  const [resolvedBlob, setResolvedBlob] = useState<Blob | undefined>(blob);

  // Zoom/pan
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [panning, setPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Annotations
  const [tool, setTool] = useState<Tool>("none");
  const [color, setColor] = useState<Color>("#ff0000");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [drawing, setDrawing] = useState<Annotation | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingTextId, setEditingTextId] = useState<number | null>(null);
  const [textValue, setTextValue] = useState("");
  const [showToolbar, setShowToolbar] = useState(true);

  // Drag/resize state
  const dragMode = useRef<"move" | "resize-start" | "resize-end" | "resize-point" | null>(null);
  const dragPointIdx = useRef(0);
  const dragStart = useRef({ mx: 0, my: 0, ann: null as Annotation | null });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinchDist = useRef(0);

  // Load image
  useEffect(() => {
    let url = "";
    let cancelled = false;
    (async () => {
      let useBlob = resolvedBlob;
      if (!useBlob && serverUrl) {
        try {
          const token = await getSetting("auth_token", "");
          const base = await getSetting("server_url", "");
          const fullUrl = serverUrl.startsWith("http") ? serverUrl : (base + serverUrl);
          const resp = await fetch(fullUrl, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (resp.ok) {
            useBlob = await resp.blob();
            if (!cancelled) setResolvedBlob(useBlob);
          }
        } catch {}
      }
      if (!useBlob || cancelled) return;
      url = URL.createObjectURL(useBlob);
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        setImgEl(img);
        setNaturalW(img.naturalWidth);
        setNaturalH(img.naturalHeight);
        const fitZoom = Math.min(window.innerWidth / img.naturalWidth, window.innerHeight / img.naturalHeight, 1);
        setZoom(fitZoom);
        setPanX(0);
        setPanY(0);
      };
      img.src = url;
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [resolvedBlob, serverUrl]);

  // Screen → image coords
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

  // Image → screen coords (for hit testing)
  const toScreenCoords = useCallback((imgX: number, imgY: number) => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const x = (imgX - naturalW / 2) * zoom + cx + panX + rect.left;
    const y = (imgY - naturalH / 2) * zoom + cy + panY + rect.top;
    return { x, y };
  }, [zoom, panX, panY, naturalW, naturalH]);

  // Hit test: check if a screen point is on an annotation
  const hitTestAnn = useCallback((ann: Annotation, imgX: number, imgY: number): "body" | "start" | "end" | null => {
    const tol = 20 / zoom; // 20px tolerance in image coords
    if (ann.tool === "arrow") {
      // Check start handle
      if (Math.hypot(imgX - ann.startX, imgY - ann.startY) < tol) return "start";
      // Check end handle
      if (Math.hypot(imgX - ann.endX, imgY - ann.endY) < tol) return "end";
      // Check line (point-to-line distance)
      const d = pointToLineDist(imgX, imgY, ann.startX, ann.startY, ann.endX, ann.endY);
      if (d < tol) return "body";
    } else if (ann.tool === "rect") {
      const minX = Math.min(ann.startX, ann.endX);
      const maxX = Math.max(ann.startX, ann.endX);
      const minY = Math.min(ann.startY, ann.endY);
      const maxY = Math.max(ann.startY, ann.endY);
      // Check corners (start/end handles)
      if (Math.hypot(imgX - ann.startX, imgY - ann.startY) < tol) return "start";
      if (Math.hypot(imgX - ann.endX, imgY - ann.endY) < tol) return "end";
      // Check edges
      const onEdge = (imgX > minX - tol && imgX < maxX + tol && imgY > minY - tol && imgY < maxY + tol) &&
                     (Math.abs(imgX - minX) < tol || Math.abs(imgX - maxX) < tol || Math.abs(imgY - minY) < tol || Math.abs(imgY - maxY) < tol);
      if (onEdge) return "body";
      // Inside
      if (imgX > minX && imgX < maxX && imgY > minY && imgY < maxY) return "body";
    } else if (ann.tool === "freehand") {
      // Check if near any point in the path
      for (const p of ann.points) {
        if (Math.hypot(imgX - p.x, imgY - p.y) < tol) return "body";
      }
    } else if (ann.tool === "text") {
      const fontSize = Math.max(20, naturalW / 40);
      const w = ann.text.length * fontSize * 0.6;
      const h = fontSize;
      if (imgX >= ann.startX - tol && imgX <= ann.startX + w + tol && imgY >= ann.startY - h - tol && imgY <= ann.startY + tol) return "body";
      // End handle for resize
      if (Math.hypot(imgX - (ann.startX + w), imgY - ann.startY) < tol * 1.5) return "end";
    }
    return null;
  }, [zoom, naturalW]);

  // Find topmost annotation at a point
  const findAnnotationAt = useCallback((imgX: number, imgY: number): { ann: Annotation; part: "body" | "start" | "end" } | null => {
    for (let i = annotations.length - 1; i >= 0; i--) {
      const part = hitTestAnn(annotations[i], imgX, imgY);
      if (part) return { ann: annotations[i], part };
    }
    return null;
  }, [annotations, hitTestAnn]);

  // Render main canvas (image + annotations)
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgEl) return;
    canvas.width = naturalW;
    canvas.height = naturalH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(imgEl, 0, 0);
    const allAnns = drawing ? [...annotations, drawing] : annotations;
    for (const ann of allAnns) drawAnnotation(ctx, ann, naturalW, ann.id === selectedId);
  }, [imgEl, naturalW, naturalH, annotations, drawing, selectedId]);

  // Render overlay (selection handles)
  const renderOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const container = containerRef.current;
    if (!overlay || !container) return;
    const rect = container.getBoundingClientRect();
    overlay.width = rect.width;
    overlay.height = rect.height;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (selectedId === null) return;
    const ann = annotations.find((a) => a.id === selectedId);
    if (!ann) return;

    // Draw selection handles in screen coords
    const handleSize = 12;
    ctx.fillStyle = "#2e7dd1";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;

    const drawHandle = (imgX: number, imgY: number) => {
      const s = toScreenCoords(imgX, imgY);
      ctx.beginPath();
      ctx.arc(s.x - rect.left, s.y - rect.top, handleSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };

    if (ann.tool === "arrow" || ann.tool === "rect") {
      drawHandle(ann.startX, ann.startY);
      drawHandle(ann.endX, ann.endY);
    } else if (ann.tool === "text") {
      const fontSize = Math.max(20, naturalW / 40);
      const w = ann.text.length * fontSize * 0.6;
      drawHandle(ann.startX, ann.startY);
      drawHandle(ann.startX + w, ann.startY);
    } else if (ann.tool === "freehand") {
      // Draw handles at start and end
      if (ann.points.length > 0) {
        drawHandle(ann.points[0].x, ann.points[0].y);
        drawHandle(ann.points[ann.points.length - 1].x, ann.points[ann.points.length - 1].y);
      }
    }
  }, [annotations, selectedId, naturalW, toScreenCoords]);

  useEffect(() => { render(); }, [render]);
  useEffect(() => { renderOverlay(); }, [renderOverlay]);

  // Pointer handlers
  function onPointerDown(e: React.PointerEvent) {
    if (editingTextId !== null) return;
    const { x, y } = toImgCoords(e.clientX, e.clientY);

    if (tool === "none") {
      setPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX, panY };
      return;
    }

    if (tool === "select") {
      // Check if we clicked on a handle of the selected annotation
      if (selectedId !== null) {
        const selAnn = annotations.find((a) => a.id === selectedId);
        if (selAnn) {
          const part = hitTestAnn(selAnn, x, y);
          if (part === "start" || part === "end") {
            dragMode.current = part === "start" ? "resize-start" : "resize-end";
            dragStart.current = { mx: x, my: y, ann: { ...selAnn } };
            return;
          }
        }
      }
      // Check if we clicked on any annotation
      const hit = findAnnotationAt(x, y);
      if (hit) {
        setSelectedId(hit.ann.id);
        if (hit.part === "start") {
          dragMode.current = "resize-start";
          dragStart.current = { mx: x, my: y, ann: { ...hit.ann } };
        } else if (hit.part === "end") {
          dragMode.current = "resize-end";
          dragStart.current = { mx: x, my: y, ann: { ...hit.ann } };
        } else {
          dragMode.current = "move";
          dragStart.current = { mx: x, my: y, ann: { ...hit.ann } };
        }
      } else {
        setSelectedId(null);
      }
      return;
    }

    if (tool === "text") {
      const newAnn: Annotation = {
        id: annIdCounter++, tool, color,
        startX: x, startY: y, endX: x, endY: y,
        points: [], text: "",
      };
      setAnnotations((a) => [...a, newAnn]);
      setEditingTextId(newAnn.id);
      setTextValue("");
      setSelectedId(newAnn.id);
      return;
    }

    // Drawing tools (arrow, rect, freehand)
    if (tool === "freehand") {
      setDrawing({ id: annIdCounter++, tool, color, startX: x, startY: y, endX: x, endY: y, points: [{ x, y }], text: "" });
    } else {
      setDrawing({ id: annIdCounter++, tool, color, startX: x, startY: y, endX: x, endY: y, points: [], text: "" });
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (panning) {
      setPanX(panStart.current.panX + (e.clientX - panStart.current.x));
      setPanY(panStart.current.panY + (e.clientY - panStart.current.y));
      return;
    }

    const { x, y } = toImgCoords(e.clientX, e.clientY);

    if (dragMode.current && dragStart.current.ann) {
      const orig = dragStart.current.ann;
      const dx = x - dragStart.current.mx;
      const dy = y - dragStart.current.my;

      if (dragMode.current === "move") {
        setAnnotations((arr) => arr.map((a) => {
          if (a.id !== orig.id) return a;
          if (a.tool === "freehand") {
            return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })), startX: a.startX + dx, startY: a.startY + dy, endX: a.endX + dx, endY: a.endY + dy };
          }
          return { ...a, startX: a.startX + dx, startY: a.startY + dy, endX: a.endX + dx, endY: a.endY + dy };
        }));
        dragStart.current.mx = x;
        dragStart.current.my = y;
      } else if (dragMode.current === "resize-start") {
        setAnnotations((arr) => arr.map((a) => a.id === orig.id ? { ...a, startX: x, startY: y } : a));
      } else if (dragMode.current === "resize-end") {
        setAnnotations((arr) => arr.map((a) => {
          if (a.id !== orig.id) return a;
          if (a.tool === "text") {
            // For text, resizing changes font size based on distance
            return { ...a, endX: x, endY: y };
          }
          return { ...a, endX: x, endY: y };
        }));
      }
      return;
    }

    if (drawing) {
      if (drawing.tool === "freehand") {
        setDrawing({ ...drawing, points: [...drawing.points, { x, y }], endX: x, endY: y });
      } else {
        setDrawing({ ...drawing, endX: x, endY: y });
      }
    }
  }

  function onPointerUp() {
    if (panning) setPanning(false);
    if (dragMode.current) {
      dragMode.current = null;
      dragStart.current.ann = null;
    }
    if (drawing) {
      // Don't add trivially small annotations
      const minSize = 5 / zoom;
      if (drawing.tool === "freehand" && drawing.points.length > 1) {
        setAnnotations((a) => [...a, drawing]);
      } else if (drawing.tool !== "freehand" && (Math.abs(drawing.endX - drawing.startX) > minSize || Math.abs(drawing.endY - drawing.startY) > minSize)) {
        setAnnotations((a) => [...a, drawing]);
      }
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
    if (editingTextId !== null) {
      if (textValue.trim()) {
        setAnnotations((a) => a.map((ann) => ann.id === editingTextId ? { ...ann, text: textValue.trim() } : ann));
      } else {
        setAnnotations((a) => a.filter((ann) => ann.id !== editingTextId));
        setSelectedId(null);
      }
    }
    setEditingTextId(null);
    setTextValue("");
  }

  function deleteSelected() {
    if (selectedId !== null) {
      setAnnotations((a) => a.filter((ann) => ann.id !== selectedId));
      setSelectedId(null);
    }
  }

  function undo() {
    setAnnotations((a) => a.slice(0, -1));
    setSelectedId(null);
  }

  function clearAll() {
    setAnnotations([]);
    setSelectedId(null);
  }

  async function saveAnnotated() {
    if (!canvasRef.current) return;
    if (annotations.length === 0) { onClose(); return; }
    // Temporarily deselect for clean render
    const prevSel = selectedId;
    setSelectedId(null);
    await new Promise((r) => setTimeout(r, 50)); // let re-render happen
    canvasRef.current.toBlob((annotatedBlob) => {
      setSelectedId(prevSel);
      if (annotatedBlob && onSave) onSave(annotatedBlob);
      onClose();
    }, "image/jpeg", 0.9);
  }

  const canvasStyle: React.CSSProperties = {
    transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
    transformOrigin: "50% 50%",
    maxWidth: "none", maxHeight: "none",
    touchAction: "none",
    cursor: tool === "none" ? (panning ? "grabbing" : "grab") : tool === "select" ? "default" : "crosshair",
    width: naturalW || undefined,
    height: naturalH || undefined,
  };

  const overlayStyle: React.CSSProperties = {
    position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5,
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
        {selectedId !== null && (
          <button className="iv-btn" onClick={deleteSelected} style={{ ...ivBtnStyle, background: "rgba(192,57,43,0.8)" }}>🗑</button>
        )}
        {annotations.length > 0 && <button className="iv-btn" onClick={undo} style={ivBtnStyle}>Undo</button>}
        {annotations.length > 0 && <button className="iv-btn" onClick={clearAll} style={ivBtnStyle}>Clear</button>}
        <button className="iv-btn" onClick={() => setShowToolbar(!showToolbar)} style={ivBtnStyle}>
          {showToolbar ? "Hide" : "Tools"}
        </button>
        {onSave && (
          <button className="iv-btn iv-save" onClick={saveAnnotated} style={{ ...ivBtnStyle, background: "var(--brand-accent)" }}>Save</button>
        )}
      </div>

      {/* Canvas area */}
      <div
        style={{ flex: 1, overflow: "hidden", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
      >
        <canvas ref={canvasRef} style={canvasStyle} />
        <canvas ref={overlayRef} style={overlayStyle} />
      </div>

      {/* Text input overlay */}
      {editingTextId !== null && (
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
            style={{ fontSize: 18, padding: "8px 12px", borderRadius: 6, border: "1px solid #555", background: "#fff", color: "#000", minWidth: 200 }}
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
          {(["none", "select", "arrow", "rect", "freehand", "text"] as Tool[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTool(t); if (t !== "select") setSelectedId(null); }}
              style={{
                ...ivBtnStyle,
                background: tool === t ? "var(--brand-accent)" : "rgba(255,255,255,0.15)",
                color: "#fff", border: "1px solid rgba(255,255,255,0.3)",
                padding: "8px 12px", fontSize: 13, borderRadius: 8,
              }}
            >
              {t === "none" ? "🖐 Pan" : t === "select" ? "◀▶ Select" : t === "arrow" ? "→ Arrow" : t === "rect" ? "▭ Box" : t === "freehand" ? "✏ Draw" : "T Text"}
            </button>
          ))}
          <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setColor(c);
                  if (selectedId !== null) {
                    setAnnotations((a) => a.map((ann) => ann.id === selectedId ? { ...ann, color: c } : ann));
                  }
                }}
                style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: c, border: color === c ? "3px solid #fff" : "2px solid rgba(255,255,255,0.4)",
                  cursor: "pointer", flexShrink: 0,
                }}
              />
            ))}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            <button onClick={() => setZoom((z) => Math.max(0.1, z * 0.8))} style={ivBtnStyle}>−</button>
            <span style={{ color: "#fff", fontSize: 12, alignSelf: "center", minWidth: 40, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(8, z * 1.25))} style={ivBtnStyle}>+</button>
          </div>
        </div>
      )}
    </div>
  );
}

const ivBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.15)", color: "#fff",
  border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6,
  padding: "6px 10px", fontSize: 14, cursor: "pointer", minHeight: 36,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};

function drawAnnotation(ctx: CanvasRenderingContext2D, ann: Annotation, naturalW: number, selected: boolean) {
  ctx.strokeStyle = ann.color;
  ctx.fillStyle = ann.color;
  ctx.lineWidth = Math.max(3, naturalW / 400);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (ann.tool === "arrow") {
    drawArrow(ctx, ann.startX, ann.startY, ann.endX, ann.endY);
  } else if (ann.tool === "rect") {
    ctx.strokeRect(
      Math.min(ann.startX, ann.endX), Math.min(ann.startY, ann.endY),
      Math.abs(ann.endX - ann.startX), Math.abs(ann.endY - ann.startY)
    );
  } else if (ann.tool === "freehand" && ann.points.length > 1) {
    ctx.beginPath();
    ctx.moveTo(ann.points[0].x, ann.points[0].y);
    for (let i = 1; i < ann.points.length; i++) ctx.lineTo(ann.points[i].x, ann.points[i].y);
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

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  const headLen = Math.max(15, ctx.lineWidth * 4);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function pointToLineDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}
