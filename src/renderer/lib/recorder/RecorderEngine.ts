import {
  Annotation,
  LibraryItem,
  RecordingMetadata,
  RecordingSettings,
  SaveRecordingRequest
} from "../../../shared/types";
import { AudioMixer } from "../media/AudioMixer";
import { CanvasCompositor } from "./CanvasCompositor";

export type RecorderState = "idle" | "recording" | "paused" | "saving";

export class RecorderEngine {
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private compositor?: CanvasCompositor;
  private audioMixer = new AudioMixer();
  private streams: MediaStream[] = [];
  private startedAt = 0;
  private settings?: RecordingSettings;
  private canvas?: HTMLCanvasElement;
  private pipeActive = false;
  private pipeOutputPath?: string;

  get state(): RecorderState {
    if (!this.recorder) {
      return "idle";
    }
    return this.recorder.state === "paused" ? "paused" : "recording";
  }

  async start(
    canvas: HTMLCanvasElement,
    settings: RecordingSettings,
    annotations: () => Annotation[],
    onState: (state: RecorderState) => void,
    startPaused = false
  ): Promise<void> {
    this.canvas = canvas;
    this.settings = settings;
    let sourceStream: MediaStream;
    let webcamStream: MediaStream | undefined;
    if (settings.mode === "webcam") {
      webcamStream = await this.getWebcamStream(settings);
      if (!webcamStream) {
        throw new Error("No webcam stream available");
      }
      sourceStream = webcamStream;
    } else {
      sourceStream = await this.getSourceStream(settings);
      webcamStream = await this.getWebcamStream(settings);
    }
    const audioStream = await this.audioMixer.build(sourceStream, settings.audio);
    const activeSource = settings.mode === "webcam" && webcamStream ? webcamStream : sourceStream;

    this.streams.push(sourceStream, audioStream);
    if (webcamStream && webcamStream !== sourceStream) {
      this.streams.push(webcamStream);
    }

    this.compositor = new CanvasCompositor(canvas, activeSource, settings.mode === "webcam" ? undefined : webcamStream, settings, annotations);
    const canvasStream = await this.compositor.start();
    const mixed = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioStream.getAudioTracks()
    ]);

    // Start ffmpeg pipe if MP4 output is desired
    const wantMp4 = (settings.outputFormat ?? "mp4") === "mp4";
    if (wantMp4) {
      try {
        const sourceName = settings.sourceName || labelForMode(settings.mode);
        const result = await window.kiki.startRecordingPipe({
          fileName: `${sourceName} ${new Date().toLocaleString().replace(/[/:]/g, "-")}`,
          fps: settings.quality.fps
        });
        this.pipeActive = true;
        this.pipeOutputPath = result.outputPath;
      } catch (err) {
        console.warn("Failed to start ffmpeg pipe, falling back to WebM:", err);
        this.pipeActive = false;
      }
    } else {
      this.pipeActive = false;
    }

    const mimeType = chooseMimeType();
    this.recorder = new MediaRecorder(mixed, {
      mimeType,
      videoBitsPerSecond: settings.quality.videoBitsPerSecond,
      audioBitsPerSecond: 192_000
    });
    this.chunks = [];
    this.recorder.ondataavailable = async (event) => {
      if (event.data.size > 0) {
        // Always store chunks as fallback
        this.chunks.push(event.data);
        if (this.pipeActive) {
          // Also stream chunk to ffmpeg in real-time
          try {
            const buffer = await event.data.arrayBuffer();
            window.kiki.writeRecordingChunk(buffer);
          } catch (err) {
            console.warn("Failed to write chunk to pipe:", err);
          }
        }
      }
    };
    this.recorder.onpause = () => onState("paused");
    this.recorder.onresume = () => onState("recording");
    this.recorder.onstart = () => onState("recording");
    this.startedAt = Date.now();
    this.recorder.start(1000);
    if (startPaused && this.recorder.state === "recording") {
      this.recorder.pause();
    }
  }

  pause(): void {
    if (this.recorder?.state === "recording") {
      this.recorder.pause();
    }
  }

  resume(): void {
    if (this.recorder?.state === "paused") {
      this.recorder.resume();
    }
  }

  async stop(): Promise<LibraryItem | undefined> {
    if (!this.recorder || !this.settings) {
      return undefined;
    }
    const recorder = this.recorder;
    const settings = this.settings;
    const stoppedAt = Date.now();
    try {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        if (recorder.state !== "inactive") {
          try {
            if (recorder.state === "paused") {
              recorder.resume();
            }
            recorder.requestData();
          } catch {
            // Some platforms reject requestData while a stop is already pending.
          }
          recorder.stop();
        } else {
          resolve();
        }
      });

      this.compositor?.stop();

      const metadata: RecordingMetadata = {
        title: `${settings.sourceName || labelForMode(settings.mode)} ${new Date(this.startedAt).toLocaleString()}`,
        mode: settings.mode,
        sourceName: settings.sourceName,
        durationMs: Math.max(0, stoppedAt - this.startedAt),
        width: this.canvas?.width ?? settings.quality.width ?? 1920,
        height: this.canvas?.height ?? settings.quality.height ?? 1080,
        fps: settings.quality.fps,
        startedAt: new Date(this.startedAt).toISOString(),
        endedAt: new Date(stoppedAt).toISOString()
      };

      // Try pipe mode first (MP4)
      if (this.pipeActive) {
        this.pipeActive = false;
        try {
          const result = await window.kiki.finishRecordingPipe();
          if (result && result.outputPath) {
            const request: SaveRecordingRequest = {
              fileName: metadata.title,
              extension: "mp4",
              outputFormat: "mp4",
              data: new ArrayBuffer(0),
              metadata,
              pipePath: result.outputPath
            };
            return await window.kiki.saveRecording(request);
          }
        } catch (pipeErr) {
          console.warn("Pipe finish failed, falling back to WebM:", pipeErr);
        }
        // Pipe failed — cancel and fall through to WebM save
        try { await window.kiki.cancelRecordingPipe(); } catch { /* ignore */ }
      }

      // Fallback: save as WebM from in-memory chunks
      if (this.chunks.length === 0) {
        throw new Error("Recording stopped, but no video data was produced. Try recording for a little longer or select a different source.");
      }
      const blob = new Blob(this.chunks, { type: recorder.mimeType || "video/webm" });
      const data = await blob.arrayBuffer();

      const request: SaveRecordingRequest = {
        fileName: metadata.title,
        extension: "webm",
        outputFormat: "webm",
        data,
        metadata
      };
      return await window.kiki.saveRecording(request);
    } finally {
      this.cleanup();
    }
  }

  restart(): void {
    this.cleanup();
  }

  async discard(): Promise<void> {
    const recorder = this.recorder;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
    }
    this.cleanup();
  }

  resetClock(): void {
    this.startedAt = Date.now();
  }

  updateSettings(settings: RecordingSettings): void {
    this.settings = settings;
    this.compositor?.updateSettings(settings);
  }

  setPointer(point: { x: number; y: number }): void {
    this.compositor?.setPointer(point);
  }

  addClick(point: { x: number; y: number }): void {
    this.compositor?.addClick(point);
  }

  setSystemMuted(muted: boolean): boolean {
    return this.audioMixer.setSystemMuted(muted);
  }

  async setMicMuted(muted: boolean, settings: RecordingSettings): Promise<boolean> {
    if (!muted) {
      const enabled = await this.audioMixer.enableMicrophone(settings.audio);
      if (!enabled) {
        return false;
      }
    }
    return this.audioMixer.setMicMuted(muted, settings.audio.gain);
  }

  async saveScreenshot(
    fileName = "Screenshot",
    settings?: RecordingSettings,
    annotations: () => Annotation[] = () => []
  ): Promise<void> {
    if (!this.canvas) {
      throw new Error("No active preview is available for screenshot capture");
    }
    if (!this.recorder && settings) {
      await this.captureStill(this.canvas, settings, annotations);
    }
    await window.kiki.saveScreenshot({
      fileName,
      dataUrl: this.canvas.toDataURL("image/png"),
      width: this.canvas.width,
      height: this.canvas.height
    });
  }

  cleanup(): void {
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        // The recorder can already be stopping when cleanup is called.
      }
    }
    if (this.pipeActive) {
      this.pipeActive = false;
      void window.kiki.cancelRecordingPipe();
    }
    this.compositor?.stop();
    this.audioMixer.dispose();
    for (const stream of this.streams) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    this.streams = [];
    this.recorder = undefined;
    this.chunks = [];
  }

  private async getSourceStream(settings: RecordingSettings): Promise<MediaStream> {
    if (settings.mode === "webcam") {
      const webcam = await this.getWebcamStream(settings);
      if (!webcam) {
        throw new Error("No webcam stream available");
      }
      return webcam;
    }

    try {
      return await this.getDisplayMediaStream(settings, settings.audio.system);
    } catch (displayMediaError) {
      if (settings.sourceId && settings.audio.system && settings.mode !== "browser-tab") {
        try {
          return await this.getDisplayMediaStream(settings, false);
        } catch {
          // Continue into the legacy diagnostic path below with the original error.
        }
      }
      if (settings.sourceId && settings.mode !== "browser-tab") {
        try {
          const legacyStream = await navigator.mediaDevices.getUserMedia({
            audio: settings.audio.system
              ? ({
                  mandatory: {
                    chromeMediaSource: "desktop"
                  }
                } as MediaTrackConstraints)
              : false,
            video: {
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: settings.sourceId,
                maxFrameRate: settings.quality.fps
              }
            } as MediaTrackConstraints
          });
          if (legacyStream.getVideoTracks().length === 0) {
            throw new Error("Legacy desktop capture returned no video track.");
          }
          return legacyStream;
        } catch (legacyError) {
          throw screenCaptureError(displayMediaError, legacyError);
        }
      }
      throw screenCaptureError(displayMediaError);
    }
  }

  private async getDisplayMediaStream(settings: RecordingSettings, systemAudio: boolean): Promise<MediaStream> {
    await window.kiki.prepareCapture({
      sourceId: settings.sourceId,
      systemAudio,
      useSystemPicker: settings.mode === "browser-tab"
    });
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: systemAudio,
      video: {
        frameRate: settings.quality.fps,
        width: settings.quality.width,
        height: settings.quality.height,
        displaySurface: settings.mode === "window" ? "window" : settings.mode === "browser-tab" ? "browser" : "monitor"
      },
      preferCurrentTab: false,
      selfBrowserSurface: "exclude",
      systemAudio: systemAudio ? "include" : "exclude",
      surfaceSwitching: "include"
    } as DisplayMediaStreamOptions);

    if (stream.getVideoTracks().length === 0) {
      throw new Error("The selected source did not return a video track.");
    }
    return stream;
  }

  private async captureStill(
    canvas: HTMLCanvasElement,
    settings: RecordingSettings,
    annotations: () => Annotation[]
  ): Promise<void> {
    const stillSettings: RecordingSettings = {
      ...settings,
      audio: {
        ...settings.audio,
        system: false,
        microphone: false
      }
    };
    let sourceStream: MediaStream | undefined;
    let webcamStream: MediaStream | undefined;
    let compositor: CanvasCompositor | undefined;
    try {
      if (stillSettings.mode === "webcam") {
        webcamStream = await this.getWebcamStream(stillSettings);
        if (!webcamStream) {
          throw new Error("No webcam stream available");
        }
        sourceStream = webcamStream;
      } else {
        sourceStream = await this.getSourceStream(stillSettings);
        webcamStream = await this.getWebcamStream(stillSettings);
      }
      compositor = new CanvasCompositor(canvas, sourceStream, stillSettings.mode === "webcam" ? undefined : webcamStream, stillSettings, annotations);
      await compositor.start();
      await new Promise((resolve) => window.setTimeout(resolve, 450));
    } finally {
      compositor?.stop();
      sourceStream?.getTracks().forEach((track) => track.stop());
      if (webcamStream && webcamStream !== sourceStream) {
        webcamStream.getTracks().forEach((track) => track.stop());
      }
    }
  }

  private async getWebcamStream(settings: RecordingSettings): Promise<MediaStream | undefined> {
    if (!settings.webcam.enabled && settings.mode !== "webcam") {
      return undefined;
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: webcamConstraints(settings, true),
        audio: false
      });
    } catch (error) {
      if (!settings.webcam.deviceId) {
        throw error;
      }
      console.warn("Selected webcam is unavailable; falling back to the system default camera.", error);
      return navigator.mediaDevices.getUserMedia({
        video: webcamConstraints(settings, false),
        audio: false
      });
    }
  }
}

function chooseMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function labelForMode(mode: RecordingSettings["mode"]): string {
  switch (mode) {
    case "fullscreen":
      return "Full screen";
    case "area":
      return "Area";
    case "window":
      return "Window";
    case "browser-tab":
      return "Browser tab";
    case "webcam":
      return "Webcam";
    default:
      return "Recording";
  }
}

function webcamConstraints(settings: RecordingSettings, includeDevice: boolean): MediaTrackConstraints {
  return {
    deviceId: includeDevice && settings.webcam.deviceId ? { exact: settings.webcam.deviceId } : undefined,
    width: { ideal: 1280 },
    height: { ideal: 720 }
  };
}

function screenCaptureError(primary: unknown, fallback?: unknown): Error {
  const primaryMessage = describeError(primary);
  const fallbackMessage = fallback ? ` Fallback failed: ${describeError(fallback)}` : "";
  return new Error(
    `Screen capture failed: ${primaryMessage}.${fallbackMessage} Check screen-recording permission and try selecting the source again.`
  );
}

function describeError(cause: unknown): string {
  if (cause instanceof Error) {
    return `${cause.name}: ${cause.message}`;
  }
  return String(cause);
}
