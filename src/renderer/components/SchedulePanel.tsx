import { CalendarClock, Trash2 } from "lucide-react";
import { useState } from "react";
import { RecordingSettings, ScheduleItem } from "../../shared/types";
import { labelForMode, useI18n } from "../i18n";

type Props = {
  schedules: ScheduleItem[];
  currentSettings: RecordingSettings;
  onAdd: (startsAt: string, endsAt?: string, name?: string) => void;
  onRemove: (id: string) => void;
};

export function SchedulePanel({ schedules, currentSettings, onAdd, onRemove }: Props) {
  const text = useI18n();
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [name, setName] = useState("");

  return (
    <div className="workspacePanel">
      <div className="workspaceHeader">
        <div>
          <h2>{text.scheduleTitle}</h2>
          <p>{text.scheduleSubtitle}</p>
        </div>
      </div>

      <div className="scheduleComposer">
        <label>
          <span>{text.name}</span>
          <input value={name} placeholder={text.scheduledRecording} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span>{text.scheduleStart}</span>
          <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
        </label>
        <label>
          <span>{text.scheduleEnd}</span>
          <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
        </label>
        <button
          className="primaryButton"
          disabled={!startsAt}
          onClick={() => onAdd(new Date(startsAt).toISOString(), endsAt ? new Date(endsAt).toISOString() : undefined, name.trim() || text.scheduledRecording)}
        >
          <CalendarClock size={17} />
          {text.add}
        </button>
      </div>

      <div className="scheduleList">
        {schedules.map((item) => (
          <article className="scheduleItem" key={item.id}>
            <CalendarClock size={22} />
            <div>
              <h3>{item.name}</h3>
              <p>{new Date(item.startsAt).toLocaleString()} · {labelForMode(item.settings.mode, text)} · {item.settings.quality.label}</p>
            </div>
            <button className="iconButton danger" onClick={() => onRemove(item.id)} title={text.deleteSchedule} aria-label={text.deleteSchedule}>
              <Trash2 size={17} />
            </button>
          </article>
        ))}
      </div>

      {schedules.length === 0 ? <div className="emptyList">{text.noSchedules}</div> : null}

      <div className="subtleSection">
        {text.activeTemplate}: {labelForMode(currentSettings.mode, text)}, {currentSettings.quality.label}, {currentSettings.quality.fps} {text.fps}
      </div>
    </div>
  );
}
