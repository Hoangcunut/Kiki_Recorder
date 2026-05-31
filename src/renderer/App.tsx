import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { CalendarClock, Clapperboard, Library, Settings, Sparkles, Video } from "lucide-react";
import {
  Annotation,
  AnnotationStyle,
  AppSettings,
  CaptureSource,
  DesktopCaptureRegion,
  DisplayInfo,
  LibraryItem,
  Point,
  RecordingOverlayConfig,
  RecordingOverlayEvent,
  Rect,
  RecordingSettings,
  ScheduleItem,
  ToolName
} from "../shared/types";
import { defaultAnnotationStyle, defaultRecordingSettings, fallbackAppSettings } from "./defaults";
import { RecorderEngine, RecorderState } from "./lib/recorder/RecorderEngine";
import { LivePreviewEngine } from "./lib/recorder/LivePreviewEngine";
import { AnnotationToolbar } from "./components/AnnotationToolbar";
import { RecordingStage } from "./components/RecordingStage";
import { RecorderPanel } from "./components/RecorderPanel";
import { LibraryPanel } from "./components/LibraryPanel";
import { EditorPanel } from "./components/EditorPanel";
import { SchedulePanel } from "./components/SchedulePanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { getI18n, I18nProvider } from "./i18n";
import { id } from "./lib/id";
import { hitTestAnnotation } from "./lib/annotations/renderAnnotations";

