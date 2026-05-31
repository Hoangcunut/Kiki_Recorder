import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Annotation, AnnotationStyle, Point, Rect, ToolName, WebcamShape } from "../../shared/types";
import { id } from "../lib/id";
import { hitTestAnnotation } from "../lib/annotations/renderAnnotations";
import { useI18n } from "../i18n";

type WebcamResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";
type WebcamDragState = {
  mode: "move" | "resize";
  handle?: WebcamResizeHandle;
  start: Point;
  origin: Rect;
};

type Props = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  annotations: Annotation[];
  tool: ToolName;
  style: AnnotationStyle;
  markerNumber: number;
  recordingState: string;
  previewActive: boolean;
  onPointer: (point: Point) => void;
  onClickPulse: (point: Point) => void;
  onAdd: (annotation: Annotation) => void;
  onUpdate: (annotation: Annotation) => void;
  onRemove: (id: string) => void;
  onMarkerUsed: () => void;
  areaSelection?: {
    enabled: boolean;
    sourceSize: { width: number; height: number };
    value?: Rect;
    onChange: (rect: Rect) => void;
  };
  webcamOverlay?: {
    enabled: boolean;
    position: Rect;
    shape: WebcamShape;
    onMove: (position: Rect) => void;
  };
};

export function RecordingStage({
  canvasRef,
  annotations,
  tool,
  style,
  markerNumber,
  recordingState,
  previewActive,
  onPointer,
  onClickPulse,
  onAdd,
  onUpdate,
  onRemove,
  onMarkerUsed,
  areaSelection,
  webcamOverlay
}: Props) {
  const activeId = useRef<string | null>(null);
  const areaDragStart = useRef<Point | null>(null);
  const textMove = useRef<{ id: string; start: Point; origin: Point } | null>(null);
  const webcamDrag = useRef<WebcamDragState | null>(null);
  const textEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const [editingText, setEditingText] = useState<{ point: Point; value: string } | null>(null);
  const text = useI18n();

  useEffect(() => {
    if (!editingText) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      textEditorRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingText?.point.x, editingText?.point.y]);

  function canvasPoint(event: React.PointerEvent<HTMLCanvasElement>): Point {
    return canvasPointFromClient(event.clientX, event.clientY);
  }

  function canvasPointFromClient(clientX: number, clientY: number): Point {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
      t: performance.now()
    };
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (areaSelection?.enabled) {
      return;
    }
    const point = canvasPoint(event);
    onPointer(point);
    onClickPulse(point);

    if (tool === "text") {
      setEditingText({ point, value: "" });
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === "select") {
      const target = [...annotations].reverse().find((annotation) => annotation.tool === "text" && hitTestAnnotation(annotation, point));
      if (target?.tool === "text") {
        textMove.current = { id: target.id, start: point, origin: target.at };
      }
      return;
    }
    if (tool === "eraser") {
      const target = [...annotations].reverse().find((annotation) => hitTestAnnotation(annotation, point));
      if (target) {
        onRemove(target.id);
      }
      return;
    }
    if (tool === "marker") {
      onAdd({ id: id("marker"), tool: "marker", at: point, number: markerNumber, style });
      onMarkerUsed();
      return;
    }
    if (tool === "pen" || tool === "highlighter") {
      const annotation: Annotation = { id: id(tool), tool, points: [point], style };
      activeId.current = annotation.id;
      onAdd(annotation);
      return;
    }
    if (tool === "line" || tool === "arrow" || tool === "rectangle" || tool === "circle" || tool === "blur" || tool === "pixelate") {
      const annotation: Annotation = { id: id(tool), tool, from: point, to: point, style };
      activeId.current = annotation.id;
      onAdd(annotation);
    }
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (areaSelection?.enabled) {
      return;
    }
    const point = canvasPoint(event);
    onPointer(point);
    const movingText = textMove.current;
    if (movingText) {
      const existing = annotations.find((annotation) => annotation.id === movingText.id);
      if (existing?.tool === "text") {
        const canvas = canvasRef.current;
        const maxX = canvas?.width ?? Number.POSITIVE_INFINITY;
        const maxY = canvas?.height ?? Number.POSITIVE_INFINITY;
        onUpdate({
          ...existing,
          at: {
            x: clamp(movingText.origin.x + point.x - movingText.start.x, 0, maxX),
            y: clamp(movingText.origin.y + point.y - movingText.start.y, 0, maxY),
            t: performance.now()
          }
        });
      }
      return;
    }
    const currentId = activeId.current;
    if (!currentId) {
      return;
    }
    const existing = annotations.find((annotation) => annotation.id === currentId);
    if (!existing) {
      return;
    }
    if ("points" in existing) {
      onUpdate({ ...existing, points: [...existing.points, point] });
    } else if ("from" in existing) {
      onUpdate({ ...existing, to: point });
    }
  }

  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>): void {
    const currentId = activeId.current;
    if (currentId) {
      const existing = annotations.find((annotation) => annotation.id === currentId);
      if (existing && (existing.tool === "blur" || existing.tool === "pixelate") && isTinyBox(existing.from, existing.to)) {
        onRemove(existing.id);
      }
    }
    activeId.current = null;
    textMove.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function webcamPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (!webcamOverlay?.enabled || tool !== "select" || areaSelection?.enabled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const handle = (event.target as HTMLElement).dataset.webcamHandle as WebcamResizeHandle | undefined;
    webcamDrag.current = {
      mode: handle ? "resize" : "move",
      handle,
      start: canvasPointFromClient(event.clientX, event.clientY),
      origin: positionToNormalized(webcamOverlay.position, canvas.width, canvas.height)
    };
  }

  function webcamPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = webcamDrag.current;
    if (!drag || !webcamOverlay?.enabled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const point = canvasPointFromClient(event.clientX, event.clientY);
    const dx = (point.x - drag.start.x) / Math.max(1, canvas.width);
    const dy = (point.y - drag.start.y) / Math.max(1, canvas.height);
    const next =
      drag.mode === "resize" && drag.handle
        ? resizeWebcamRect(drag.origin, drag.handle, dx, dy)
        : moveWebcamRect(drag.origin, dx, dy);
    webcamOverlay.onMove(next);
  }

  function webcamPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    if (!webcamDrag.current) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    webcamDrag.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The platform can release pointer capture first.
    }
  }

  function areaPoint(event: React.PointerEvent<HTMLDivElement>): Point {
    if (!areaSelection) {
      return { x: 0, y: 0 };
    }
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * areaSelection.sourceSize.width, 0, areaSelection.sourceSize.width),
      y: clamp(((event.clientY - rect.top) / rect.height) * areaSelection.sourceSize.height, 0, areaSelection.sourceSize.height),
      t: performance.now()
    };
  }

  function areaPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (!areaSelection?.enabled) {
      return;
    }
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = areaPoint(event);
    areaDragStart.current = point;
    areaSelection.onChange({ x: Math.round(point.x), y: Math.round(point.y), width: 1, height: 1 });
  }

  function areaPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (!areaSelection?.enabled || !areaDragStart.current) {
      return;
    }
    event.stopPropagation();
    areaSelection.onChange(rectFromPoints(areaDragStart.current, areaPoint(event), areaSelection.sourceSize));
  }

  function areaPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    if (!areaSelection?.enabled) {
      return;
    }
    event.stopPropagation();
    areaDragStart.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const areaStyle = areaSelection?.value ? rectStyle(areaSelection.value, areaSelection.sourceSize) : undefined;
  const areaLabel = areaSelection?.value
    ? `${text.selectedArea}: ${Math.round(areaSelection.value.width)} x ${Math.round(areaSelection.value.height)}`
    : "";
  const webcamStyle = webcamOverlay?.enabled
    ? webcamRectStyle(webcamOverlay.position, canvasRef.current?.width ?? 1920, canvasRef.current?.height ?? 1080)
    : undefined;
  const webcamCanDrag = webcamOverlay?.enabled && tool === "select" && !areaSelection?.enabled;
  const editingTextStyle = editingText
    ? textEditorStyle(editingText.point, style, canvasRef.current)
    : undefined;

  function commitEditingText(): void {
    const value = editingText?.value.trim();
    if (editingText && value) {
      onAdd({ id: id("text"), tool: "text", at: editingText.point, text: value, style });
    }
    setEditingText(null);
  }

  return (
    <div className="stageShell">
      <canvas
        ref={canvasRef}
        className="recordingCanvas"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
      />
      {recordingState === "idle" && !previewActive && !areaSelection?.enabled ? (
        <div className="emptyStage">
          <strong>{text.readyToRecord}</strong>
          <span>{text.readyToRecordHint}</span>
        </div>
      ) : null}
      {areaSelection?.enabled ? (
        <div
          className="areaPickerLayer"
          onPointerDown={areaPointerDown}
          onPointerMove={areaPointerMove}
          onPointerUp={areaPointerUp}
          onPointerCancel={areaPointerUp}
        >
          <div className="areaHint">{text.dragToSelectArea}</div>
          {areaStyle ? (
            <div className="areaSelectionBox" style={areaStyle}>
              <span className="areaSizeBadge">{areaLabel}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {webcamOverlay?.enabled && webcamStyle ? (
        <div
          className={`webcamDragFrame ${webcamOverlay.shape === "circle" ? "circle" : "rectangle"} ${webcamCanDrag ? "enabled" : ""}`}
          style={{
            ...webcamStyle,
            pointerEvents: webcamCanDrag ? "auto" : "none"
          }}
          title={text.dragWebcamOverlay}
          onPointerDown={webcamPointerDown}
          onPointerMove={webcamPointerMove}
          onPointerUp={webcamPointerUp}
          onPointerCancel={webcamPointerUp}
        >
          {webcamCanDrag ? (
            <>
              {(["n", "e", "s", "w", "ne", "nw", "se", "sw"] as WebcamResizeHandle[]).map((handle) => (
                <i key={handle} className={`webcamResizeHandle ${handle}`} data-webcam-handle={handle} />
              ))}
            </>
          ) : null}
          <span>{text.webcam}</span>
        </div>
      ) : null}
      {editingText && editingTextStyle ? (
        <textarea
          ref={textEditorRef}
          className="previewTextEditor"
          style={editingTextStyle}
          value={editingText.value}
          placeholder={text.textAnnotationPrompt}
          onChange={(event) => setEditingText({ ...editingText, value: event.target.value })}
          onBlur={commitEditingText}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              commitEditingText();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setEditingText(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function rectFromPoints(from: Point, to: Point, size: { width: number; height: number }): Rect {
  const x = clamp(Math.min(from.x, to.x), 0, size.width);
  const y = clamp(Math.min(from.y, to.y), 0, size.height);
  const right = clamp(Math.max(from.x, to.x), 0, size.width);
  const bottom = clamp(Math.max(from.y, to.y), 0, size.height);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(right - x)),
    height: Math.max(1, Math.round(bottom - y))
  };
}

function rectStyle(rect: Rect, size: { width: number; height: number }): CSSProperties {
  return {
    left: `${(rect.x / size.width) * 100}%`,
    top: `${(rect.y / size.height) * 100}%`,
    width: `${(rect.width / size.width) * 100}%`,
    height: `${(rect.height / size.height) * 100}%`
  };
}

function webcamRectStyle(rect: Rect, canvasWidth: number, canvasHeight: number): CSSProperties {
  const normalized = positionToNormalized(rect, canvasWidth, canvasHeight);
  return {
    left: `${normalized.x * 100}%`,
    top: `${normalized.y * 100}%`,
    width: `${normalized.width * 100}%`,
    height: `${normalized.height * 100}%`
  };
}

function textEditorStyle(point: Point, style: AnnotationStyle, canvas: HTMLCanvasElement | null): CSSProperties | undefined {
  if (!canvas) {
    return undefined;
  }
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width / Math.max(1, canvas.width);
  return {
    left: `${(point.x / Math.max(1, canvas.width)) * 100}%`,
    top: `${(point.y / Math.max(1, canvas.height)) * 100}%`,
    minWidth: "180px",
    minHeight: "44px",
    fontFamily: style.fontFamily,
    fontSize: `${Math.max(13, style.fontSize * scale)}px`,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    color: style.color,
    opacity: style.opacity
  };
}

function positionToNormalized(rect: Rect, canvasWidth: number, canvasHeight: number): Rect {
  const width = rect.width <= 1 ? rect.width : rect.width / Math.max(1, canvasWidth);
  const height = rect.height <= 1 ? rect.height : rect.height / Math.max(1, canvasHeight);
  const safeWidth = clamp(width, 0.05, 1);
  const safeHeight = clamp(height, 0.05, 1);
  const x = rect.x <= 1 ? rect.x : rect.x / Math.max(1, canvasWidth);
  const y = rect.y <= 1 ? rect.y : rect.y / Math.max(1, canvasHeight);
  return {
    x: clamp(x, 0, 1 - safeWidth),
    y: clamp(y, 0, 1 - safeHeight),
    width: safeWidth,
    height: safeHeight
  };
}

function moveWebcamRect(origin: Rect, dx: number, dy: number): Rect {
  const width = clamp(origin.width, 0.05, 1);
  const height = clamp(origin.height, 0.05, 1);
  return {
    ...origin,
    width,
    height,
    x: clamp(origin.x + dx, 0, 1 - width),
    y: clamp(origin.y + dy, 0, 1 - height)
  };
}

function resizeWebcamRect(origin: Rect, handle: WebcamResizeHandle, dx: number, dy: number): Rect {
  const minSize = 0.05;
  let x = origin.x;
  let y = origin.y;
  let width = origin.width;
  let height = origin.height;

  if (handle.includes("e")) {
    width = clamp(origin.width + dx, minSize, 1 - origin.x);
  }
  if (handle.includes("s")) {
    height = clamp(origin.height + dy, minSize, 1 - origin.y);
  }
  if (handle.includes("w")) {
    const right = origin.x + origin.width;
    x = clamp(origin.x + dx, 0, right - minSize);
    width = right - x;
  }
  if (handle.includes("n")) {
    const bottom = origin.y + origin.height;
    y = clamp(origin.y + dy, 0, bottom - minSize);
    height = bottom - y;
  }

  return {
    x: clamp(x, 0, 1 - width),
    y: clamp(y, 0, 1 - height),
    width: clamp(width, minSize, 1 - x),
    height: clamp(height, minSize, 1 - y)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isTinyBox(from: Point, to: Point): boolean {
  return Math.abs(to.x - from.x) < 12 || Math.abs(to.y - from.y) < 12;
}
