import { contextBridge, ipcRenderer } from "electron";
import {
  AppSettings,
  CapturePrepareOptions,
  CaptureSource,
  CaptureSourceType,
  DesktopCaptureRegion,
  DisplayInfo,
  ExportJob,
  ExportProgress,
  LibraryItem,
  PlatformName,
  RecordingOverlayConfig,
  RecordingOverlayEvent,
  SaveRecordingRequest,
  SaveScreenshotRequest,
  ScheduleItem
} from "../shared/types";

const api = {
  platform: (): Promise<PlatformName> => ipcRenderer.invoke("app:platform"),
  ffmpegPath: (): Promise<string> => ipcRenderer.invoke("app:ffmpeg-path"),
  listDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke("display:list"),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke("settings:save", settings),
  prepareCapture: (options: CapturePrepareOptions): Promise<boolean> =>
    ipcRenderer.invoke("capture:prepare", options),
  selectRegion: (initialRegion?: DesktopCaptureRegion, preferredSourceId?: string): Promise<DesktopCaptureRegion | undefined> =>
    ipcRenderer.invoke("region:select", initialRegion, preferredSourceId),
  completeRegionSelection: (region: DesktopCaptureRegion): Promise<DesktopCaptureRegion | undefined> =>
    ipcRenderer.invoke("region:complete", region),
  cancelRegionSelection: (): Promise<boolean> => ipcRenderer.invoke("region:cancel"),
  openRecordingOverlay: (config: RecordingOverlayConfig): Promise<boolean> =>
    ipcRenderer.invoke("recording-overlay:open", config),
  updateRecordingOverlay: (config: RecordingOverlayConfig): Promise<boolean> =>
    ipcRenderer.invoke("recording-overlay:update", config),
  closeRecordingOverlay: (): Promise<boolean> => ipcRenderer.invoke("recording-overlay:close"),
  getRecordingOverlayState: (): Promise<RecordingOverlayConfig | undefined> =>
    ipcRenderer.invoke("recording-overlay:get-state"),
  sendRecordingOverlayEvent: (event: RecordingOverlayEvent): void =>
    ipcRenderer.send("recording-overlay:event", event),
  listSources: (types: CaptureSourceType[]): Promise<CaptureSource[]> => ipcRenderer.invoke("sources:list", types),
  startRecordingPipe: (options: { fileName?: string; fps?: number }): Promise<{ id: string; outputPath: string }> =>
    ipcRenderer.invoke("recording:start-pipe", options),
  writeRecordingChunk: (data: ArrayBuffer): void =>
    ipcRenderer.send("recording:write-chunk", data),
  finishRecordingPipe: (): Promise<{ outputPath: string; bytesWritten: number; durationMs: number } | null> =>
    ipcRenderer.invoke("recording:finish-pipe"),
  cancelRecordingPipe: (): Promise<boolean> =>
    ipcRenderer.invoke("recording:cancel-pipe"),
  saveRecording: (request: SaveRecordingRequest): Promise<LibraryItem> =>
    ipcRenderer.invoke("recording:save", request),
  saveScreenshot: (request: SaveScreenshotRequest) => ipcRenderer.invoke("screenshot:save", request),
  listLibrary: (): Promise<LibraryItem[]> => ipcRenderer.invoke("library:list"),
  removeLibraryItem: (id: string, deleteFile: boolean): Promise<LibraryItem[]> =>
    ipcRenderer.invoke("library:remove", id, deleteFile),
  revealPath: (filePath: string): Promise<boolean> => ipcRenderer.invoke("library:reveal", filePath),
  pickFile: (filters?: Electron.FileFilter[]): Promise<string | undefined> =>
    ipcRenderer.invoke("dialog:pick-file", filters),
  pickDirectory: (): Promise<string | undefined> => ipcRenderer.invoke("dialog:pick-directory"),
  pickExportPath: (defaultPath: string): Promise<string | undefined> =>
    ipcRenderer.invoke("dialog:save-export", defaultPath),
  runExport: (job: ExportJob): Promise<string> => ipcRenderer.invoke("export:run", job),
  listSchedules: (): Promise<ScheduleItem[]> => ipcRenderer.invoke("schedule:list"),
  addSchedule: (item: Omit<ScheduleItem, "id" | "createdAt">): Promise<ScheduleItem> =>
    ipcRenderer.invoke("schedule:add", item),
  removeSchedule: (id: string): Promise<ScheduleItem[]> => ipcRenderer.invoke("schedule:remove", id),
  checkPermissions: () => ipcRenderer.invoke("permissions:check"),
  setAlwaysOnTop: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke("window:always-on-top", enabled),
  onHotkey: (callback: (eventName: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, eventName: string) => callback(eventName);
    ipcRenderer.on("hotkey", listener);
    return () => {
      ipcRenderer.removeListener("hotkey", listener);
    };
  },
  onRecordingOverlayEvent: (callback: (event: RecordingOverlayEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, overlayEvent: RecordingOverlayEvent) => callback(overlayEvent);
    ipcRenderer.on("recording-overlay:event", listener);
    return () => {
      ipcRenderer.removeListener("recording-overlay:event", listener);
    };
  },
  onRecordingOverlayUpdate: (callback: (config: RecordingOverlayConfig) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, config: RecordingOverlayConfig) => callback(config);
    ipcRenderer.on("recording-overlay:update", listener);
    return () => {
      ipcRenderer.removeListener("recording-overlay:update", listener);
    };
  },
  onScheduleStart: (callback: (item: ScheduleItem) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, item: ScheduleItem) => callback(item);
    ipcRenderer.on("schedule:start", listener);
    return () => {
      ipcRenderer.removeListener("schedule:start", listener);
    };
  },
  onExportProgress: (callback: (progress: ExportProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ExportProgress) => callback(progress);
    ipcRenderer.on("export:progress", listener);
    return () => {
      ipcRenderer.removeListener("export:progress", listener);
    };
  }
};

contextBridge.exposeInMainWorld("kiki", api);

export type KikiApi = typeof api;
