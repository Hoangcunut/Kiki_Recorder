import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getUserDataPath(...parts: string[]): string {
  return path.join(app.getPath("userData"), ...parts);
}

export function getDefaultRecordingsDir(): string {
  return ensureDir(path.join(app.getPath("videos"), "KikiRecorder"));
}

export function getDefaultScreenshotsDir(): string {
  return ensureDir(path.join(app.getPath("pictures"), "KikiRecorder"));
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}