type TabId = "record" | "editor" | "library" | "schedule" | "settings";
type UiState = RecorderState | "preparing" | "countdown" | "saving";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef(new RecorderEngine());
  const previewRef = useRef(new LivePreviewEngine());
  const elapsedTimer = useRef<number | undefined>(undefined);
  const autoStopTimer = useRef<number | undefined>(undefined);
  const startedAt = useRef(0);
  const pausedAt = useRef(0);
  const pausedTotal = useRef(0);
  const annotationsRef = useRef<Annotation[]>([]);
  const overlayActiveId = useRef<string | null>(null);
  const startInProgress = useRef(false);
  const pendingWebcamPosition = useRef<Rect | undefined>(undefined);
  const webcamPositionFrame = useRef<number | undefined>(undefined);
  const webcamAutoEnumerated = useRef(false);
  const microphoneAutoEnumerated = useRef(false);
  const pendingOverlayConfig = useRef<RecordingOverlayConfig | undefined>(undefined);
  const overlaySyncFrame = useRef<number | undefined>(undefined);

  const [tab, setTab] = useState<TabId>("record");
  const [settings, setSettingsState] = useState<RecordingSettings>(defaultRecordingSettings);
  const [appSettings, setAppSettings] = useState<AppSettings>(fallbackAppSettings);
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [webcamDevices, setWebcamDevices] = useState<MediaDeviceInfo[]>([]);
  const [microphoneDevices, setMicrophoneDevices] = useState<MediaDeviceInfo[]>([]);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [selectedEdit, setSelectedEdit] = useState<LibraryItem | undefined>();
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [redoStack, setRedoStack] = useState<Annotation[]>([]);
  const [tool, setTool] = useState<ToolName>("select");
  const [style, setStyle] = useState<AnnotationStyle>(defaultAnnotationStyle);
  const [markerNumber, setMarkerNumber] = useState(1);
  const [uiState, setUiState] = useState<UiState>("idle");
  const [previewActive, setPreviewActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const [toolboxPanelOpen, setToolboxPanelOpen] = useState(false);
  const [surfaceAnnotationsVisible, setSurfaceAnnotationsVisible] = useState(true);
  const [systemMuted, setSystemMuted] = useState(false);
  const [microphoneMuted, setMicrophoneMuted] = useState(false);
  const text = getI18n(appSettings.language);

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  useEffect(() => {
    void bootstrap();
    return () => {
      void window.kiki.closeRecordingOverlay();
      previewRef.current.stop();
      engineRef.current.cleanup();
      if (webcamPositionFrame.current) {
        window.cancelAnimationFrame(webcamPositionFrame.current);
      }
      if (overlaySyncFrame.current) {
        window.cancelAnimationFrame(overlaySyncFrame.current);
      }
      clearTimers();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme =
      appSettings.theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : appSettings.theme;
    document.documentElement.lang = appSettings.language;
  }, [appSettings.theme, appSettings.language]);

  useEffect(() => {
    return window.kiki.onHotkey((eventName) => {
      if (eventName === "hotkey:start-stop") {
        void (uiState === "idle" ? startRecording() : stopRecording());
      }
      if (eventName === "hotkey:pause-resume") {
        pauseResume();
      }
      if (eventName === "hotkey:screenshot") {
        void screenshot();
      }
      if (eventName === "hotkey:toggle-toolbar") {
        setToolbarVisible((visible) => !visible);
      }
    });
  }, [uiState, settings, annotations]);

  useEffect(() => {
    return window.kiki.onScheduleStart((item) => {
      setSettings(item.settings);
      setTab("record");
      void startRecording(item.settings);
    });
  }, []);

  useEffect(() => {
    return window.kiki.onRecordingOverlayEvent((event) => {
      void handleRecordingOverlayEvent(event);
    });
  }, [settings, tool, style, markerNumber, annotations, uiState, toolbarVisible, toolbarCollapsed, toolbarHidden, toolboxPanelOpen, surfaceAnnotationsVisible, systemMuted, microphoneMuted, appSettings]);

  useEffect(() => {
    previewRef.current.updateSettings(settings);
  }, [settings]);

  useEffect(() => {
    const needsWebcamDevices = settings.mode === "webcam" || settings.webcam.enabled;
    if (!needsWebcamDevices || webcamAutoEnumerated.current || webcamDevices.length > 0) {
      return;
    }
    webcamAutoEnumerated.current = true;
    void refreshWebcamDevices(false);
  }, [settings.mode, settings.webcam.enabled, webcamDevices.length]);

  useEffect(() => {
    if (!settings.audio.microphone || microphoneAutoEnumerated.current || microphoneDevices.length > 0) {
      return;
    }
    microphoneAutoEnumerated.current = true;
    void refreshMicrophoneDevices(false);
  }, [settings.audio.microphone, microphoneDevices.length]);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (tab !== "record" || uiState !== "idle" || !canvas || !canLivePreview(settings)) {
      previewRef.current.stop();
      setPreviewActive(false);
      return;
    }

    setPreviewActive(false);
    void previewRef.current.start(canvas, settings, () => annotationsRef.current)
      .then(() => {
        if (!cancelled) {
          setPreviewActive(true);
          if (settings.mode === "webcam" || settings.webcam.enabled) {
            void refreshWebcamDevices(false);
          }
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          previewRef.current.stop();
          setPreviewActive(false);
          setError(errorMessage(cause));
        }
      });

    return () => {
      cancelled = true;
      previewRef.current.stop();
      setPreviewActive(false);
    };
  }, [
    tab,
    uiState,
    settings.mode,
    settings.sourceId,
    settings.webcam.enabled,
    settings.webcam.deviceId,
    settings.quality.label,
    settings.quality.fps
  ]);

  useEffect(() => {
    if (uiState === "idle" || uiState === "preparing" || uiState === "saving") {
      return;
    }
    scheduleRecordingOverlaySync(settings);
  }, [
    uiState,
    settings,
    tool,
    style,
    markerNumber,
    annotations,
    toolbarVisible,
    toolbarCollapsed,
    toolbarHidden,
    toolboxPanelOpen,
    surfaceAnnotationsVisible,
    systemMuted,
    microphoneMuted,
    appSettings.language,
    appSettings.toolboxOpacity,
    elapsed
  ]);


  const activeSource = useMemo(
    () => sources.find((source) => source.id === settings.sourceId),
    [sources, settings.sourceId]
  );
  function setSettings(next: RecordingSettings): void {
    const normalized = normalizeRecordingSettings(next);
    setSettingsState(normalized);
    engineRef.current.updateSettings(normalized);
  }

  async function bootstrap(): Promise<void> {
    try {
      const [loadedSettings, loadedLibrary, loadedSchedules, loadedDisplays] = await Promise.all([
        window.kiki.getSettings(),
        window.kiki.listLibrary(),
        window.kiki.listSchedules(),
        window.kiki.listDisplays()
      ]);
      setAppSettings(loadedSettings);
      setLibrary(loadedLibrary);
      setSchedules(loadedSchedules);
      setDisplays(loadedDisplays);
      await Promise.all([refreshSources(), refreshWebcamDevices(false), refreshMicrophoneDevices(false)]);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function refreshSources(): Promise<void> {
    const [nextSources, nextDisplays] = await Promise.all([
      window.kiki.listSources(["screen", "window"]),
      window.kiki.listDisplays()
    ]);
    setSources(nextSources);
    setDisplays(nextDisplays);
    setSettingsState((current) => {
      const normalized = normalizeRecordingSettings(current);
      if (normalized.sourceId || normalized.mode === "webcam") {
        return normalized;
      }
      const firstScreen = nextSources.find((source) => source.type === "screen");
      return firstScreen ? { ...normalized, sourceId: firstScreen.id, sourceName: firstScreen.name } : normalized;
    });
  }

  async function refreshWebcamDevices(requestPermission = false): Promise<void> {
    let permissionStream: MediaStream | undefined;
    try {
      let devices = await navigator.mediaDevices.enumerateDevices();
      let videoDevices = devices.filter((device) => device.kind === "videoinput");
      const hasVisibleLabels = videoDevices.some((device) => device.label);
      if (requestPermission && !hasVisibleLabels) {
        permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        devices = await navigator.mediaDevices.enumerateDevices();
        videoDevices = devices.filter((device) => device.kind === "videoinput");
      }
      setWebcamDevices(videoDevices);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop());
    }
  }

  async function refreshMicrophoneDevices(requestPermission = false): Promise<void> {
    let permissionStream: MediaStream | undefined;
    try {
      let devices = await navigator.mediaDevices.enumerateDevices();
      let audioDevices = devices.filter((device) => device.kind === "audioinput");
      const hasVisibleLabels = audioDevices.some((device) => device.label);
      if (requestPermission && !hasVisibleLabels) {
        permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        devices = await navigator.mediaDevices.enumerateDevices();
        audioDevices = devices.filter((device) => device.kind === "audioinput");
      }
      setMicrophoneDevices(audioDevices);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop());
    }
  }

  async function startRecording(override?: RecordingSettings, force = false): Promise<void> {
    if (!force && (uiState !== "idle" || startInProgress.current)) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    startInProgress.current = true;
    setUiState("preparing");
    previewRef.current.stop();
    setPreviewActive(false);
    setError(undefined);
    try {
      let activeSettings: RecordingSettings = normalizeRecordingSettings({
        ...(override ?? settings),
        sourceName: (override ?? settings).sourceName ?? activeSource?.name
      });
      if (activeSettings.mode === "area") {
        const regionSettings = await ensureDesktopRegionSettings(activeSettings);
        if (!regionSettings) {
          setUiState("idle");
          return;
        }
        activeSettings = regionSettings;
      }
      const shouldCountdown = activeSettings.countdownSeconds > 0;
      await engineRef.current.start(canvas, activeSettings, () => annotationsRef.current, (state) => setUiState(state), shouldCountdown);
      setToolbarVisible(true);
      setToolbarCollapsed(false);
      setToolbarHidden(false);
      setToolboxPanelOpen(false);
      setSurfaceAnnotationsVisible(true);
      setSystemMuted(false);
      setMicrophoneMuted(false);
      await openRecordingOverlay(activeSettings, "select", true);
      if (shouldCountdown) {
        setUiState("countdown");
        for (let value = activeSettings.countdownSeconds; value > 0; value -= 1) {
          setCountdown(value);
          await delay(1000);
        }
        engineRef.current.resetClock();
        engineRef.current.resume();
        setUiState("recording");
      } else {
        engineRef.current.resetClock();
        setUiState("recording");
      }
      setCountdown(0);
      startedAt.current = Date.now();
      pausedAt.current = 0;
      pausedTotal.current = 0;
      startElapsedTimer();
      if (activeSettings.autoStopMinutes > 0) {
        autoStopTimer.current = window.setTimeout(() => {
          void stopRecording();
        }, activeSettings.autoStopMinutes * 60_000);
      }
    } catch (cause) {
      console.error("startRecording error:", cause);
      setUiState("idle");
      await window.kiki.closeRecordingOverlay();
      await window.kiki.setAlwaysOnTop(false);
      setError(errorMessage(cause));
    } finally {
      startInProgress.current = false;
    }
  }

  function pauseResume(): void {
    if (uiState === "recording") {
      engineRef.current.pause();
      setUiState("paused");
      pausedAt.current = Date.now();
      window.clearInterval(elapsedTimer.current);
      return;
    }
    if (uiState === "paused") {
      engineRef.current.resume();
      pausedTotal.current += Date.now() - pausedAt.current;
      pausedAt.current = 0;
      setUiState("recording");
      startElapsedTimer();
    }
  }

  async function stopRecording(): Promise<void> {
    if (uiState === "idle") {
      return;
    }
    if (uiState === "preparing") {
      startInProgress.current = false;
      await window.kiki.cancelRegionSelection();
      await window.kiki.closeRecordingOverlay();
      setUiState("idle");
      return;
    }
    setUiState("saving");
    clearTimers();
    try {
      const item = await engineRef.current.stop();
      if (item) {
        const nextLibrary = await window.kiki.listLibrary();
        setLibrary(nextLibrary);
        setSelectedEdit(item);
        if (item.conversionError) {
          setError(`MP4 export failed, saved WebM fallback instead: ${item.conversionError}`);
        }
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      resetRecordingSessionAnnotations();
      setUiState("idle");
      setElapsed(0);
      overlayActiveId.current = null;
      startInProgress.current = false;
      await window.kiki.closeRecordingOverlay();
      await window.kiki.setAlwaysOnTop(false);
    }
  }

  async function restartRecording(): Promise<void> {
    if (uiState === "idle") {
      return;
    }
    clearTimers();
    await window.kiki.closeRecordingOverlay();
    await engineRef.current.discard();
    resetRecordingSessionAnnotations();
    setUiState("idle");
    setElapsed(0);
    await startRecording(undefined, true);
  }

  async function screenshot(): Promise<void> {
    try {
      if (uiState === "idle" && previewActive && canvasRef.current) {
        const canvas = canvasRef.current;
        await window.kiki.saveScreenshot({
          fileName: `${text.screenshot} ${new Date().toLocaleString()}`,
          dataUrl: canvas.toDataURL("image/png"),
          width: canvas.width,
          height: canvas.height
        });
        return;
      }
      await engineRef.current.saveScreenshot(`${text.screenshot} ${new Date().toLocaleString()}`, settings, () => annotationsRef.current);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function chooseDesktopRegion(): Promise<void> {
    if (uiState !== "idle") {
      return;
    }
    setError(undefined);
    try {
      const region = await window.kiki.selectRegion(settings.captureRegion, settings.sourceId);
      if (region) {
        setSettings(settingsFromRegion({ ...settings, mode: "area" }, region));
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function ensureDesktopRegionSettings(next: RecordingSettings): Promise<RecordingSettings | undefined> {
    if (next.mode !== "area") {
      return next;
    }
    if (hasValidArea(next.captureArea) && next.sourceId) {
      return next;
    }
    const region = await window.kiki.selectRegion(next.captureRegion, next.sourceId);
    if (!region) {
      return undefined;
    }
    const updated = settingsFromRegion(next, region);
    setSettings(updated);
    return updated;
  }

  async function openRecordingOverlay(
    activeSettings: RecordingSettings,
    toolOverride?: ToolName,
    visibleOverride = toolbarVisible
  ): Promise<void> {
    if (!visibleOverride) {
      return;
    }
    const config = recordingOverlayConfig(activeSettings, toolOverride, visibleOverride);
    if (config) {
      await window.kiki.openRecordingOverlay(config);
    }
  }

  function scheduleRecordingOverlaySync(activeSettings: RecordingSettings): void {
    const config = recordingOverlayConfig(activeSettings);
    if (!config) {
      return;
    }
    pendingOverlayConfig.current = config;
    if (overlaySyncFrame.current) {
      return;
    }
    overlaySyncFrame.current = window.requestAnimationFrame(() => {
      overlaySyncFrame.current = undefined;
      const nextConfig = pendingOverlayConfig.current;
      pendingOverlayConfig.current = undefined;
      if (nextConfig) {
        void window.kiki.updateRecordingOverlay(nextConfig);
      }
    });
  }

  function recordingOverlayConfig(
    activeSettings: RecordingSettings,
    toolOverride?: ToolName,
    visibleOverride = toolbarVisible
  ): RecordingOverlayConfig | undefined {
    const canvas = canvasRef.current;
    const activeTool = toolOverride ?? tool;
    const currentAnnotations = annotationsRef.current;
    const geometry = recordingOverlayGeometry(activeSettings, activeTool, currentAnnotations.length);
    if (!canvas || !geometry) {
      return undefined;
    }

    return {
      ...geometry,
      sourceSize: {
        width: Math.max(1, canvas.width || activeSettings.quality.width || 1920),
        height: Math.max(1, canvas.height || activeSettings.quality.height || 1080)
      },
      toolbarVisible: visibleOverride,
      toolbarCollapsed,
      toolbarHidden,
      toolboxPanelOpen,
      surfaceAnnotationsVisible,
      annotations: currentAnnotations,
      activeTool,
      style,
      markerNumber,
      zoom: activeSettings.zoom,
      spotlight: activeSettings.spotlight,
      highlightClicks: activeSettings.highlightClicks,
      cursorColor: activeSettings.cursorColor,
      audio: {
        systemEnabled: activeSettings.audio.system && !systemMuted,
        microphoneEnabled: activeSettings.audio.microphone && !microphoneMuted,
        systemMuted,
        microphoneMuted,
        systemAvailable: activeSettings.audio.system,
        microphoneAvailable: true
      },
      state: uiState,
      language: appSettings.language,
      hotkeys: appSettings.hotkeys,
      toolboxOpacity: clampNumber(appSettings.toolboxOpacity ?? 0.92, 0.35, 1),
      elapsedMs: elapsed
    };
  }

  function recordingOverlayGeometry(
    activeSettings: RecordingSettings,
    activeTool: ToolName,
    annotationCount = annotationsRef.current.length
  ): Pick<RecordingOverlayConfig, "bounds" | "surfaceBounds" | "captureBounds" | "surfaceVisible" | "surfaceInteractive" | "drawingEnabled"> | undefined {
    const primary = displays.find((display) => display.primary) ?? displays[0];
    if (!primary) {
      return undefined;
    }
    let displayBounds = primary.bounds;
    let captureBounds = primary.bounds;
    let canDrawOnDesktop = false;

    if (activeSettings.mode === "area" && activeSettings.captureRegion) {
      const display = displays.find((candidate) => String(candidate.id) === String(activeSettings.captureRegion?.displayId)) ?? primary;
      displayBounds = display.bounds;
      captureBounds = activeSettings.captureRegion.bounds;
      canDrawOnDesktop = true;
    } else if (activeSettings.mode === "fullscreen") {
      const source = sources.find((candidate) => candidate.id === activeSettings.sourceId) ?? activeSource;
      const display = source?.displayId
        ? displays.find((candidate) => String(candidate.id) === String(source.displayId))
        : primary;
      displayBounds = (display ?? primary).bounds;
      captureBounds = displayBounds;
      canDrawOnDesktop = true;
    }

    const toolbarBounds = toolbarOnlyBounds(displayBounds, toolboxPanelOpen, toolbarHidden, toolbarCollapsed);
    const drawingEnabled = canDrawOnDesktop && activeTool !== "select";
    const spotlightActive = activeSettings.spotlight;
    const surfaceVisible = canDrawOnDesktop && (drawingEnabled || annotationCount > 0 || spotlightActive);
    const surfaceInteractive = canDrawOnDesktop && (drawingEnabled || spotlightActive);
    return {
      bounds: toolbarBounds,
      surfaceBounds: canDrawOnDesktop ? captureBounds : toolbarBounds,
      captureBounds: canDrawOnDesktop ? captureBounds : toolbarBounds,
      surfaceVisible,
      surfaceInteractive,
      drawingEnabled
    };
  }

  function updateWebcamPosition(position: Rect): void {
    pendingWebcamPosition.current = position;
    if (webcamPositionFrame.current) {
      return;
    }
    webcamPositionFrame.current = window.requestAnimationFrame(() => {
      webcamPositionFrame.current = undefined;
      const nextPosition = pendingWebcamPosition.current;
      if (!nextPosition) {
        return;
      }
      setSettingsState((current) => {
        const next = normalizeRecordingSettings({
          ...current,
          webcam: {
            ...current.webcam,
            position: nextPosition
          }
        });
        engineRef.current.updateSettings(next);
        previewRef.current.updateSettings(next);
        return next;
      });
    });
  }

  async function handleRecordingOverlayEvent(event: RecordingOverlayEvent): Promise<void> {
    switch (event.type) {
      case "pointer-down":
        overlayPointerDown(event.point);
        return;
      case "pointer-move":
        overlayPointerMove(event.point);
        return;
      case "pointer-up":
        overlayPointerUp(event.point);
        return;
      case "click":
        pointer(event.point);
        clickPulse(event.point);
        return;
      case "wheel":
        pointer(event.point);
        setSettings({ ...settings, zoom: clampNumber(settings.zoom + (event.deltaY < 0 ? 0.18 : -0.18), 1, 4) });
        return;
      case "text":
        addAnnotation({ id: id("text"), tool: "text", at: event.point, text: event.text, style });
        return;
      case "tool":
        setTool((current) => (current === event.tool && event.tool !== "select" ? "select" : event.tool));
        return;
      case "style":
        setStyle(event.style);
        return;
      case "zoom":
        setSettings({ ...settings, zoom: clampNumber(event.zoom, 1, 4) });
        return;
      case "undo":
        undo();
        return;
      case "redo":
        redo();
        return;
      case "clear":
        clearAnnotations();
        return;
      case "pause-resume":
        pauseResume();
        return;
      case "stop":
        await stopRecording();
        return;
      case "restart":
        await restartRecording();
        return;
      case "toggle-toolbar":
        setToolbarVisible((visible) => !visible);
        return;
      case "toolbar-visibility":
        setToolbarVisible(event.visible);
        return;
      case "toolbar-collapsed":
        setToolbarCollapsed(event.collapsed);
        return;
      case "toggle-minimize":
        setToolbarHidden(false);
        setToolboxPanelOpen(false);
        setToolbarCollapsed((c) => !c);
        return;
      case "toggle-hide":
        setToolbarHidden((h) => !h);
        return;
      case "toolbox-panel":
        setToolboxPanelOpen(event.open);
        return;
      case "toolbox-opacity":
        await saveAppSettings({ ...appSettings, toolboxOpacity: clampNumber(event.opacity, 0.35, 1) });
        return;
      case "toggle-system-audio":
        toggleSystemAudioMute();
        return;
      case "toggle-microphone":
        await toggleMicrophoneMute();
        return;
      case "toggle-spotlight":
        setSettings({ ...settings, spotlight: !settings.spotlight });
        return;
      case "toggle-clicks":
        setSettings({ ...settings, highlightClicks: !settings.highlightClicks });
        return;
      case "toggle-surface-annotations":
        setSurfaceAnnotationsVisible((visible) => !visible);
        return;
      default:
        return;
    }
  }

  function overlayPointerDown(point: Point): void {
    pointer(point);
    clickPulse(point);

    if (tool === "select") {
      return;
    }
    if (tool === "eraser") {
      const target = [...annotations].reverse().find((annotation) => hitTestAnnotation(annotation, point));
      if (target) {
        removeAnnotation(target.id);
      }
      return;
    }
    if (tool === "marker") {
      addAnnotation({ id: id("marker"), tool: "marker", at: point, number: markerNumber, style });
      setMarkerNumber((value) => value + 1);
      return;
    }
    if (tool === "pen" || tool === "highlighter") {
      const annotation: Annotation = { id: id(tool), tool, points: [point], style };
      overlayActiveId.current = annotation.id;
      addAnnotation(annotation);
      return;
    }
    if (tool === "line" || tool === "arrow" || tool === "rectangle" || tool === "circle" || tool === "blur" || tool === "pixelate") {
      const annotation: Annotation = { id: id(tool), tool, from: point, to: point, style };
      overlayActiveId.current = annotation.id;
      addAnnotation(annotation);
    }
  }

  function overlayPointerMove(point: Point): void {
    pointer(point);
    const currentId = overlayActiveId.current;
    if (!currentId) {
      return;
    }
    const existing = annotations.find((annotation) => annotation.id === currentId);
    if (!existing) {
      return;
    }
    if ("points" in existing) {
      updateAnnotation({ ...existing, points: [...existing.points, point] });
    } else if ("from" in existing) {
      updateAnnotation({ ...existing, to: point });
    }
  }

  function overlayPointerUp(point: Point): void {
    pointer(point);
    const currentId = overlayActiveId.current;
    if (currentId) {
      const existing = annotationsRef.current.find((annotation) => annotation.id === currentId);
      if (existing && (existing.tool === "blur" || existing.tool === "pixelate") && isTinyBox(existing.from, existing.to)) {
        removeAnnotation(existing.id);
      }
    }
    overlayActiveId.current = null;
  }

  function toggleSystemAudioMute(): void {
    if (!settings.audio.system) {
      setError("System audio was not captured at start, so it cannot be enabled during this recording.");
      return;
    }
    const nextMuted = !systemMuted;
    if (engineRef.current.setSystemMuted(nextMuted)) {
      setSystemMuted(nextMuted);
      return;
    }
    setError("System audio track is unavailable for this recording.");
  }

  async function toggleMicrophoneMute(): Promise<void> {
    const nextMuted = settings.audio.microphone ? !microphoneMuted : false;
    const nextSettings = settings.audio.microphone
      ? settings
      : { ...settings, audio: { ...settings.audio, microphone: true } };
    const ok = await engineRef.current.setMicMuted(nextMuted, nextSettings);
    if (!ok) {
      setError("Microphone is unavailable. Check microphone permission and device settings.");
      return;
    }
    if (!settings.audio.microphone) {
      setSettings(nextSettings);
    }
    setMicrophoneMuted(nextMuted);
  }

  function addAnnotation(annotation: Annotation): void {
    const next = [...annotationsRef.current, annotation];
    annotationsRef.current = next;
    setAnnotations(next);
    setRedoStack([]);
  }

  function updateAnnotation(annotation: Annotation): void {
    const next = annotationsRef.current.map((item) => (item.id === annotation.id ? annotation : item));
    annotationsRef.current = next;
    setAnnotations(next);
  }

  function removeAnnotation(id: string): void {
    const next = annotationsRef.current.filter((annotation) => annotation.id !== id);
    annotationsRef.current = next;
    setAnnotations(next);
  }

  function undo(): void {
    const removed = annotationsRef.current[annotationsRef.current.length - 1];
    if (removed) {
      setRedoStack((redo) => [removed, ...redo]);
    }
    const next = annotationsRef.current.slice(0, -1);
    annotationsRef.current = next;
    setAnnotations(next);
  }

  function redo(): void {
    setRedoStack((current) => {
      const [next, ...rest] = current;
      if (next) {
        const annotationsNext = [...annotationsRef.current, next];
        annotationsRef.current = annotationsNext;
        setAnnotations(annotationsNext);
      }
      return rest;
    });
  }

  function clearAnnotations(): void {
    setRedoStack([]);
    annotationsRef.current = [];
    overlayActiveId.current = null;
    setAnnotations([]);
    setMarkerNumber(1);
  }

  function resetRecordingSessionAnnotations(): void {
    annotationsRef.current = [];
    overlayActiveId.current = null;
    setAnnotations([]);
    setRedoStack([]);
    setMarkerNumber(1);
    setTool("select");
  }

  function pointer(point: Point): void {
    engineRef.current.setPointer(point);
    previewRef.current.setPointer(point);
  }

  function clickPulse(point: Point): void {
    engineRef.current.addClick(point);
    previewRef.current.addClick(point);
  }

  function startElapsedTimer(): void {
    window.clearInterval(elapsedTimer.current);
    elapsedTimer.current = window.setInterval(() => {
      setElapsed(Date.now() - startedAt.current - pausedTotal.current);
    }, 1000);
  }

  function clearTimers(): void {
    window.clearInterval(elapsedTimer.current);
    window.clearTimeout(autoStopTimer.current);
  }

  async function saveAppSettings(next: AppSettings): Promise<void> {
    const saved = await window.kiki.saveSettings(next);
    setAppSettings(saved);
  }

  async function removeLibraryItem(id: string, deleteFile: boolean): Promise<void> {
    setLibrary(await window.kiki.removeLibraryItem(id, deleteFile));
  }

  async function addSchedule(startsAt: string, endsAt?: string, name = text.scheduledRecording): Promise<void> {
    const item = await window.kiki.addSchedule({
      name,
      startsAt,
      endsAt,
      settings
    });
    setSchedules((current) => [item, ...current]);
  }

  async function removeSchedule(id: string): Promise<void> {
    setSchedules(await window.kiki.removeSchedule(id));
  }

  const tabs: Array<{ id: TabId; label: string; icon: ComponentType<{ size?: number }> }> = [
    { id: "record", label: text.navRecord, icon: Video },
    { id: "editor", label: text.navEditor, icon: Clapperboard },
    { id: "library", label: text.navLibrary, icon: Library },
    { id: "schedule", label: text.navSchedule, icon: CalendarClock },
    { id: "settings", label: text.navSettings, icon: Settings }
  ];

  return (
    <I18nProvider language={appSettings.language}>
    <div className="appShell">
      <nav className="navRail">
        <div className="brand">
          <Sparkles size={24} />
          <span>{text.appName}</span>
        </div>
        <div className="navButtons">
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="mainArea">
        {tab === "record" ? (
          <div className="recordLayout">
            <RecorderPanel
              settings={settings}
              sources={sources}
              webcamDevices={webcamDevices}
              microphoneDevices={microphoneDevices}
              state={uiState}
              elapsed={elapsed}
              countdown={countdown}
              onSettings={setSettings}
              onRefreshSources={() => void refreshSources()}
              onRefreshWebcamDevices={() => void refreshWebcamDevices(true)}
              onRefreshMicrophoneDevices={() => void refreshMicrophoneDevices(true)}
              onSelectRegion={() => void chooseDesktopRegion()}
              onStart={() => void startRecording()}
              onPauseResume={pauseResume}
              onStop={() => void stopRecording()}
              onRestart={() => void restartRecording()}
              onScreenshot={() => void screenshot()}
            />
            <section className="recordWorkspace">
              <AnnotationToolbar
                activeTool={tool}
                style={style}
                zoom={settings.zoom}
                spotlight={settings.spotlight}
                onToolChange={setTool}
                onStyleChange={setStyle}
                onUndo={undo}
                onRedo={redo}
                onClear={clearAnnotations}
                onZoomChange={(zoom) => setSettings({ ...settings, zoom })}
                onSpotlightChange={(spotlight) => setSettings({ ...settings, spotlight })}
              />
              <RecordingStage
                canvasRef={canvasRef}
                annotations={annotations}
                tool={tool}
                style={style}
                markerNumber={markerNumber}
                recordingState={uiState}
                previewActive={previewActive}
                onPointer={pointer}
                onClickPulse={clickPulse}
                onAdd={addAnnotation}
                onUpdate={updateAnnotation}
                onRemove={removeAnnotation}
                onMarkerUsed={() => setMarkerNumber((value) => value + 1)}
                webcamOverlay={{
                  enabled: settings.webcam.enabled && settings.mode !== "webcam",
                  position: settings.webcam.position,
                  shape: settings.webcam.shape,
                  onMove: updateWebcamPosition
                }}
              />
              {error ? <div className="errorBanner">{error}</div> : null}
            </section>
          </div>
        ) : null}

        {tab === "editor" ? (
          <EditorPanel items={library} selected={selectedEdit} onSelect={setSelectedEdit} />
        ) : null}
        {tab === "library" ? (
          <LibraryPanel
            items={library}
            onRefresh={() => void window.kiki.listLibrary().then(setLibrary)}
            onEdit={(item) => {
              setSelectedEdit(item);
              setTab("editor");
            }}
            onReveal={(filePath) => void window.kiki.revealPath(filePath)}
            onRemove={(id, deleteFile) => void removeLibraryItem(id, deleteFile)}
          />
        ) : null}
        {tab === "schedule" ? (
          <SchedulePanel schedules={schedules} currentSettings={settings} onAdd={(start, end, name) => void addSchedule(start, end, name)} onRemove={(id) => void removeSchedule(id)} />
        ) : null}
        {tab === "settings" ? <SettingsPanel settings={appSettings} onSave={(next) => void saveAppSettings(next)} /> : null}
      </main>
    </div>
    </I18nProvider>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function hasValidArea(area?: Rect): boolean {
  return Boolean(area && area.width >= 64 && area.height >= 64);
}

function isTinyBox(from: Point, to: Point): boolean {
  return Math.abs(to.x - from.x) < 12 || Math.abs(to.y - from.y) < 12;
}

function normalizeRecordingSettings(settings: RecordingSettings): RecordingSettings {
  const mode = settings.mode === "browser-tab" ? "fullscreen" : settings.mode;
  if (mode === "area") {
    return { ...settings, mode };
  }
  return {
    ...settings,
    mode,
    captureArea: undefined,
    captureRegion: undefined
  };
}

function canLivePreview(settings: RecordingSettings): boolean {
  if (settings.mode === "webcam") {
    return true;
  }
  return Boolean(settings.sourceId);
}

function settingsFromRegion(settings: RecordingSettings, region: DesktopCaptureRegion): RecordingSettings {
  return {
    ...settings,
    mode: "area",
    sourceId: region.sourceId ?? settings.sourceId,
    sourceName: region.sourceName ?? region.displayLabel ?? settings.sourceName,
    captureArea: region.pixelBounds,
    captureRegion: region
  };
}

function toolbarOnlyBounds(displayBounds: Rect, panelOpen: boolean, hidden: boolean, collapsed: boolean): Rect {
  if (hidden) {
    return {
      x: displayBounds.x,
      y: displayBounds.y,
      width: displayBounds.width,
      height: 8
    };
  }
  if (collapsed) {
    const width = 172;
    const height = 52;
    return {
      x: displayBounds.x + Math.round((displayBounds.width - width) / 2),
      y: displayBounds.y + 24,
      width,
      height
    };
  }
  const width = 720;
  const height = panelOpen ? 340 : 60;
  return {
    x: displayBounds.x + Math.round((displayBounds.width - width) / 2),
    y: displayBounds.y + 24,
    width,
    height
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
