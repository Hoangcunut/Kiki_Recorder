import { useEffect, useMemo, useState } from "react";
import { Download, FolderOpen, Music, Scissors, Shield, Upload } from "lucide-react";
import { ExportFormat, ExportJob, ExportProgress, LibraryItem, Rect, VideoCodec } from "../../shared/types";
import { useI18n } from "../i18n";

type Props = {
  items: LibraryItem[];
  selected?: LibraryItem;
  onSelect: (item: LibraryItem | undefined) => void;
};

export function EditorPanel({ items, selected, onSelect }: Props) {
  const text = useI18n();
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const [codec, setCodec] = useState<VideoCodec>("h264");
  const [speed, setSpeed] = useState(1);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [mute, setMute] = useState(false);
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const [extraAudioPath, setExtraAudioPath] = useState<string | undefined>();
  const [watermarkPath, setWatermarkPath] = useState<string | undefined>();
  const [progress, setProgress] = useState<ExportProgress | undefined>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | undefined>();

  useEffect(() => {
    return window.kiki.onExportProgress(setProgress);
  }, []);

  const defaultExportName = useMemo(() => {
    if (!selected) {
      return `KikiRecorder-export.${format}`;
    }
    return `${selected.title.replace(/[<>:"/\\|?*]/g, "-")}.${format}`;
  }, [format, selected]);

  async function runExport(): Promise<void> {
    if (!selected) {
      return;
    }
    setBusy(true);
    setResult(undefined);
    try {
      const outputPath = await window.kiki.pickExportPath(defaultExportName);
      const job: ExportJob = {
        inputPath: selected.path,
        outputPath,
        format,
        codec,
        quality: "high",
        startSeconds: start > 0 ? start : undefined,
        endSeconds: end > 0 ? end : undefined,
        crop: crop.width > 0 && crop.height > 0 ? crop : undefined,
        playbackSpeed: speed,
        muteAudio: mute,
        extraAudioPath,
        watermarkPath,
        watermarkOpacity: 0.75
      };
      const exported = await window.kiki.runExport(job);
      setResult(exported);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspacePanel">
      <div className="workspaceHeader">
        <div>
          <h2>{text.editorTitle}</h2>
          <p>{text.editorSubtitle}</p>
        </div>
      </div>

      <div className="editorLayout">
        <section className="editorMedia">
          {selected ? (
            <video src={fileUrl(selected.path)} controls />
          ) : (
            <div className="emptyStage small">
              <strong>{text.noRecordingSelected}</strong>
              <span>{text.pickRecordingHint}</span>
            </div>
          )}
          {selected ? (
            <div className="selectedPath">{selected.path}</div>
          ) : null}
        </section>

        <section className="editorControls">
          <label>
            <span>{text.recording}</span>
            <select
              value={selected?.id ?? ""}
              onChange={(event) => onSelect(items.find((item) => item.id === event.target.value))}
            >
              <option value="">{text.selectRecording}</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>

          <div className="controlBlock">
            <h3><Scissors size={16} /> {text.timeline}</h3>
            <div className="gridTwo">
              <label>
                <span>{text.startSec}</span>
                <input type="number" min={0} value={start} onChange={(event) => setStart(Number(event.target.value))} />
              </label>
              <label>
                <span>{text.endSec}</span>
                <input type="number" min={0} value={end} onChange={(event) => setEnd(Number(event.target.value))} />
              </label>
            </div>
            <label>
              <span>{text.playbackSpeed} {speed.toFixed(2)}x</span>
              <input type="range" min={0.25} max={4} step={0.25} value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
            </label>
          </div>

          <div className="controlBlock">
            <h3>{text.crop}</h3>
            <div className="gridTwo">
              {(["x", "y", "width", "height"] as const).map((field) => (
                <label key={field}>
                  <span>{field}</span>
                  <input type="number" min={0} value={crop[field]} onChange={(event) => setCrop({ ...crop, [field]: Number(event.target.value) })} />
                </label>
              ))}
            </div>
          </div>

          <div className="controlBlock">
            <h3><Music size={16} /> {text.audio}</h3>
            <label className="switchRow">
              <span>{text.muteOriginal}</span>
              <input type="checkbox" checked={mute} onChange={(event) => setMute(event.target.checked)} />
            </label>
            <button
              className="secondaryButton"
              onClick={async () => setExtraAudioPath(await window.kiki.pickFile([{ name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg"] }]))}
            >
              <Upload size={16} />
              {text.addAudio}
            </button>
            {extraAudioPath ? <span className="fileHint">{extraAudioPath}</span> : null}
          </div>

          <div className="controlBlock">
            <h3><Shield size={16} /> {text.logo}</h3>
            <button
              className="secondaryButton"
              onClick={async () => setWatermarkPath(await window.kiki.pickFile([{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]))}
            >
              <Upload size={16} />
              {text.addOptionalLogo}
            </button>
            {watermarkPath ? <span className="fileHint">{watermarkPath}</span> : null}
          </div>

          <div className="controlBlock">
            <h3><Download size={16} /> {text.export}</h3>
            <div className="gridTwo">
              <label>
                <span>{text.format}</span>
                <select value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)}>
                  <option value="mp4">MP4</option>
                  <option value="webm">WEBM</option>
                  <option value="gif">GIF</option>
                  <option value="avi">AVI</option>
                  <option value="mov">MOV</option>
                </select>
              </label>
              <label>
                <span>{text.codec}</span>
                <select value={codec} onChange={(event) => setCodec(event.target.value as VideoCodec)}>
                  <option value="h264">H.264</option>
                  <option value="vp9">VP9</option>
                  <option value="vp8">VP8</option>
                  <option value="mpeg4">MPEG-4</option>
                </select>
              </label>
            </div>
            <button className="primaryButton" disabled={!selected || busy} onClick={runExport}>
              <Download size={17} />
              {busy ? text.exporting : text.export}
            </button>
            {progress ? <span className="fileHint">{progress.message}</span> : null}
            {result ? (
              <button className="secondaryButton" onClick={() => window.kiki.revealPath(result)}>
                <FolderOpen size={16} />
                {text.revealExport}
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function fileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}
