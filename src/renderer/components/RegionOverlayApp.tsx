import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Check, X } from "lucide-react";
import { DesktopCaptureRegion, Rect } from "../../shared/types";
import { getI18n, LanguageCode } from "../i18n";

const MIN_SIZE = 64;
type DragMode = "new" | "move" | "resize";
type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type DragState = {
  mode: DragMode;
  handle?: ResizeHandle;
  start: { x: number; y: number };
  base?: Rect;
};

type OverlayConfig = {
  displayId: string;
  displayLabel: string;
  displayBounds: Rect;
  scaleFactor: number;
  sourceId?: string;
  sourceName?: string;
  language: LanguageCode;
  initialRect?: Rect;
};

export function RegionOverlayApp() {
  const config = useMemo(parseConfig, []);
  const text = getI18n(config.language);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const [rect, setRect] = useState<Rect | undefined>(config.initialRect);

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    function keyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        void cancel();
      }
      if (event.key === "Enter" && rect) {
        void confirm(rect);
      }
    }

    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, [rect]);

  function point(event: React.PointerEvent): { x: number; y: number } {
    return {
      x: clamp(event.clientX, 0, config.displayBounds.width),
      y: clamp(event.clientY, 0, config.displayBounds.height)
    };
  }

  function startNew(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }
    const start = point(event);
    drag.current = { mode: "new", start };
    setRect({ x: start.x, y: start.y, width: 1, height: 1 });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (!rect || event.button !== 0) {
      return;
    }
    event.stopPropagation();
    drag.current = { mode: "move", start: point(event), base: rect };
    rootRef.current?.setPointerCapture(event.pointerId);
  }

  function startResize(handle: ResizeHandle, event: React.PointerEvent<HTMLButtonElement>): void {
    if (!rect || event.button !== 0) {
      return;
    }
    event.stopPropagation();
    drag.current = { mode: "resize", handle, start: point(event), base: rect };
    rootRef.current?.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const current = drag.current;
    if (!current) {
      return;
    }

    const currentPoint = point(event);
    if (current.mode === "new") {
      setRect(rectFromPoints(current.start, currentPoint, config.displayBounds));
      return;
    }

    const base = current.base;
    if (!base) {
      return;
    }

    if (current.mode === "move") {
      const dx = currentPoint.x - current.start.x;
      const dy = currentPoint.y - current.start.y;
      setRect(clampRect({ ...base, x: base.x + dx, y: base.y + dy }, config.displayBounds));
      return;
    }

    if (current.mode === "resize" && current.handle) {
      const dx = currentPoint.x - current.start.x;
      const dy = currentPoint.y - current.start.y;
      setRect(resizeRect(base, current.handle, dx, dy, config.displayBounds));
    }
  }

  function pointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    if (!drag.current) {
      return;
    }
    drag.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can already be released when the pointer leaves a transparent window.
    }
    if (rect && (rect.width < MIN_SIZE || rect.height < MIN_SIZE)) {
      setRect(clampRect(rect, config.displayBounds));
    }
  }

  async function confirm(activeRect: Rect): Promise<void> {
    const safeRect = clampRect(activeRect, config.displayBounds);
    const region: DesktopCaptureRegion = {
      displayId: config.displayId,
      displayLabel: config.displayLabel,
      sourceId: config.sourceId,
      sourceName: config.sourceName,
      bounds: {
        x: Math.round(config.displayBounds.x + safeRect.x),
        y: Math.round(config.displayBounds.y + safeRect.y),
        width: Math.round(safeRect.width),
        height: Math.round(safeRect.height)
      },
      pixelBounds: {
        x: Math.round(safeRect.x * config.scaleFactor),
        y: Math.round(safeRect.y * config.scaleFactor),
        width: Math.round(safeRect.width * config.scaleFactor),
        height: Math.round(safeRect.height * config.scaleFactor)
      },
      scaleFactor: config.scaleFactor
    };
    await window.kiki.completeRegionSelection(region);
  }

  async function cancel(): Promise<void> {
    await window.kiki.cancelRegionSelection();
  }

  const badge = rect
    ? `${text.regionOverlaySize}: ${Math.round(rect.width * config.scaleFactor)} x ${Math.round(rect.height * config.scaleFactor)} px`
    : text.regionOverlayHint;
  const position = rect
    ? `${text.regionOverlayPosition}: ${Math.round(config.displayBounds.x + rect.x)}, ${Math.round(config.displayBounds.y + rect.y)}`
    : config.displayLabel;

  return (
    <div
      ref={rootRef}
      className="regionOverlay"
      tabIndex={0}
      onPointerDown={startNew}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
    >
      <div className="regionTopBar">
        <strong>{text.regionOverlayTitle}</strong>
        <span>{position}</span>
      </div>

      {rect ? (
        <div className="regionBox" style={rectStyle(rect)} onPointerDown={startMove}>
          <span className="regionBadge">{badge}</span>
          {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as ResizeHandle[]).map((handle) => (
            <button
              key={handle}
              className={`regionHandle ${handle}`}
              aria-label={`${text.regionOverlaySize} ${handle}`}
              onPointerDown={(event) => startResize(handle, event)}
            />
          ))}
        </div>
      ) : null}

      <div className="regionActions" onPointerDown={(event) => event.stopPropagation()}>
        <button className="secondaryButton" onClick={() => void cancel()}>
          <X size={18} />
          {text.regionOverlayCancel}
        </button>
        <button className="primaryButton" disabled={!rect} onClick={() => rect && void confirm(rect)}>
          <Check size={18} />
          {text.regionOverlayStart}
        </button>
      </div>
    </div>
  );
}

