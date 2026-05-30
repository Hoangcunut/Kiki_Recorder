import { Annotation, Point, Rect } from "../../../shared/types";

export function renderAnnotations(ctx: CanvasRenderingContext2D, annotations: Annotation[]): void {
  for (const annotation of annotations) {
    ctx.save();
    ctx.globalAlpha = annotation.style.opacity;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = annotation.style.color;
    ctx.fillStyle = annotation.style.color;
    ctx.lineWidth = annotation.style.thickness;
    ctx.font = `${annotation.style.italic ? "italic " : ""}${annotation.style.bold ? "700 " : "400 "}${annotation.style.fontSize}px ${annotation.style.fontFamily}`;

    switch (annotation.tool) {
      case "pen":
        drawPath(ctx, annotation.points);
        break;
      case "highlighter":
        ctx.globalAlpha = Math.min(annotation.style.opacity, 0.35);
        ctx.globalCompositeOperation = "source-over";
        ctx.lineWidth = annotation.style.thickness * 3;
        drawPath(ctx, annotation.points);
        break;
      case "line":
        line(ctx, annotation.from, annotation.to);
        break;
      case "arrow":
        arrow(ctx, annotation.from, annotation.to);
        break;
      case "rectangle":
        rect(ctx, annotation.from, annotation.to);
        break;
      case "circle":
        ellipse(ctx, annotation.from, annotation.to);
        break;
      case "text":
        fillMultilineText(ctx, annotation.text, annotation.at.x, annotation.at.y, annotation.style.fontSize + 8);
        break;
      case "marker":
        marker(ctx, annotation.at, annotation.number);
        break;
      case "blur":
        blurRegion(ctx, bounds(annotation.from, annotation.to), false);
        break;
      case "pixelate":
        blurRegion(ctx, bounds(annotation.from, annotation.to), true);
        break;
      case "eraser":
        break;
      default:
        break;
    }
    ctx.restore();
  }
}

export function hitTestAnnotation(annotation: Annotation, point: Point): boolean {
  if ("points" in annotation) {
    return annotation.points.some((candidate) => distance(candidate, point) < Math.max(16, annotation.style.thickness * 2));
  }
  if ("from" in annotation) {
    const box = bounds(annotation.from, annotation.to);
    return point.x >= box.x - 12 && point.x <= box.x + box.width + 12 && point.y >= box.y - 12 && point.y <= box.y + box.height + 12;
  }
  if (annotation.tool === "text") {
    return distance(annotation.at, point) < 80;
  }
  if (annotation.tool === "marker") {
    return distance(annotation.at, point) < 36;
  }
  return false;
}

function drawPath(ctx: CanvasRenderingContext2D, points: Point[]): void {
  if (points.length < 2) {
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function line(ctx: CanvasRenderingContext2D, from: Point, to: Point): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function arrow(ctx: CanvasRenderingContext2D, from: Point, to: Point): void {
  line(ctx, from, to);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = Math.max(18, ctx.lineWidth * 4);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function rect(ctx: CanvasRenderingContext2D, from: Point, to: Point): void {
  const box = bounds(from, to);
  ctx.strokeRect(box.x, box.y, box.width, box.height);
}

function ellipse(ctx: CanvasRenderingContext2D, from: Point, to: Point): void {
  const box = bounds(from, to);
  ctx.beginPath();
  ctx.ellipse(box.x + box.width / 2, box.y + box.height / 2, Math.abs(box.width / 2), Math.abs(box.height / 2), 0, 0, Math.PI * 2);
  ctx.stroke();
}

function marker(ctx: CanvasRenderingContext2D, at: Point, number: number): void {
  const radius = Math.max(18, ctx.lineWidth * 3);
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0f1117";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${radius}px Inter, system-ui, sans-serif`;
  ctx.fillText(String(number), at.x, at.y + 1);
}

function fillMultilineText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, lineHeight: number): void {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    ctx.fillText(lines[i], x, y + i * lineHeight);
  }
}

function blurRegion(ctx: CanvasRenderingContext2D, rect: Rect, pixelate: boolean): void {
  const x = clamp(Math.round(rect.x), 0, ctx.canvas.width);
  const y = clamp(Math.round(rect.y), 0, ctx.canvas.height);
  const right = clamp(Math.round(rect.x + rect.width), 0, ctx.canvas.width);
  const bottom = clamp(Math.round(rect.y + rect.height), 0, ctx.canvas.height);
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);
  if (width < 12 || height < 12) {
    return;
  }

  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) {
    return;
  }

  sourceCtx.drawImage(ctx.canvas, x, y, width, height, 0, 0, width, height);
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const outputCtx = output.getContext("2d");
  if (!outputCtx) {
    return;
  }

  if (pixelate) {
    const scale = 0.08;
    const tiny = document.createElement("canvas");
    tiny.width = Math.max(1, Math.round(width * scale));
    tiny.height = Math.max(1, Math.round(height * scale));
    const tinyCtx = tiny.getContext("2d");
    if (!tinyCtx) {
      return;
    }
    tinyCtx.imageSmoothingEnabled = false;
    tinyCtx.drawImage(source, 0, 0, tiny.width, tiny.height);
    outputCtx.imageSmoothingEnabled = false;
    outputCtx.drawImage(tiny, 0, 0, tiny.width, tiny.height, 0, 0, width, height);
  } else {
    outputCtx.filter = "blur(14px)";
    outputCtx.drawImage(source, 0, 0);
    outputCtx.filter = "none";
  }
  ctx.drawImage(output, x, y);
}

function bounds(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y)
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
