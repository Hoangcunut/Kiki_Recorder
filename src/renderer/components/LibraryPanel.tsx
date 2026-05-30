import { ExternalLink, FolderOpen, Trash2, Video } from "lucide-react";
import { LibraryItem } from "../../shared/types";
import { labelForMode, useI18n } from "../i18n";

type Props = {
  items: LibraryItem[];
  onRefresh: () => void;
  onEdit: (item: LibraryItem) => void;
  onReveal: (path: string) => void;
  onRemove: (id: string, deleteFile: boolean) => void;
};

export function LibraryPanel({ items, onRefresh, onEdit, onReveal, onRemove }: Props) {
  const text = useI18n();

  return (
    <div className="workspacePanel">
      <div className="workspaceHeader">
        <div>
          <h2>{text.libraryTitle}</h2>
          <p>{items.length} {items.length === 1 ? text.localRecording : text.localRecordings}</p>
        </div>
        <button className="secondaryButton" onClick={onRefresh}>
          {text.refresh}
        </button>
      </div>

      <div className="libraryGrid">
        {items.map((item) => (
          <article className="libraryItem" key={item.id}>
            <div className="mediaThumb">
              <Video size={34} />
              <span>{item.format.toUpperCase()}</span>
            </div>
            <div className="libraryBody">
              <h3>{item.title}</h3>
              <p>{item.sourceName || labelForMode(item.mode, text)} · {formatDuration(item.durationMs, text.minutesShort, text.secondsShort)} · {formatBytes(item.bytes)}</p>
              <span>{new Date(item.createdAt).toLocaleString()}</span>
            </div>
            <div className="libraryActions">
              <button className="iconButton" onClick={() => onEdit(item)} title={text.editExport} aria-label={text.editExport}>
                <ExternalLink size={17} />
              </button>
              <button className="iconButton" onClick={() => onReveal(item.path)} title={text.revealFile} aria-label={text.revealFile}>
                <FolderOpen size={17} />
              </button>
              <button className="iconButton danger" onClick={() => onRemove(item.id, false)} title={text.removeFromLibrary} aria-label={text.removeFromLibrary}>
                <Trash2 size={17} />
              </button>
            </div>
          </article>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="emptyList">{text.noRecordings}</div>
      ) : null}
    </div>
  );
}

function formatDuration(ms: number, minuteLabel: string, secondLabel: string): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}${minuteLabel} ${seconds % 60}${secondLabel}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
