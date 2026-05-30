import { Annotation, Point, RecordingSettings, Rect } from "../../../shared/types";
import { renderAnnotations } from "../annotations/renderAnnotations";

type ClickPulse = Point & { startedAt: number };

export class CanvasCompositor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private settings: RecordingSettings;
  private annotations: () => Annotation[];
  private sourceVideo = document.createElement("video");
  private webcamVideo = document.createElement("video");
  private raf = 0;
  private running = false;
  private pointer: Point = { x: 0, y: 0 };
  private clicks: ClickPulse[] = [];
  private currentZoom = 1;

  constructor(
    canvas: HTMLCanvasElement,
    sourceStream: MediaStream,
    webcamStream: MediaStream | undefined,
    settings: RecordingSettings,
    annotations: () => Annotation[]
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("Canvas 2D context is unavailable");
    }
    this.canvas = canvas;
    this.ctx = ctx;
    this.settings = settings;
    this.annotations = annotations;
    this.sourceVideo.muted = true;
    this.sourceVideo.playsInline = true;
    this.sourceVideo.srcObject = sourceStream;
    this.webcamVideo.muted = true;
    this.webcamVideo.playsInline = true;
    if (webcamStream) {
      this.webcamVideo.srcObject = webcamStream;
    }
  }

  async start(): Promise<MediaStream> {
    await this.sourceVideo.play();
    if (this.webcamVideo.srcObject) {
      await this.webcamVideo.play();
    }

    const track = (this.sourceVideo.srcObject as MediaStream).getVideoTracks()[0];
    const trackSettings = track.getSettings();
    const targetWidth = this.settings.quality.width ?? trackSettings.width ?? 1920;
    const targetHeight = this.settings.quality.height ?? trackSettings.height ?? 1080;
    this.canvas.width = even(Math.round(targetWidth));
    this.canvas.height = even(Math.round(targetHeight));
    this.running = true;
    this.draw();
    return this.canvas.captureStream(this.settings.quality.fps);
  }

  updateSettings(settings: RecordingSettings): void {
    this.settings = settings;
  }

  setPointer(point: Point): void {
    this.pointer = point;
  }

  addClick(point: Point): void {
    this.clicks.push({ ...point, startedAt: performance.now() });
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private draw = (): void => {
    if (!this.running) {
      return;
    }

    const { ctx, canvas } = this;
    ctx.save();
    ctx.fillStyle = "#05070b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const crop = sourceCrop(this.sourceVideo, this.settings.mode === "area" ? this.settings.captureArea : undefined);
    this.currentZoom = smoothZoom(this.currentZoom, this.settings.zoom);
    drawCover(ctx, this.sourceVideo, crop, { x: 0, y: 0, width: canvas.width, height: canvas.height }, this.currentZoom, this.pointer);
    this.drawSpotlight();
    this.drawWebcam();
    renderAnnotations(ctx, this.annotations());
    if (this.settings.highlightClicks) {
      this.drawClicks();
    }
    ctx.restore();

    this.raf = requestAnimationFrame(this.draw);
  };

  private drawSpotlight(): void {
    if (!this.settings.spotlight) {
      return;
    }
    const { ctx, canvas, pointer } = this;
    const gradient = ctx.createRadialGradient(pointer.x, pointer.y, 80, pointer.x, pointer.y, 280);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.62, "rgba(0,0,0,0.12)");
    gradient.addColorStop(1, "rgba(0,0,0,0.68)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  private drawWebcam(): void {
    if (!this.webcamVideo.srcObject || !this.settings.webcam.enabled || this.settings.webcam.webcamOnly) {
      return;
    }
    const { ctx, canvas } = this;
    const rect = normalizedRect(this.settings.webcam.position, canvas.width, canvas.height);
    ctx.save();
    ctx.globalAlpha = this.settings.webcam.opacity;
    pathForShape(ctx, rect, this.settings.webcam.shape);
    ctx.clip();
    if (this.settings.webcam.backgroundEffect === "virtual") {
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.fillStyle = "rgba(45,212,191,0.22)";
      ctx.fillRect(rect.x, rect.y + rect.height * 0.58, rect.width, rect.height * 0.42);
    }
    if (this.settings.webcam.backgroundEffect === "blur") {
      ctx.filter = "blur(18px)";
      drawCover(ctx, this.webcamVideo, videoRect(this.webcamVideo), inflate(rect, 18), 1, this.pointer);
      ctx.filter = "none";
    }
    drawCover(ctx, this.webcamVideo, videoRect(this.webcamVideo), rect, 1, this.pointer);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.68)";
    ctx.lineWidth = 4;
    pathForShape(ctx, rect, this.settings.webcam.shape);
    ctx.stroke();
    ctx.restore();
  }

  private drawClicks(): void {
    const now = performance.now();
    this.clicks = this.clicks.filter((click) => now - click.startedAt < 650);
    for (const click of this.clicks) {
      const age = (now - click.startedAt) / 650;
      const radius = 20 + age * 54;
      this.ctx.beginPath();
      this.ctx.strokeStyle = colorWithAlpha(this.settings.cursorColor, 1 - age);
      this.ctx.lineWidth = 7 * (1 - age);
      this.ctx.arc(click.x, click.y, radius, 0, Math.PI * 2);
      this.ctx.stroke();
    }
  }

}

