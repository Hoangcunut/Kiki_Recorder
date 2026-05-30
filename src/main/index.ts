import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  screen,
  session,
  shell,
  systemPreferences
} from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  CapturePrepareOptions,
  CaptureSource,
  DesktopCaptureRegion,
  DisplayInfo,
  ExportJob,
  LibraryItem,
  Rect,
  RecordingOverlayConfig,
  RecordingOverlayEvent,
  SaveRecordingRequest,
  SaveScreenshotRequest,
  ScheduleItem
} from "../shared/types";
import { getFfmpegPath, runFfmpeg } from "./ffmpeg";
import { startPipe, writeChunk, finishPipe, cancelPipe } from "./ffmpegPipe";
import { ensureDir, sanitizeFileName } from "./paths";
import {
  addLibraryItem,
  addSchedule,
  getRecordingsDir,
  getScreenshotsDir,
  getSettings,
  listLibrary,
  listSchedules,
  removeLibraryItem,
  removeSchedule,
  safeUnlink,
  saveSettings
} from "./storage";

let mainWindow: BrowserWindow | null = null;
let recordingOverlayWindow: BrowserWindow | null = null;
let recordingSurfaceWindow: BrowserWindow | null = null;
let recordingOverlayState: RecordingOverlayConfig | undefined;
let captureOptions: CapturePrepareOptions = {
  systemAudio: false,
  useSystemPicker: false
};
let regionSelection: {
  windows: BrowserWindow[];
  resolve: (region: DesktopCaptureRegion | undefined) => void;
  resolved: boolean;
  sourceByDisplayId: Map<string, Electron.DesktopCapturerSource>;
} | null = null;
const scheduleTimers = new Map<string, NodeJS.Timeout>();
let savedToolbarPosition: { x: number; y: number } | null = null;

if (process.platform === "win32") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("use-angle", "swiftshader");
  app.commandLine.appendSwitch("use-gl", "swiftshader");
  app.commandLine.appendSwitch("disable-features", "UseSkiaRenderer,VizDisplayCompositor");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f1117" : "#f8fafc",
    title: "KikiRecorder",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    closeRecordingOverlay();
    finishRegionSelection(undefined);
    mainWindow = null;
  });

  mainWindow.webContents.on("console-message", (event, level, message, line, sourceId) => {
    console.log(`[MAIN_WINDOW] ${message} (${sourceId}:${line})`);
  });
}

function loadRenderer(window: BrowserWindow, hash?: string): void {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    const baseUrl = devServerUrl.replace(/\/$/, "");
    window.loadURL(hash ? `${baseUrl}/#/${hash}` : baseUrl);
    return;
  }

  const rendererPath = path.join(__dirname, "../renderer/index.html");
  if (hash) {
    window.loadFile(rendererPath, { hash: `/${hash.replace(/^\/+/, "")}` });
    return;
  }
  window.loadFile(rendererPath);
}

function installDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false
      });
      const selected =
        sources.find((source) => source.id === captureOptions.sourceId) ??
        sources.find((source) => source.id.startsWith("screen:")) ??
        sources[0];

      if (!selected) {
        callback({});
        return;
      }

      callback({
        video: selected,
        audio:
          request.audioRequested && captureOptions.systemAudio && process.platform !== "darwin"
            ? "loopback"
            : undefined
      });
    },
    { useSystemPicker: captureOptions.useSystemPicker }
  );
}

function displayInfo(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: `Display ${index + 1}`,
    bounds: display.bounds,
    scaleFactor: display.scaleFactor,
    primary: display.id === primaryId
  }));
}

async function desktopScreenSources(): Promise<Electron.DesktopCapturerSource[]> {
  return desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false
  });
}

function sourceForDisplay(
  display: Electron.Display,
  sources: Electron.DesktopCapturerSource[],
  index: number
): Electron.DesktopCapturerSource | undefined {
  return (
    sources.find((source) => String(source.display_id) === String(display.id)) ??
    sources.find((source) => source.id === `screen:${display.id}:0`) ??
    sources[index] ??
    sources[0]
  );
}

