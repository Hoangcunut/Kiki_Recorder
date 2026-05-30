import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Point, RecordingOverlayConfig, RecordingOverlayEvent, Rect } from "../../shared/types";
import { getI18n } from "../i18n";
import { renderAnnotations } from "../lib/annotations/renderAnnotations";

export function RecordingSurfaceApp() {
  const [config, setConfig] = useState<RecordingOverlayConfig | undefined>();
  const [editingText, setEditingText] = useState<{ point: Point; value: string } | null>(null);
  const annotationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const text = getI18n(config?.language ?? "en");

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    void window.kiki.getRecordingOverlayState().then((state) => {
      if (state) {
        setConfig(state);
      }
    });
    return window.kiki.onRecordingOverlayUpdate(setConfig);
  }, []);

  useEffect(() => {
    if (config?.activeTool !== "text") {
      setEditingText(null);
    }
  }, [config?.activeTool]);

  const captureRect = useMemo(() => {
    if (!config) {
      return undefined;
    }
    return {
      x: config.captureBounds.x - config.surfaceBounds.x,
      y: config.captureBounds.y - config.surfaceBounds.y,
      width: config.captureBounds.width,
      height: config.captureBounds.height
    };
  }, [config]);

  useEffect(() => {
    if (!config || !captureRect) {
      return;
    }
    const canvas = annotationCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }

    canvas.width = Math.max(1, Math.round(config.surfaceBounds.width));
    canvas.height = Math.max(1, Math.round(config.surfaceBounds.height));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(captureRect.x, captureRect.y);
    ctx.scale(
      captureRect.width / Math.max(1, config.sourceSize.width),
      captureRect.height / Math.max(1, config.sourceSize.height)
    );
    if (config.surfaceAnnotationsVisible) {
      renderAnnotations(ctx, config.annotations);
    }
    ctx.restore();
  }, [config, captureRect]);

  if (!config) {
    return null;
  }

  function send(event: RecordingOverlayEvent): void {
    window.kiki.sendRecordingOverlayEvent(event);
  }

  function pointFromEvent(event: React.PointerEvent | React.WheelEvent): Point | undefined {
    if (!config || !captureRect || !config.surfaceInteractive) {
      return undefined;
    }
    const localX = event.clientX - captureRect.x;
    const localY = event.clientY - captureRect.y;
    if (localX < 0 || localY < 0 || localX > captureRect.width || localY > captureRect.height) {
      return undefined;
    }
    return {
      x: (localX / Math.max(1, captureRect.width)) * config.sourceSize.width,
      y: (localY / Math.max(1, captureRect.height)) * config.sourceSize.height,
      t: performance.now()
    };
  }

  function pointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    const point = pointFromEvent(event);
    if (!point || event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (config?.activeTool === "text") {
      setEditingText({ point, value: "" });
      return;
    }
    send({ type: "pointer-down", point, button: event.button });
  }

  function pointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const point = pointFromEvent(event);
    if (point) {
      send({ type: "pointer-move", point });
    }
  }

  function pointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    const point = pointFromEvent(event);
    if (point) {
      send({ type: "pointer-up", point });
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can be released by the platform first.
    }
  }

  function wheel(event: React.WheelEvent<HTMLDivElement>): void {
    const point = pointFromEvent(event);
    if (!point) {
      return;
    }
    event.preventDefault();
    send({ type: "wheel", point, deltaY: event.deltaY });
  }

  return (
    <div
      className={`recordingSurfaceRoot ${config.drawingEnabled ? "drawingEnabled" : ""}`}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onWheel={wheel}
    >
      <canvas ref={annotationCanvasRef} className="recordingAnnotationCanvas" />
      {captureRect ? <div className="recordingCaptureFrame" style={rectStyle(captureRect)} /> : null}

      {editingText && captureRect ? (
        <textarea
          className="inlineTextEditor"
          style={{
            position: "absolute",
            left: `${editingText.point.x * captureRect.width / config.sourceSize.width + captureRect.x}px`,
            top: `${editingText.point.y * captureRect.height / config.sourceSize.height + captureRect.y}px`,
            fontSize: `${config.style.fontSize * captureRect.height / config.sourceSize.height}px`,
            fontFamily: config.style.fontFamily,
            color: config.style.color,
            fontWeight: config.style.bold ? "bold" : "normal",
            fontStyle: config.style.italic ? "italic" : "normal",
            background: "transparent",
            border: "1px dashed rgba(255, 255, 255, 0.4)",
            outline: "none",
            resize: "both",
            minWidth: "150px",
            minHeight: "40px",
            padding: "4px",
            margin: 0,
            overflow: "hidden",
            zIndex: 100,
          }}
          autoFocus
          value={editingText.value}
          onChange={(e) => setEditingText({ ...editingText, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (editingText.value.trim()) {
                send({ type: "text", point: editingText.point, text: editingText.value });
              }
              setEditingText(null);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditingText(null);
            }
          }}
          onBlur={() => {
            if (editingText.value.trim()) {
              send({ type: "text", point: editingText.point, text: editingText.value });
            }
            setEditingText(null);
          }}
        />
      ) : null}
    </div>
  );
}

function rectStyle(rect: Rect): CSSProperties {
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height
  };
}
