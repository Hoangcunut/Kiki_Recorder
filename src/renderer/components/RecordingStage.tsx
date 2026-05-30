import { useRef } from "react";
import type { CSSProperties } from "react";
import { Annotation, AnnotationStyle, Point, Rect, ToolName } from "../../shared/types";
import { id } from "../lib/id";
import { hitTestAnnotation } from "../lib/annotations/renderAnnotations";
import { useI18n } from "../i18n";

type Props = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  annotations: Annotation[];
  tool: ToolName;
  style: AnnotationStyle;
  markerNumber: number;
  recordingState: string;
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
};

export function RecordingStage({
  canvasRef,
  annotations,
  tool,
  style,
  markerNumber,
  recordingState,
  onPointer,
  onClickPulse,
  onAdd,
  onUpdate,
  onRemove,
  onMarkerUsed,
  areaSelection
}: Props) {
  const activeId = useRef<string | null>(null);
  const areaDragStart = useRef<Point | null>(null);
  const text = useI18n();

  function canvasPoint(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
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
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === "select") {
      return;
    }
    if (tool === "eraser") {
      const target = [...annotations].reverse().find((annotation) => hitTestAnnotation(annotation, point));
      if (target) {
        onRemove(target.id);
      }
      return;
    }
    if (tool === "text") {
      const annotationText = window.prompt(text.textAnnotationPrompt);
      if (annotationText) {
        onAdd({ id: id("text"), tool: "text", at: point, text: annotationText, style });
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
    event.currentTarget.releasePointerCapture(event.pointerId);
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
      {recordingState === "idle" && !areaSelection?.enabled ? (
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isTinyBox(from: Point, to: Point): boolean {
  return Math.abs(to.x - from.x) < 12 || Math.abs(to.y - from.y) < 12;
}