async function selectDesktopRegion(
  initialRegion?: DesktopCaptureRegion,
  preferredSourceId?: string
): Promise<DesktopCaptureRegion | undefined> {
  if (regionSelection) {
    for (const window of regionSelection.windows) {
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
      }
    }
    return undefined;
  }

  const displays = screen.getAllDisplays();
  const sources = await desktopScreenSources();
  const sourceByDisplayId = new Map<string, Electron.DesktopCapturerSource>();
  for (const [index, display] of displays.entries()) {
    const source = sourceForDisplay(display, sources, index);
    if (source) {
      sourceByDisplayId.set(String(display.id), source);
    }
  }
  const targetDisplay = displayForRegionPicker(displays, sources, initialRegion, preferredSourceId);
  if (!targetDisplay) {
    return undefined;
  }
  const targetIndex = displays.findIndex((display) => display.id === targetDisplay.id);
  const targetSource =
    sourceByDisplayId.get(String(targetDisplay.id)) ??
    sourceForDisplay(targetDisplay, sources, Math.max(0, targetIndex));

  return new Promise((resolve) => {
    const windows: BrowserWindow[] = [];
    regionSelection = {
      windows,
      resolve,
      resolved: false,
      sourceByDisplayId
    };

    const overlay = new BrowserWindow({
      x: targetDisplay.bounds.x,
      y: targetDisplay.bounds.y,
      width: targetDisplay.bounds.width,
      height: targetDisplay.bounds.height,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true,
      show: false,
      title: "KikiRecorder Region Picker",
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    });

    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.once("ready-to-show", () => {
      if (!overlay.isDestroyed()) {
        overlay.show();
        overlay.focus();
      }
    });
    overlay.on("closed", () => {
      if (regionSelection && !regionSelection.resolved) {
        finishRegionSelection(undefined);
      }
    });

    windows.push(overlay);
    loadRenderer(overlay, regionOverlayHash(targetDisplay, targetSource, initialRegion));
  });
}

function displayForRegionPicker(
  displays: Electron.Display[],
  sources: Electron.DesktopCapturerSource[],
  initialRegion?: DesktopCaptureRegion,
  preferredSourceId?: string
): Electron.Display | undefined {
  const primary = screen.getPrimaryDisplay();
  const initialDisplay = initialRegion
    ? displays.find((display) => String(display.id) === String(initialRegion.displayId))
    : undefined;
  const preferredSource = preferredSourceId
    ? sources.find((source) => source.id === preferredSourceId)
    : undefined;
  const preferredDisplay = preferredSource?.display_id
    ? displays.find((display) => String(display.id) === String(preferredSource.display_id))
    : undefined;
  return initialDisplay ?? preferredDisplay ?? displays.find((display) => display.id === primary.id) ?? displays[0];
}

function regionOverlayHash(
  display: Electron.Display,
  source: Electron.DesktopCapturerSource | undefined,
  initialRegion?: DesktopCaptureRegion
): string {
  const params = new URLSearchParams({
    displayId: String(display.id),
    displayLabel: display.label || `Display ${display.id}`,
    displayX: String(display.bounds.x),
    displayY: String(display.bounds.y),
    displayWidth: String(display.bounds.width),
    displayHeight: String(display.bounds.height),
    scaleFactor: String(display.scaleFactor),
    sourceId: source?.id ?? "",
    sourceName: source?.name ?? "",
    language: getSettings().language
  });

  if (initialRegion && String(initialRegion.displayId) === String(display.id)) {
    const initialLocal = clampRect(
      {
        x: initialRegion.bounds.x - display.bounds.x,
        y: initialRegion.bounds.y - display.bounds.y,
        width: initialRegion.bounds.width,
        height: initialRegion.bounds.height
      },
      { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height },
      64
    );
    params.set("initialX", String(initialLocal.x));
    params.set("initialY", String(initialLocal.y));
    params.set("initialWidth", String(initialLocal.width));
    params.set("initialHeight", String(initialLocal.height));
  }

  return `region-overlay?${params.toString()}`;
}

