import {
  Camera,
  Clock,
  Crosshair,
  Monitor,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  Square,
  Volume2
} from "lucide-react";
import type { ComponentType } from "react";
import { CaptureSource, RecordingSettings, Rect } from "../../shared/types";
import { qualityPresets } from "../defaults";
import { useI18n } from "../i18n";

type Props = {
  settings: RecordingSettings;
  sources: CaptureSource[];
  state: string;
  elapsed: number;
  countdown: number;
  onSettings: (settings: RecordingSettings) => void;
  onRefreshSources: () => void;
  onSelectRegion: () => void;
  onStart: () => void;
  onPauseResume: () => void;
  onStop: () => void;
  onRestart: () => void;
  onScreenshot: () => void;
};

export function RecorderPanel({
  settings,
  sources,
  state,
  elapsed,
  countdown,
  onSettings,
  onRefreshSources,
  onSelectRegion,
  onStart,
  onPauseResume,
  onStop,
  onRestart,
  onScreenshot
}: Props) {
  const text = useI18n();
  const isStarting = state === "preparing";
  const sourceType = settings.mode === "window" ? "window" : "screen";
  const visibleSources = sources.filter((source) => source.type === sourceType);
  const modes: Array<{ mode: RecordingSettings["mode"]; icon: ComponentType<{ size?: number }>; label: string }> = [
    { mode: "fullscreen", icon: Monitor, label: text.modeScreen },
    { mode: "area", icon: Scissors, label: text.modeArea },
    { mode: "window", icon: Square, label: text.modeWindow },
    { mode: "webcam", icon: Camera, label: text.modeWebcam }
  ];

  function patch(next: Partial<RecordingSettings>): void {
    onSettings({ ...settings, ...next });
  }

  function changeMode(mode: RecordingSettings["mode"]): void {
    patch({
      mode,
      ...(mode !== "area" ? { captureArea: undefined, captureRegion: undefined } : {})
    });
  }

  function patchArea(next: Partial<Rect>): void {
    patch({
      captureRegion: undefined,
      captureArea: {
        ...(settings.captureArea ?? { x: 0, y: 0, width: 1280, height: 720 }),
        ...next
      }
    });
  }

  return (
    <aside className="sidePanel">
      <div className="panelHeader">
        <div>
          <h2>{text.recorderTitle}</h2>
          <p>{state === "countdown" ? `${text.startingIn} ${countdown}` : formatElapsed(elapsed)}</p>
        </div>
        <button className="iconButton" onClick={onRefreshSources} title={text.refreshSources} aria-label={text.refreshSources}>
          <RefreshCw size={18} />
        </button>
      </div>

      <section className="panelSection">
        <h3>{text.mode}</h3>
        <div className="segmented">
          {modes.map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              className={settings.mode === mode ? "selected" : ""}
              onClick={() => changeMode(mode)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </section>

      {settings.mode !== "webcam" ? (
        <section className="panelSection">
          <h3>{text.source}</h3>
          <select
            value={settings.sourceId ?? ""}
            onChange={(event) => {
              const source = sources.find((candidate) => candidate.id === event.target.value);
              patch({
                sourceId: source?.id,
                sourceName: source?.name,
                ...(settings.mode === "area" ? { captureArea: undefined, captureRegion: undefined } : {})
              });
            }}
          >
            <option value="">{text.useSystemDefault}</option>
            {visibleSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
          <div className="sourceGrid">
            {visibleSources.slice(0, 4).map((source) => (
              <button
                key={source.id}
                className={`sourceTile ${settings.sourceId === source.id ? "active" : ""}`}
                onClick={() =>
                  patch({
                    sourceId: source.id,
                    sourceName: source.name,
                    ...(settings.mode === "area" ? { captureArea: undefined, captureRegion: undefined } : {})
                  })
                }
              >
                <img src={source.thumbnail} alt="" />
                <span>{source.name}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {settings.mode === "area" ? (
        <section className="panelSection">
          <h3>{text.captureArea}</h3>
          <button className="secondaryButton" onClick={onSelectRegion} disabled={state !== "idle"}>
            <Crosshair size={18} />
            {text.selectDesktopArea}
          </button>
          <p className="fieldHint">
            {settings.captureRegion?.displayLabel
              ? `${text.selectedDisplay}: ${settings.captureRegion.displayLabel}`
              : text.noAreaSelected}
          </p>
          <div className="gridTwo">
            {(["x", "y", "width", "height"] as const).map((field) => (
              <label key={field}>
                <span>{field}</span>
                <input
                  type="number"
                  min={0}
                  value={Math.round(settings.captureArea?.[field] ?? (field === "width" ? 1280 : field === "height" ? 720 : 0))}
                  onChange={(event) => patchArea({ [field]: Number(event.target.value) })}
                />
              </label>
            ))}
          </div>
          <p className="fieldHint">{text.areaPixelHint}</p>
        </section>
      ) : null}

      <section className="panelSection">
        <h3>{text.quality}</h3>
        <div className="gridTwo">
          <label>
            <span>{text.preset}</span>
            <select
              value={settings.quality.label}
              onChange={(event) => {
                const quality = qualityPresets.find((preset) => preset.label === event.target.value) ?? qualityPresets[4];
                patch({ quality });
              }}
            >
              {qualityPresets.map((preset) => (
                <option key={preset.label} value={preset.label}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{text.outputFormat}</span>
            <select
              value={settings.outputFormat ?? "mp4"}
              onChange={(event) => patch({ outputFormat: event.target.value as "mp4" | "webm" })}
            >
              <option value="mp4">MP4</option>
              <option value="webm">WEBM</option>
            </select>
          </label>
          <label>
            <span>{text.fps}</span>
            <select
              value={settings.quality.fps}
              onChange={(event) => patch({ quality: { ...settings.quality, fps: Number(event.target.value) as 30 | 60 } })}
            >
              <option value={30}>30</option>
              <option value={60}>60</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panelSection">
        <h3>{text.audio}</h3>
        <label className="switchRow">
          <Volume2 size={17} />
          <span>{text.systemAudio}</span>
          <input
            type="checkbox"
            checked={settings.audio.system}
            onChange={(event) => patch({ audio: { ...settings.audio, system: event.target.checked } })}
          />
        </label>
        <label className="switchRow">
          <span>{text.microphone}</span>
          <input
            type="checkbox"
            checked={settings.audio.microphone}
            onChange={(event) => patch({ audio: { ...settings.audio, microphone: event.target.checked } })}
          />
        </label>
        <label className="switchRow">
          <span>{text.pushToTalk}</span>
          <input
            type="checkbox"
            checked={settings.audio.pushToTalk}
            onChange={(event) => patch({ audio: { ...settings.audio, pushToTalk: event.target.checked } })}
          />
        </label>
      </section>

      <section className="panelSection">
        <h3>{text.webcam}</h3>
        <label className="switchRow">
          <span>{text.overlay}</span>
          <input
            type="checkbox"
            checked={settings.webcam.enabled || settings.mode === "webcam"}
            onChange={(event) => patch({ webcam: { ...settings.webcam, enabled: event.target.checked } })}
          />
        </label>
        <div className="gridTwo">
          <label>
            <span>{text.shape}</span>
            <select
              value={settings.webcam.shape}
              onChange={(event) => patch({ webcam: { ...settings.webcam, shape: event.target.value as "rectangle" | "circle" } })}
            >
              <option value="circle">{text.circle}</option>
              <option value="rectangle">{text.rectangle}</option>
            </select>
          </label>
          <label>
            <span>{text.background}</span>
            <select
              value={settings.webcam.backgroundEffect}
              onChange={(event) => patch({ webcam: { ...settings.webcam, backgroundEffect: event.target.value as RecordingSettings["webcam"]["backgroundEffect"] } })}
            >
              <option value="none">{text.none}</option>
              <option value="blur">{text.blur}</option>
              <option value="virtual">{text.virtual}</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panelSection">
        <h3>{text.timers}</h3>
        <div className="gridTwo">
          <label>
            <span>{text.countdown}</span>
            <input
              type="number"
              min={0}
              max={30}
              value={settings.countdownSeconds}
              onChange={(event) => patch({ countdownSeconds: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>{text.autoStop}</span>
            <input
              type="number"
              min={0}
              value={settings.autoStopMinutes}
              onChange={(event) => patch({ autoStopMinutes: Number(event.target.value) })}
            />
          </label>
        </div>
      </section>

      <div className="recordButtons">
        {state === "idle" || isStarting ? (
          <button className="primaryButton" onClick={onStart} disabled={isStarting}>
            <Play size={18} />
            {isStarting ? `${text.start}...` : text.start}
          </button>
        ) : (
          <button className="dangerButton" onClick={onStop}>
            <Save size={18} />
            {text.stop}
          </button>
        )}
        <button className="secondaryButton" onClick={onPauseResume} disabled={state === "idle" || state === "countdown"}>
          <Pause size={18} />
          {state === "paused" ? text.resume : text.pause}
        </button>
        <button className="secondaryButton" onClick={onRestart} disabled={state === "idle"}>
          <RotateCcw size={18} />
          {text.restart}
        </button>
        <button className="secondaryButton" onClick={onScreenshot}>
          <Clock size={18} />
          {text.screenshot}
        </button>
      </div>
    </aside>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}
