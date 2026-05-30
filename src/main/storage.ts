import fs from "node:fs";
import path from "node:path";
import {
  AppSettings,
  HotkeySettings,
  LibraryItem,
  ScheduleItem
} from "../shared/types";
import {
  ensureDir,
  getDefaultRecordingsDir,
  getDefaultScreenshotsDir,
  getUserDataPath
} from "./paths";

type StoreShape = {
  settings: AppSettings;
  library: LibraryItem[];
  schedules: ScheduleItem[];
};

const defaultHotkeys: HotkeySettings = {
  startStop: "CommandOrControl+Shift+R",
  pauseResume: "CommandOrControl+Shift+P",
  screenshot: "CommandOrControl+Shift+S",
  pushToTalk: "Space",
  toggleToolbar: "CommandOrControl+Shift+T"
};

const defaults: StoreShape = {
  settings: {
    theme: "dark",
    language: "en",
    recordingsDir: undefined,
    screenshotsDir: undefined,
    toolboxOpacity: 0.92,
    hotkeys: defaultHotkeys
  },
  library: [],
  schedules: []
};

function storeFile(): string {
  ensureDir(getUserDataPath());
  return getUserDataPath("kiki-store.json");
}

function readStore(): StoreShape {
  const file = storeFile();
  if (!fs.existsSync(file)) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<StoreShape>;
    return {
      settings: {
        ...defaults.settings,
        ...(parsed.settings ?? {}),
        hotkeys: {
          ...defaults.settings.hotkeys,
          ...(parsed.settings?.hotkeys ?? {})
        }
      },
      library: parsed.library ?? [],
      schedules: parsed.schedules ?? []
    };
  } catch {
    return defaults;
  }
}

function writeStore(next: StoreShape): void {
  fs.writeFileSync(storeFile(), JSON.stringify(next, null, 2));
}

export function getSettings(): AppSettings {
  return readStore().settings;
}

export function saveSettings(settings: AppSettings): AppSettings {
  const store = readStore();
  store.settings = {
    ...store.settings,
    ...settings,
    hotkeys: {
      ...store.settings.hotkeys,
      ...settings.hotkeys
    }
  };
  writeStore(store);
  return store.settings;
}

export function getRecordingsDir(): string {
  return ensureDir(getSettings().recordingsDir || getDefaultRecordingsDir());
}

export function getScreenshotsDir(): string {
  return ensureDir(getSettings().screenshotsDir || getDefaultScreenshotsDir());
}

export function listLibrary(): LibraryItem[] {
  return readStore().library.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addLibraryItem(item: LibraryItem): LibraryItem {
  const store = readStore();
  store.library = [item, ...store.library.filter((existing) => existing.id !== item.id)];
  writeStore(store);
  return item;
}

export function removeLibraryItem(id: string): void {
  const store = readStore();
  store.library = store.library.filter((item) => item.id !== id);
  writeStore(store);
}

export function listSchedules(): ScheduleItem[] {
  return readStore().schedules.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function addSchedule(item: ScheduleItem): ScheduleItem {
  const store = readStore();
  store.schedules = [item, ...store.schedules.filter((existing) => existing.id !== item.id)];
  writeStore(store);
  return item;
}

export function removeSchedule(id: string): void {
  const store = readStore();
  store.schedules = store.schedules.filter((item) => item.id !== id);
  writeStore(store);
}

export function safeUnlink(filePath: string): void {
  if (!filePath) {
    return;
  }
  const resolved = path.resolve(filePath);
  const allowedRoots = [
    path.resolve(getRecordingsDir()),
    path.resolve(getScreenshotsDir()),
    path.resolve(getUserDataPath())
  ];
  if (allowedRoots.some((root) => resolved.startsWith(root))) {
    fs.rmSync(resolved, { force: true });
  }
}