function finishRegionSelection(region: DesktopCaptureRegion | undefined): void {
  const session = regionSelection;
  if (!session || session.resolved) {
    return;
  }

  session.resolved = true;
  regionSelection = null;
  for (const overlay of session.windows) {
    if (!overlay.isDestroyed()) {
      overlay.close();
    }
  }
  session.resolve(region);
}

function openRecordingOverlay(config: RecordingOverlayConfig): boolean {
  closeRecordingOverlay();
  recordingOverlayState = config;

  if (config.surfaceVisible) {
    recordingSurfaceWindow = createRecordingSurfaceWindow(config);
  }
  if (config.toolbarVisible) {
    recordingOverlayWindow = createRecordingToolboxWindow(config);
  }
  bringRecordingToolboxToFront();
  return true;
}

function bringRecordingToolboxToFront(): void {
  if (!recordingOverlayWindow || recordingOverlayWindow.isDestroyed()) {
    return;
  }
  recordingOverlayWindow.setAlwaysOnTop(true, "screen-saver");
  recordingOverlayWindow.moveTop();
}

function createRecordingToolboxWindow(config: RecordingOverlayConfig): BrowserWindow {
  const overlay = new BrowserWindow({
    x: Math.round(config.bounds.x),
    y: Math.round(config.bounds.y),
    width: Math.max(300, Math.round(config.bounds.width)),
    height: Math.max(56, Math.round(config.bounds.height)),
    frame: false,
    transparent: false,
    backgroundColor: "#0f141e",
    hasShadow: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    show: true,
    title: "KikiRecorder Recording Overlay",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  overlay.setOpacity(clamp(config.toolboxOpacity, 0.35, 1));
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.webContents.once("did-finish-load", () => {
    if (!overlay.isDestroyed() && recordingOverlayState) {
      overlay.webContents.send("recording-overlay:update", recordingOverlayState);
    }
  });
  overlay.on("closed", () => {
    if (recordingOverlayWindow === overlay) {
      recordingOverlayWindow = null;
    }
  });
  overlay.webContents.on("console-message", (event, level, message, line, sourceId) => {
    console.log(`[OVERLAY] ${message} (${sourceId}:${line})`);
  });
  loadRenderer(overlay, "recording-overlay");
  return overlay;
}

function createRecordingSurfaceWindow(config: RecordingOverlayConfig): BrowserWindow {
  const surface = new BrowserWindow({
    x: Math.round(config.surfaceBounds.x),
    y: Math.round(config.surfaceBounds.y),
    width: Math.max(64, Math.round(config.surfaceBounds.width)),
    height: Math.max(64, Math.round(config.surfaceBounds.height)),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    title: "KikiRecorder Drawing Surface",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  surface.setContentProtection(true);
  surface.setAlwaysOnTop(true, "floating");
  surface.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (config.surfaceInteractive) {
    surface.setIgnoreMouseEvents(false);
  } else {
    surface.setIgnoreMouseEvents(true, { forward: true });
  }
  surface.once("ready-to-show", () => {
    if (!surface.isDestroyed()) {
      surface.showInactive();
      bringRecordingToolboxToFront();
    }
  });
  surface.webContents.once("did-finish-load", () => {
    if (!surface.isDestroyed() && recordingOverlayState) {
      surface.webContents.send("recording-overlay:update", recordingOverlayState);
    }
  });
  surface.on("closed", () => {
    if (recordingSurfaceWindow === surface) {
      recordingSurfaceWindow = null;
    }
  });
  loadRenderer(surface, "recording-surface");
  return surface;
}

function updateRecordingOverlay(config: RecordingOverlayConfig): boolean {
  if (!recordingOverlayState) {
    return false;
  }
  const previouslyHidden = recordingOverlayState.toolbarHidden;
  recordingOverlayState = config;

  if (!config.surfaceVisible) {
    if (recordingSurfaceWindow && !recordingSurfaceWindow.isDestroyed()) {
      recordingSurfaceWindow.close();
    }
    recordingSurfaceWindow = null;
  } else if (!recordingSurfaceWindow || recordingSurfaceWindow.isDestroyed()) {
    recordingSurfaceWindow = createRecordingSurfaceWindow(config);
  } else {
    const surfaceBounds = {
      x: Math.round(config.surfaceBounds.x),
      y: Math.round(config.surfaceBounds.y),
      width: Math.max(64, Math.round(config.surfaceBounds.width)),
      height: Math.max(64, Math.round(config.surfaceBounds.height))
    };
    const currentSurface = recordingSurfaceWindow.getBounds();
    if (
      currentSurface.x !== surfaceBounds.x ||
      currentSurface.y !== surfaceBounds.y ||
      currentSurface.width !== surfaceBounds.width ||
      currentSurface.height !== surfaceBounds.height
    ) {
      recordingSurfaceWindow.setBounds(surfaceBounds, false);
    }
    if (config.surfaceInteractive) {
      recordingSurfaceWindow.setIgnoreMouseEvents(false);
      recordingSurfaceWindow.focus();
    } else {
      recordingSurfaceWindow.setIgnoreMouseEvents(true, { forward: true });
    }
    recordingSurfaceWindow.webContents.send("recording-overlay:update", config);
    bringRecordingToolboxToFront();
  }

  if (!config.toolbarVisible) {
    if (recordingOverlayWindow && !recordingOverlayWindow.isDestroyed()) {
      recordingOverlayWindow.close();
    }
    recordingOverlayWindow = null;
    return true;
  }

  if (!recordingOverlayWindow || recordingOverlayWindow.isDestroyed()) {
    recordingOverlayWindow = createRecordingToolboxWindow(config);
    return true;
  }

  const current = recordingOverlayWindow.getBounds();

  
  let nextX = current.x;
  let nextY = current.y;

  if (config.toolbarHidden && !previouslyHidden) {
    savedToolbarPosition = { x: current.x, y: current.y };
    const display = screen.getDisplayMatching(current);
    nextY = display.bounds.y;
  } else if (!config.toolbarHidden && previouslyHidden) {
    if (savedToolbarPosition) {
      nextX = savedToolbarPosition.x;
      nextY = savedToolbarPosition.y;
    } else {
      nextX = Math.round(config.bounds.x);
      nextY = Math.round(config.bounds.y);
    }
  } else if (!recordingOverlayState) {
    nextX = Math.round(config.bounds.x);
    nextY = Math.round(config.bounds.y);
  }

  const nextBounds = {
    x: Math.round(nextX),
    y: Math.round(nextY),
    width: Math.max(config.toolbarHidden ? 8 : 48, Math.round(config.bounds.width)),
    height: Math.max(config.toolbarHidden ? 8 : 48, Math.round(config.bounds.height))
  };

  if (
    current.x !== nextBounds.x ||
    current.y !== nextBounds.y ||
    current.width !== nextBounds.width ||
    current.height !== nextBounds.height
  ) {
    recordingOverlayWindow.setBounds(nextBounds, false);
  }
  recordingOverlayWindow.setOpacity(clamp(config.toolboxOpacity, 0.35, 1));
  recordingOverlayWindow.webContents.send("recording-overlay:update", config);
  bringRecordingToolboxToFront();
  return true;
}

function closeRecordingOverlay(): boolean {
  recordingOverlayState = undefined;
  if (recordingOverlayWindow && !recordingOverlayWindow.isDestroyed()) {
    recordingOverlayWindow.close();
  }
  if (recordingSurfaceWindow && !recordingSurfaceWindow.isDestroyed()) {
    recordingSurfaceWindow.close();
  }
  recordingOverlayWindow = null;
  recordingSurfaceWindow = null;
  return true;
}

function normalizeRegion(region: DesktopCaptureRegion): DesktopCaptureRegion {
  const display = screen.getAllDisplays().find((item) => String(item.id) === String(region.displayId));
  if (!display) {
    return region;
  }

  const displayBounds = display.bounds;
  const localBounds = clampRect(
    {
      x: region.bounds.x - displayBounds.x,
      y: region.bounds.y - displayBounds.y,
      width: region.bounds.width,
      height: region.bounds.height
    },
    { x: 0, y: 0, width: displayBounds.width, height: displayBounds.height },
    64
  );
  const source = regionSelection?.sourceByDisplayId.get(String(display.id));

  return {
    displayId: String(display.id),
    displayLabel: display.label || region.displayLabel || `Display ${display.id}`,
    sourceId: source?.id ?? region.sourceId,
    sourceName: source?.name ?? region.sourceName,
    bounds: {
      x: Math.round(displayBounds.x + localBounds.x),
      y: Math.round(displayBounds.y + localBounds.y),
      width: Math.round(localBounds.width),
      height: Math.round(localBounds.height)
    },
    pixelBounds: {
      x: Math.round(localBounds.x * display.scaleFactor),
      y: Math.round(localBounds.y * display.scaleFactor),
      width: Math.round(localBounds.width * display.scaleFactor),
      height: Math.round(localBounds.height * display.scaleFactor)
    },
    scaleFactor: display.scaleFactor
  };
}

function clampRect(rect: Rect, bounds: Rect, minSize: number): Rect {
  const width = Math.min(bounds.width, Math.max(minSize, rect.width));
  const height = Math.min(bounds.height, Math.max(minSize, rect.height));
  return {
    x: Math.round(clamp(rect.x, bounds.x, bounds.x + bounds.width - width)),
    y: Math.round(clamp(rect.y, bounds.y, bounds.y + bounds.height - height)),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function registerHotkeys(): void {
  globalShortcut.unregisterAll();
  const hotkeys = getSettings().hotkeys;
  const entries: Array<[string, string]> = [
    ["hotkey:start-stop", hotkeys.startStop],
    ["hotkey:pause-resume", hotkeys.pauseResume],
    ["hotkey:screenshot", hotkeys.screenshot],
    ["hotkey:toggle-toolbar", hotkeys.toggleToolbar]
  ];

  for (const [eventName, accelerator] of entries) {
    if (!accelerator) {
      continue;
    }
    try {
      globalShortcut.register(accelerator, () => {
        mainWindow?.webContents.send("hotkey", eventName);
      });
    } catch {
      // Invalid custom accelerators are ignored and can be fixed in Settings.
    }
  }
}

function restoreSchedules(): void {
  for (const item of listSchedules()) {
    armSchedule(item);
  }
}

function armSchedule(item: ScheduleItem): void {
  const startsAt = new Date(item.startsAt).getTime();
  const delay = startsAt - Date.now();
  if (delay <= 0) {
    return;
  }

  const existing = scheduleTimers.get(item.id);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    mainWindow?.webContents.send("schedule:start", item);
    scheduleTimers.delete(item.id);
  }, delay);
  scheduleTimers.set(item.id, timer);
}

function ipc(): void {
  ipcMain.handle("app:platform", () => process.platform);
  ipcMain.handle("app:ffmpeg-path", () => getFfmpegPath());
  ipcMain.handle("display:list", () => displayInfo());
  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:save", (_event, next) => {
    const saved = saveSettings(next);
    nativeTheme.themeSource = saved.theme === "system" ? "system" : saved.theme;
    registerHotkeys();
    return saved;
  });

  ipcMain.handle("capture:prepare", (_event, options: CapturePrepareOptions) => {
    captureOptions = options;
    installDisplayMediaHandler();
    return true;
  });

  ipcMain.handle("region:select", async (_event, initialRegion?: DesktopCaptureRegion, preferredSourceId?: string) =>
    selectDesktopRegion(initialRegion, preferredSourceId)
  );
  ipcMain.handle("region:complete", (_event, region: DesktopCaptureRegion) => {
    const normalized = normalizeRegion(region);
    finishRegionSelection(normalized);
    return normalized;
  });
  ipcMain.handle("region:cancel", () => {
    finishRegionSelection(undefined);
    return true;
  });

  ipcMain.handle("recording-overlay:open", (_event, config: RecordingOverlayConfig) =>
    openRecordingOverlay(config)
  );
  ipcMain.handle("recording-overlay:update", (_event, config: RecordingOverlayConfig) =>
    updateRecordingOverlay(config)
  );
  ipcMain.handle("recording-overlay:close", () => closeRecordingOverlay());
  ipcMain.handle("recording-overlay:get-state", () => recordingOverlayState);
  ipcMain.on("recording-overlay:event", (_event, overlayEvent: RecordingOverlayEvent) => {
    mainWindow?.webContents.send("recording-overlay:event", overlayEvent);
  });

  ipcMain.handle("sources:list", async (_event, types: Array<"screen" | "window"> = ["screen", "window"]) => {
    const sources = await desktopCapturer.getSources({
      types,
      thumbnailSize: { width: 420, height: 260 },
      fetchWindowIcons: true
    });

    return sources.map<CaptureSource>((source) => ({
      id: source.id,
      name: source.name,
      type: source.id.startsWith("screen:") ? "screen" : "window",
      thumbnail: source.thumbnail.toDataURL(),
      appIcon: source.appIcon?.toDataURL() ?? null,
      displayId: source.display_id
    }));
  });
  // ─── Real-time ffmpeg pipe recording ───────────────────────────
  ipcMain.handle("recording:start-pipe", (_event, options: { fileName?: string; fps?: number }) => {
    return startPipe(options);
  });

  ipcMain.on("recording:write-chunk", (_event, data: ArrayBuffer) => {
    try {
      writeChunk(data);
    } catch (err) {
      // Suppress write errors — pipe may have closed
      console.warn("[recording:write-chunk] write error suppressed:", err);
    }
  });

  ipcMain.handle("recording:finish-pipe", async () => {
    return finishPipe();
  });

  ipcMain.handle("recording:cancel-pipe", () => {
    cancelPipe();
    return true;
  });

  ipcMain.handle("recording:save", async (_event, request: SaveRecordingRequest): Promise<LibraryItem> => {
    const dir = getRecordingsDir();
    ensureDir(dir);
    const id = crypto.randomUUID();
    const fileName = sanitizeFileName(request.fileName || `Recording-${id}`) || `Recording-${id}`;

    // Fast path: file was already written by ffmpeg pipe
    if (request.pipePath && fs.existsSync(request.pipePath)) {
      const stat = fs.statSync(request.pipePath);
      const item: LibraryItem = {
        ...request.metadata,
        id,
        path: request.pipePath,
        format: "mp4",
        bytes: stat.size,
        createdAt: new Date().toISOString()
      };
      return addLibraryItem(item);
    }

    const outputFormat = request.outputFormat ?? "mp4";
    const inputExtension = request.extension || "webm";
    const data = recordingDataBuffer(request.data);
    if (data.byteLength === 0) {
      throw new Error("Recording save failed: video data is empty.");
    }
    const tempInputPath = outputFormat === "mp4"
      ? path.join(dir, `${fileName}-${id}.source.${inputExtension}`)
      : uniqueOutputPath(dir, fileName, inputExtension);
    fs.writeFileSync(tempInputPath, data);

    let outputPath = tempInputPath;
    let extension = inputExtension;
    let conversionError: string | undefined;

    if (outputFormat === "mp4") {
      const mp4Path = uniqueOutputPath(dir, fileName, "mp4");
      try {
        outputPath = await runFfmpeg(
          id,
          {
            inputPath: tempInputPath,
            outputPath: mp4Path,
            format: "mp4",
            codec: "h264",
            quality: "high",
            fps: request.metadata.fps
          },
          () => undefined
        );
        extension = "mp4";
        safeUnlink(tempInputPath);
      } catch (cause) {
        conversionError = cause instanceof Error ? cause.message : String(cause);
        const fallbackPath = uniqueOutputPath(dir, `${fileName}-${id}`, "webm");
        if (fs.existsSync(tempInputPath)) {
          fs.renameSync(tempInputPath, fallbackPath);
        } else {
          fs.writeFileSync(fallbackPath, data);
        }
        outputPath = fallbackPath;
        extension = "webm";
      }
    }

    const stat = fs.statSync(outputPath);
    const item: LibraryItem = {
      ...request.metadata,
      id,
      path: outputPath,
      format: extension,
      bytes: stat.size,
      createdAt: new Date().toISOString(),
      conversionError
    };
    return addLibraryItem(item);
  });

  ipcMain.handle("screenshot:save", (_event, request: SaveScreenshotRequest) => {
    const dir = getScreenshotsDir();
    ensureDir(dir);
    const id = crypto.randomUUID();
    const fileName = sanitizeFileName(request.fileName || `Screenshot-${id}`);
    const outputPath = path.join(dir, `${fileName}.png`);
    const base64 = request.dataUrl.replace(/^data:image\/png;base64,/, "");
    fs.writeFileSync(outputPath, Buffer.from(base64, "base64"));
    return {
      id,
      path: outputPath,
      width: request.width,
      height: request.height,
      createdAt: new Date().toISOString()
    };
  });

  ipcMain.handle("library:list", () => listLibrary());
  ipcMain.handle("library:remove", (_event, id: string, deleteFile: boolean) => {
    const item = listLibrary().find((entry) => entry.id === id);
    removeLibraryItem(id);
    if (deleteFile && item) {
      safeUnlink(item.path);
    }
    return listLibrary();
  });
  ipcMain.handle("library:reveal", (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
    return true;
  });
  ipcMain.handle("dialog:pick-file", async (_event, filters?: Electron.FileFilter[]) => {
    const options: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      filters
    };
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("dialog:pick-directory", async () => {
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"]
    };
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("dialog:save-export", async (_event, defaultPath: string) => {
    const options: Electron.SaveDialogOptions = {
      defaultPath
    };
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    return result.canceled ? undefined : result.filePath;
  });

  ipcMain.handle("export:run", async (event, job: ExportJob) => {
    const jobId = crypto.randomUUID();
    const outputPath = await runFfmpeg(jobId, job, (progress) => {
      event.sender.send("export:progress", progress);
    });
    return outputPath;
  });

  ipcMain.handle("schedule:list", () => listSchedules());
  ipcMain.handle("schedule:add", (_event, item: Omit<ScheduleItem, "id" | "createdAt">) => {
    const saved = addSchedule({
      ...item,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    });
    armSchedule(saved);
    return saved;
  });
  ipcMain.handle("schedule:remove", (_event, id: string) => {
    const timer = scheduleTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      scheduleTimers.delete(id);
    }
    removeSchedule(id);
    return listSchedules();
  });

  ipcMain.handle("permissions:check", () => {
    if (process.platform !== "darwin") {
      return { screen: "granted", camera: "prompt", microphone: "prompt" };
    }
    return {
      screen: systemPreferences.getMediaAccessStatus("screen"),
      camera: systemPreferences.getMediaAccessStatus("camera"),
      microphone: systemPreferences.getMediaAccessStatus("microphone")
    };
  });

  ipcMain.handle("window:always-on-top", (_event, enabled: boolean) => {
    mainWindow?.setAlwaysOnTop(enabled, "floating");
    return enabled;
  });
}

app.whenReady().then(() => {
  nativeTheme.themeSource = getSettings().theme === "system" ? "system" : getSettings().theme;
  installDisplayMediaHandler();
  ipc();
  createWindow();
  registerHotkeys();
  restoreSchedules();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  closeRecordingOverlay();
  finishRegionSelection(undefined);
  globalShortcut.unregisterAll();
  for (const timer of scheduleTimers.values()) {
    clearTimeout(timer);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function recordingDataBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data && typeof data === "object") {
    const maybeSerialized = data as { data?: unknown };
    if (Array.isArray(maybeSerialized.data)) {
      return Buffer.from(maybeSerialized.data);
    }
  }
  throw new Error("Recording save failed: unsupported video data format.");
}

function uniqueOutputPath(dir: string, baseName: string, extension: string): string {
  const safeBase = sanitizeFileName(baseName) || "Recording";
  const safeExtension = extension.replace(/^\./, "");
  let candidate = path.join(dir, `${safeBase}.${safeExtension}`);
  for (let index = 1; fs.existsSync(candidate); index += 1) {
    candidate = path.join(dir, `${safeBase}-${index}.${safeExtension}`);
  }
  return candidate;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
