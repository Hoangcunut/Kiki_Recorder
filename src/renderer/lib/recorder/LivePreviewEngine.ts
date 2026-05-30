import { Annotation, RecordingSettings } from "../../../shared/types";
import { CanvasCompositor } from "./CanvasCompositor";

export class LivePreviewEngine {
  private compositor?: CanvasCompositor;
  private streams: MediaStream[] = [];
  private settings?: RecordingSettings;
  private generation = 0;

  async start(
    canvas: HTMLCanvasElement,
    settings: RecordingSettings,
    annotations: () => Annotation[]
  ): Promise<void> {
    const generation = this.generation + 1;
    this.generation = generation;
    this.dispose();
    this.settings = settings;

    let sourceStream: MediaStream | undefined;
    let webcamStream: MediaStream | undefined;
    const nextStreams: MediaStream[] = [];
    try {
      if (settings.mode === "webcam") {
        webcamStream = await getWebcamStream(settings);
        if (!webcamStream) {
          throw new Error("No webcam stream available for preview.");
        }
        sourceStream = webcamStream;
      } else {
        sourceStream = await getDesktopPreviewStream(settings);
        webcamStream = await getWebcamStream(settings);
      }
    } catch (cause) {
      sourceStream?.getTracks().forEach((track) => track.stop());
      webcamStream?.getTracks().forEach((track) => track.stop());
      throw cause;
    }

    if (!sourceStream) {
      throw new Error("No source stream available for preview.");
    }
    nextStreams.push(sourceStream);
    if (webcamStream && webcamStream !== sourceStream) {
      nextStreams.push(webcamStream);
    }

    if (generation !== this.generation) {
      stopStreams(nextStreams);
      return;
    }

    const compositor = new CanvasCompositor(
      canvas,
      settings.mode === "webcam" && webcamStream ? webcamStream : sourceStream,
      settings.mode === "webcam" ? undefined : webcamStream,
      settings,
      annotations
    );
    try {
      await compositor.start();
    } catch (cause) {
      compositor.stop();
      stopStreams(nextStreams);
      throw cause;
    }

    if (generation !== this.generation) {
      compositor.stop();
      stopStreams(nextStreams);
      return;
    }

    this.streams = nextStreams;
    this.compositor = compositor;
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

  stop(): void {
    this.generation += 1;
    this.dispose();
  }

  private dispose(): void {
    this.compositor?.stop();
    this.compositor = undefined;
    stopStreams(this.streams);
    this.streams = [];
  }
}

function stopStreams(streams: MediaStream[]): void {
  for (const stream of streams) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}

async function getDesktopPreviewStream(settings: RecordingSettings): Promise<MediaStream> {
  if (!settings.sourceId) {
    throw new Error("No source selected for live preview.");
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: settings.sourceId,
          maxFrameRate: settings.quality.fps
        }
      } as MediaTrackConstraints
    });
    if (stream.getVideoTracks().length === 0) {
      throw new Error("Desktop preview returned no video track.");
    }
    return stream;
  } catch (legacyError) {
    await window.kiki.prepareCapture({
      sourceId: settings.sourceId,
      systemAudio: false,
      useSystemPicker: false
    });
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: {
          frameRate: settings.quality.fps,
          width: settings.quality.width,
          height: settings.quality.height,
          displaySurface: settings.mode === "window" ? "window" : "monitor"
        },
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
        systemAudio: "exclude",
        surfaceSwitching: "include"
      } as DisplayMediaStreamOptions);
      if (stream.getVideoTracks().length === 0) {
        throw new Error("Display preview returned no video track.");
      }
      return stream;
    } catch (displayError) {
      throw new Error(`Live preview failed: ${describeError(legacyError)}. Fallback failed: ${describeError(displayError)}.`);
    }
  }
}

async function getWebcamStream(settings: RecordingSettings): Promise<MediaStream | undefined> {
  if (!settings.webcam.enabled && settings.mode !== "webcam") {
    return undefined;
  }
  return navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: settings.webcam.deviceId ? { exact: settings.webcam.deviceId } : undefined,
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  });
}

function describeError(cause: unknown): string {
  if (cause instanceof Error) {
    return `${cause.name}: ${cause.message}`;
  }
  return String(cause);
}
