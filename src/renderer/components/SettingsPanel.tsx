import { FolderOpen, Keyboard, Languages, Moon, Sun } from "lucide-react";
import { AppSettings } from "../../shared/types";
import { useI18n } from "../i18n";

type Props = {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
};

export function SettingsPanel({ settings, onSave }: Props) {
  const text = useI18n();

  function patch(next: Partial<AppSettings>): void {
    onSave({ ...settings, ...next });
  }

  return (
    <div className="workspacePanel narrow">
      <div className="workspaceHeader">
        <div>
          <h2>{text.settingsTitle}</h2>
          <p>{text.settingsSubtitle}</p>
        </div>
      </div>

      <section className="panelSection">
        <h3><Languages size={16} /> {text.language}</h3>
        <select
          value={settings.language}
          onChange={(event) => patch({ language: event.target.value as AppSettings["language"] })}
        >
          <option value="en">{text.english}</option>
          <option value="vi">{text.vietnamese}</option>
        </select>
      </section>

      <section className="panelSection">
        <h3>{text.theme}</h3>
        <div className="segmented fixed">
          <button className={settings.theme === "dark" ? "selected" : ""} onClick={() => patch({ theme: "dark" })}>
            <Moon size={16} />
            {text.dark}
          </button>
          <button className={settings.theme === "light" ? "selected" : ""} onClick={() => patch({ theme: "light" })}>
            <Sun size={16} />
            {text.light}
          </button>
          <button className={settings.theme === "system" ? "selected" : ""} onClick={() => patch({ theme: "system" })}>
            {text.system}
          </button>
        </div>
      </section>

      <section className="panelSection">
        <h3>{text.localFolders}</h3>
        <button
          className="secondaryButton"
          onClick={async () => {
            const dir = await window.kiki.pickDirectory();
            if (dir) {
              patch({ recordingsDir: dir });
            }
          }}
        >
          <FolderOpen size={16} />
          {text.recordingsFolder}
        </button>
        {settings.recordingsDir ? <span className="fileHint">{settings.recordingsDir}</span> : null}
        <button
          className="secondaryButton"
          onClick={async () => {
            const dir = await window.kiki.pickDirectory();
            if (dir) {
              patch({ screenshotsDir: dir });
            }
          }}
        >
          <FolderOpen size={16} />
          {text.screenshotsFolder}
        </button>
        {settings.screenshotsDir ? <span className="fileHint">{settings.screenshotsDir}</span> : null}
      </section>

      <section className="panelSection">
        <h3><Keyboard size={16} /> {text.hotkeys}</h3>
        {Object.entries(settings.hotkeys).map(([key, value]) => (
          <label key={key}>
            <span>{hotkeyLabel(key, text)}</span>
            <input
              value={value}
              onChange={(event) => patch({ hotkeys: { ...settings.hotkeys, [key]: event.target.value } })}
            />
          </label>
        ))}
      </section>

      <section className="subtleSection">
        {text.privacyNote}
      </section>
    </div>
  );
}

function hotkeyLabel(key: string, text: ReturnType<typeof useI18n>): string {
  switch (key) {
    case "startStop":
      return text.hotkeyStartStop;
    case "pauseResume":
      return text.hotkeyPauseResume;
    case "screenshot":
      return text.hotkeyScreenshot;
    case "pushToTalk":
      return text.hotkeyPushToTalk;
    case "toggleToolbar":
      return text.hotkeyToggleToolbar;
    default:
      return key.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
  }
}
