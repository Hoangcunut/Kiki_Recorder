export type PlatformName = "win32" | "darwin" | "linux" | string;

export type CaptureSourceType = "screen" | "window";

export type CaptureSource = {
  id: string;
  name: string;
  type: CaptureSourceType;
  thumbnail: string;
  appIcon?: string | null;
  displayId?: string;
};

export type DisplayInfo = {
  id: number;
  label: string;
  bounds: Rect;
  scaleFactor: number;
  primary: boolean;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopCaptureRegion = {
  displayId: string;
  displayLabel?: string;
  sourceId?: string;
  sourceName?: string;
  bounds: Rect;
  pixelBounds: Rect;
  scaleFactor: number;
};

export type RecordingMode =
  | "fullscreen"
  | "area"
  | "window"
  | "browser-tab"
  | "webcam";

export type WebcamShape = "rectangle" | "circle";
export type BackgroundEffect = "none" | "blur" | "virtual";
export type ExportFormat = "mp4" | "webm" | "gif" | "avi" | "mov";
export type RecordingOutputFormat = "mp4" | "webm";
export type VideoCodec = "h264" | "vp8" | "vp9" | "mpeg4";

export type QualityPreset = {
  label: string;
  width?: number;
  height?: number;
  fps: 30 | 60;
  videoBitsPerSecond: number;
};

export type AudioSettings = {
  system: boolean;
  microphone: boolean;
  pushToTalk: boolean;
  pushToTalkKey: string;
  gain: number;
};

export type WebcamSettings = {
  enabled: boolean;
  webcamOnly: boolean;
  deviceId?: string;
  shape: WebcamShape;
  position: Rect;
  opacity: number;
  backgroundEffect: BackgroundEffect;
  virtualBackgroundPath?: string;
};

export type RecordingSettings = {
  mode: RecordingMode;
  sourceId?: string;
  sourceName?: string;
  captureArea?: Rect;
  captureRegion?: DesktopCaptureRegion;
  quality: QualityPreset;
  audio: AudioSettings;
  webcam: WebcamSettings;
  countdownSeconds: number;
  autoStopMinutes: number;
  outputFormat: RecordingOutputFormat;
  showHotkeys: boolean;
  highlightClicks: boolean;
  spotlight: boolean;
  zoom: number;
  cursorColor: string;
};

export type ToolName =
  | "select"
  | "pen"
  | "text"
  | "arrow"
  | "line"
  | "rectangle"
  | "circle"
  | "highlighter"
  | "marker"
  | "blur"
  | "pixelate"
  | "eraser";

export type AnnotationStyle = {
  color: string;
  thickness: number;
  opacity: number;
  fontSize: number;
  fontFamily: string;
  bold?: boolean;
  italic?: boolean;
};

export type Point = {
  x: number;
  y: number;
  t?: number;
};

export type Annotation =
  | {
      id: string;
      tool: "pen" | "highlighter" | "eraser";
      points: Point[];
      style: AnnotationStyle;
    }
  | {
      id: string;
      tool: "line" | "arrow" | "rectangle" | "circle" | "blur" | "pixelate";
      from: Point;
      to: Point;
      style: AnnotationStyle;
    }
  | {
      id: string;
      tool: "text";
      at: Point;
      text: string;
      style: AnnotationStyle;
    }
  | {
      id: string;
      tool: "marker";
      at: Point;
      number: number;
      style: AnnotationStyle;
    };

export type RecorderUiState = "idle" | "preparing" | "recording" | "paused" | "countdown" | "saving";

export type RecordingOverlayAudioState = {
  systemEnabled: boolean;
  microphoneEnabled: boolean;
  systemMuted: boolean;
  microphoneMuted: boolean;
  systemAvailable: boolean;
  microphoneAvailable: boolean;
};

export type RecordingOverlayConfig = {
  bounds: Rect;
  surfaceBounds: Rect;
  captureBounds: Rect;
  sourceSize: { width: number; height: number };
  surfaceVisible: boolean;
  surfaceInteractive: boolean;
  drawingEnabled: boolean;
  toolbarVisible: boolean;
  toolbarCollapsed: boolean;
  toolbarHidden: boolean;
  toolboxPanelOpen: boolean;
  surfaceAnnotationsVisible: boolean;
  annotations: Annotation[];
  activeTool: ToolName;
  style: AnnotationStyle;
  markerNumber: number;
  zoom: number;
  spotlight: boolean;
  highlightClicks: boolean;
  cursorColor: string;
  audio: RecordingOverlayAudioState;
  state: RecorderUiState;
  language: "en" | "vi";
  hotkeys: HotkeySettings;
  toolboxOpacity: number;
  elapsedMs: number;
};

export type RecordingOverlayEvent =
  | { type: "pointer-down"; point: Point; button: number }
  | { type: "pointer-move"; point: Point }
  | { type: "pointer-up"; point: Point }
  | { type: "click"; point: Point }
  | { type: "wheel"; point: Point; deltaY: number }
  | { type: "text"; point: Point; text: string }
  | { type: "tool"; tool: ToolName }
  | { type: "style"; style: AnnotationStyle }
  | { type: "zoom"; zoom: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "clear" }
  | { type: "pause-resume" }
  | { type: "stop" }
  | { type: "restart" }
  | { type: "toggle-toolbar" }
  | { type: "toolbar-visibility"; visible: boolean }
  | { type: "toolbar-collapsed"; collapsed: boolean }
  | { type: "toggle-minimize" }
  | { type: "toggle-hide" }
  | { type: "toolbox-panel"; open: boolean }
  | { type: "toolbox-opacity"; opacity: number }
  | { type: "toggle-system-audio" }
  | { type: "toggle-microphone" }
  | { type: "toggle-spotlight" }
  | { type: "toggle-clicks" }
  | { type: "toggle-surface-annotations" };

export type RecordingMetadata = {
  title: string;
  mode: RecordingMode;
  sourceName?: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  startedAt: string;
  endedAt: string;
};

export type LibraryItem = RecordingMetadata & {
  id: string;
  path: string;
  thumbnailPath?: string;
  format: string;
  bytes: number;
  createdAt: string;
  conversionError?: string;
};

export type ScreenshotItem = {
  id: string;
  path: string;
  width: number;
  height: number;
  createdAt: string;
};

export type ExportJob = {
  inputPath: string;
  outputPath?: string;
  format: ExportFormat;
  codec?: VideoCodec;
  quality?: "low" | "medium" | "high" | "lossless";
  startSeconds?: number;
  endSeconds?: number;
  crop?: Rect;
  playbackSpeed?: number;
  muteAudio?: boolean;
  extraAudioPath?: string;
  watermarkPath?: string;
  watermarkOpacity?: number;
  outputHeight?: number;
  fps?: number;
};

export type ExportProgress = {
  jobId: string;
  percent?: number;
  timeSeconds?: number;
  message: string;
};

export type AppSettings = {
  theme: "dark" | "light" | "system";
  language: "en" | "vi";
  recordingsDir?: string;
  screenshotsDir?: string;
  toolboxOpacity?: number;
  hotkeys: HotkeySettings;
};

export type HotkeySettings = {
  startStop: string;
  pauseResume: string;
  screenshot: string;
  pushToTalk: string;
  toggleToolbar: string;
};

export type ScheduleItem = {
  id: string;
  name: string;
  startsAt: string;
  endsAt?: string;
  settings: RecordingSettings;
  createdAt: string;
};

export type CapturePrepareOptions = {
  sourceId?: string;
  systemAudio: boolean;
  useSystemPicker: boolean;
};

export type SaveRecordingRequest = {
  fileName: string;
  extension: "webm" | "mp4";
  outputFormat?: RecordingOutputFormat;
  data: ArrayBuffer;
  metadata: RecordingMetadata;
  pipePath?: string;  // If set, the file was already written by ffmpeg pipe — skip data write
};

export type SaveScreenshotRequest = {
  fileName: string;
  dataUrl: string;
  width: number;
  height: number;
};