function sourceCrop(video: HTMLVideoElement, area?: Rect): Rect {
  const width = video.videoWidth || 1920;
  const height = video.videoHeight || 1080;
  if (!area || area.width <= 0 || area.height <= 0) {
    return { x: 0, y: 0, width, height };
  }
  const x = Math.max(0, Math.min(width - 1, area.x));
  const y = Math.max(0, Math.min(height - 1, area.y));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, area.width)),
    height: Math.max(1, Math.min(height - y, area.height))
  };
}

function videoRect(video: HTMLVideoElement): Rect {
  return { x: 0, y: 0, width: video.videoWidth || 1280, height: video.videoHeight || 720 };
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  source: Rect,
  dest: Rect,
  zoom: number,
  pointer: Point
): void {
  const safeZoom = Math.max(1, Math.min(4, zoom || 1));
  const focusX = source.x + (pointer.x / Math.max(1, ctx.canvas.width)) * source.width;
  const focusY = source.y + (pointer.y / Math.max(1, ctx.canvas.height)) * source.height;
  const zoomedWidth = source.width / safeZoom;
  const zoomedHeight = source.height / safeZoom;
  const sx = clamp(focusX - zoomedWidth / 2, source.x, source.x + source.width - zoomedWidth);
  const sy = clamp(focusY - zoomedHeight / 2, source.y, source.y + source.height - zoomedHeight);
  ctx.drawImage(video, sx, sy, zoomedWidth, zoomedHeight, dest.x, dest.y, dest.width, dest.height);
}

function normalizedRect(rect: Rect, width: number, height: number): Rect {
  return {
    x: rect.x <= 1 ? rect.x * width : rect.x,
    y: rect.y <= 1 ? rect.y * height : rect.y,
    width: rect.width <= 1 ? rect.width * width : rect.width,
    height: rect.height <= 1 ? rect.height * height : rect.height
  };
}

function pathForShape(ctx: CanvasRenderingContext2D, rect: Rect, shape: string): void {
  ctx.beginPath();
  if (shape === "circle") {
    const radius = Math.min(rect.width, rect.height) / 2;
    ctx.arc(rect.x + rect.width / 2, rect.y + rect.height / 2, radius, 0, Math.PI * 2);
    return;
  }
  roundRect(ctx, rect.x, rect.y, rect.width, rect.height, 18);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function inflate(rect: Rect, amount: number): Rect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2
  };
}

function colorWithAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const value = parseInt(normalized.length === 3 ? normalized.split("").map((c) => c + c).join("") : normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function even(value: number): number {
  return value % 2 === 0 ? value : value + 1;
}

function smoothZoom(current: number, target: number): number {
  const safeTarget = Math.max(1, Math.min(4, target || 1));
  const next = current + (safeTarget - current) * 0.18;
  return Math.abs(next - safeTarget) < 0.01 ? safeTarget : next;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