function parseConfig(): OverlayConfig {
  const hashQuery = window.location.hash.split("?")[1] ?? "";
  const params = new URLSearchParams(hashQuery);
  const displayWidth = numberParam(params, "displayWidth", window.innerWidth);
  const displayHeight = numberParam(params, "displayHeight", window.innerHeight);
  const language = params.get("language") === "vi" ? "vi" : "en";
  const initialWidth = numberParam(params, "initialWidth", 0);
  const initialHeight = numberParam(params, "initialHeight", 0);
  const initialRect =
    initialWidth >= MIN_SIZE && initialHeight >= MIN_SIZE
      ? clampRect(
          {
            x: numberParam(params, "initialX", 0),
            y: numberParam(params, "initialY", 0),
            width: initialWidth,
            height: initialHeight
          },
          { x: 0, y: 0, width: displayWidth, height: displayHeight }
        )
      : undefined;

  return {
    displayId: params.get("displayId") ?? "0",
    displayLabel: params.get("displayLabel") || "Display",
    displayBounds: {
      x: numberParam(params, "displayX", 0),
      y: numberParam(params, "displayY", 0),
      width: displayWidth,
      height: displayHeight
    },
    scaleFactor: numberParam(params, "scaleFactor", 1),
    sourceId: params.get("sourceId") || undefined,
    sourceName: params.get("sourceName") || undefined,
    language,
    initialRect
  };
}

function numberParam(params: URLSearchParams, key: string, fallback: number): number {
  const value = Number(params.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function rectFromPoints(from: { x: number; y: number }, to: { x: number; y: number }, bounds: Rect): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const right = Math.max(from.x, to.x);
  const bottom = Math.max(from.y, to.y);
  return clampRect({ x, y, width: right - x, height: bottom - y }, bounds);
}

function resizeRect(base: Rect, handle: ResizeHandle, dx: number, dy: number, bounds: Rect): Rect {
  let left = base.x;
  let top = base.y;
  let right = base.x + base.width;
  let bottom = base.y + base.height;

  if (handle.includes("w")) {
    left = clamp(base.x + dx, 0, right - MIN_SIZE);
  }
  if (handle.includes("e")) {
    right = clamp(base.x + base.width + dx, left + MIN_SIZE, bounds.width);
  }
  if (handle.includes("n")) {
    top = clamp(base.y + dy, 0, bottom - MIN_SIZE);
  }
  if (handle.includes("s")) {
    bottom = clamp(base.y + base.height + dy, top + MIN_SIZE, bounds.height);
  }

  return clampRect({ x: left, y: top, width: right - left, height: bottom - top }, bounds);
}

function clampRect(rect: Rect, bounds: Rect): Rect {
  const width = Math.min(bounds.width, Math.max(MIN_SIZE, rect.width));
  const height = Math.min(bounds.height, Math.max(MIN_SIZE, rect.height));
  return {
    x: Math.round(clamp(rect.x, 0, bounds.width - width)),
    y: Math.round(clamp(rect.y, 0, bounds.height - height)),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function rectStyle(rect: Rect): CSSProperties {
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
