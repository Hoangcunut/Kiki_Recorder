import { AppSettings, RecordingSettings } from "../shared/types";

export const qualityPresets = [
  { label: "4K Ultra",   width: 3840, height: 2160, fps: 60, videoBitsPerSecond: 40_000_000 },
  { label: "2K QHD",     width: 2560, height: 1440, fps: 60, videoBitsPerSecond: 20_000_000 },
  { label: "1080p High", width: 1920, height: 1080, fps: 60, videoBitsPerSecond: 12_000_000 },
  { label: "1080p",      width: 1920, height: 1080, fps: 30, videoBitsPerSecond: 8_000_000 },
  { label: "720p",       width: 1280, height: 720,  fps: 30, videoBitsPerSecond: 5_000_000 },
  { label: "480p",       width: 854,  height: 480,  fps: 30, videoBitsPerSecond: 2_500_000 },
  { label: "360p",       width: 640,  height: 360,  fps: 30, videoBitsPerSecond: 1_000_000 },
  { label: "Source",     fps: 60, videoBitsPerSecond: 14_000_000 }
] as const;

export const defaultRecordingSettings: RecordingSettings = {
  mode: "fullscreen",
  quality: qualityPresets[4],
  audio: {
    system: true,
    microphone: false,
    pushToTalk: false,
    pushToTalkKey: "Space",
    gain: 1
  },
  webcam: {
    enabled: false,
    webcamOnly: false,
    shape: "circle",
    position: { x: 0.72, y: 0.68, width: 0.22, height: 0.26 },
    opacity: 1,
    backgroundEffect: "none"
  },
  countdownSeconds: 3,
  autoStopMinutes: 0,
  outputFormat: "mp4",
  showHotkeys: false,
  highlightClicks: true,
  spotlight: false,
  zoom: 1,
  cursorColor: "#2dd4bf"
};

export const fallbackAppSettings: AppSettings = {
  theme: "dark",
  language: "en",
  toolboxOpacity: 0.92,
  hotkeys: {
    startStop: "CommandOrControl+Shift+R",
    pauseResume: "CommandOrControl+Shift+P",
    screenshot: "CommandOrControl+Shift+S",
    pushToTalk: "Space",
    toggleToolbar: "CommandOrControl+Shift+T"
  }
};

export const defaultAnnotationStyle = {
  color: "#2dd4bf",
  thickness: 6,
  opacity: 0.95,
  fontSize: 34,
  fontFamily: "Inter, system-ui, sans-serif",
  bold: false,
  italic: false
};
