import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import {
  ArrowUpRight,
  Bold,
  ChevronUp,
  Circle,
  Droplet,
  Eraser,
  Eye,
  Grid,
  GripVertical,
  Highlighter,
  Italic,
  Mic,
  MicOff,
  Minus,
  MoreVertical,
  MousePointer2,
  Pause,
  PenLine,
  Pilcrow,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Square,
  Type,
  Undo2,
  Video,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { AnnotationStyle, RecordingOverlayConfig, RecordingOverlayEvent, ToolName } from "../../shared/types";
import { getI18n, labelForTool } from "../i18n";

const toolButtons: Array<{ id: ToolName; icon: ComponentType<{ size?: number }> }> = [
  { id: "select", icon: MousePointer2 },
  { id: "pen", icon: PenLine },
  { id: "highlighter", icon: Highlighter },
  { id: "text", icon: Type },
  { id: "arrow", icon: ArrowUpRight },
  { id: "line", icon: Minus },
  { id: "rectangle", icon: Square },
  { id: "circle", icon: Circle },
  { id: "marker", icon: Pilcrow },
  { id: "blur", icon: Droplet },
  { id: "pixelate", icon: Grid },
  { id: "eraser", icon: Eraser }
];

const fonts = [
  "Inter, system-ui, sans-serif",
  "Arial, sans-serif",
  "Georgia, serif",
  "Consolas, monospace"
];

export function RecordingToolboxApp() {
  const [config, setConfig] = useState<RecordingOverlayConfig | undefined>();
  const [textInput, setTextInput] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const text = getI18n(config?.language ?? "en");

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    void window.kiki.getRecordingOverlayState().then((state) => {
      if (state) {
        setConfig(state);
      }
    });
    return window.kiki.onRecordingOverlayUpdate(setConfig);
  }, []);

  if (!config) {
    return null;
  }

  function send(event: RecordingOverlayEvent): void {
    window.kiki.sendRecordingOverlayEvent(event);
  }

  function patchStyle(next: Partial<AnnotationStyle>): void {
    if (!config) {
      return;
    }
    send({ type: "style", style: { ...config.style, ...next } });
  }

  function chooseTool(tool: ToolName): void {
    send({ type: "tool", tool });
    if (!config?.toolboxPanelOpen) {
      send({ type: "toolbox-panel", open: true });
    }
  }

  function togglePanel(): void {
    send({ type: "toolbox-panel", open: !config?.toolboxPanelOpen });
  }

  function handleAddText(): void {
    if (showTextInput) {
      // Submit text if there is content
      if (textInput.trim()) {
        const centerX = (config?.sourceSize?.width ?? 1920) / 2;
        const centerY = (config?.sourceSize?.height ?? 1080) / 2;
        send({ type: "text", point: { x: centerX, y: centerY }, text: textInput.trim() });
        setTextInput("");
      }
      setShowTextInput(false);
    } else {
      setShowTextInput(true);
    }
  }

  function handleTextKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter" && textInput.trim()) {
      const centerX = (config?.sourceSize?.width ?? 1920) / 2;
      const centerY = (config?.sourceSize?.height ?? 1080) / 2;
      send({ type: "text", point: { x: centerX, y: centerY }, text: textInput.trim() });
      setTextInput("");
      setShowTextInput(false);
    } else if (e.key === "Escape") {
      setTextInput("");
      setShowTextInput(false);
    }
  }

  const isPaused = config.state === "paused";
  const stopHotkey = compactHotkey(config.hotkeys.startStop);
  const pauseHotkey = compactHotkey(config.hotkeys.pauseResume);

  if (config.toolbarHidden) {
    return (
      <div 
        className="toolboxHiddenHoverStrip" 
        onMouseEnter={() => send({ type: "toggle-hide" })}
        title="Show toolbar"
      />
    );
  }

  if (config.toolbarCollapsed) {
    return (
      <div className="recordingToolboxRoot">
        <button 
          className="toolboxMinimized nativeDrag" 
          onClick={() => send({ type: "toggle-minimize" })}
          title="Restore toolbar"
        >
          <Video size={20} />
        </button>
      </div>
    );
  }

  return (
    <div className={`recordingToolboxRoot ${config.toolboxPanelOpen ? "panelOpen" : ""}`}>
      <div className="recordingToolbox" role="toolbar" aria-label="KikiRecorder recording controls">
        <div className="toolboxMainRow">
          <button className="toolboxGrip nativeDrag" title={`${text.moveToolbar} / Menu`} aria-label={text.moveToolbar} onDoubleClick={togglePanel}>
            <MoreVertical size={18} />
          </button>

          <button className="toolboxTextButton pauseButton" title={`${isPaused ? text.resume : text.pause}${pauseHotkey ? ` (${pauseHotkey})` : ""}`} onClick={() => send({ type: "pause-resume" })}>
            {isPaused ? <Play size={18} /> : <Pause size={18} />}
            <span>{isPaused ? text.resume : text.pause}</span>
          </button>

          <button className="toolboxTextButton stopButton" title={`${text.stop}${stopHotkey ? ` (${stopHotkey})` : ""}`} onClick={() => send({ type: "stop" })}>
            <Square size={17} fill="currentColor" />
            <span>{stopHotkey ? `${text.stop} (${stopHotkey})` : text.stop}</span>
          </button>

          <span className="toolboxTimer">{formatElapsed(config.elapsedMs)}</span>

          <button className={`toolboxIconButton underlined pencilButton ${config.toolboxPanelOpen ? "active" : ""}`} title={text.showToolbarTools} onClick={togglePanel}>
            <PenLine size={18} />
          </button>

          <button className={`toolboxIconButton addButton ${showTextInput ? "active" : ""}`} title="Add text" onClick={handleAddText}>
            {showTextInput ? <Type size={18} /> : <Plus size={18} />}
          </button>

          {showTextInput && (
            <input
              className="toolboxTextInput"
              type="text"
              placeholder="Enter text..."
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleTextKeyDown}
              autoFocus
            />
          )}

          <button className="toolboxIconButton" title={text.undo} onClick={() => send({ type: "undo" })}>
            <Undo2 size={17} />
          </button>
          <button className="toolboxIconButton" title={text.redo} onClick={() => send({ type: "redo" })}>
            <Redo2 size={17} />
          </button>

          <button className={`toolboxIconButton underlined eye ${config.spotlight ? "active" : ""}`} title={text.spotlight} onClick={() => send({ type: "toggle-spotlight" })}>
            <Eye size={18} />
          </button>

          <button
            className={`toolboxIconButton underlined audioButton ${!config.audio.microphoneMuted && config.audio.microphoneEnabled ? "active" : ""}`}
            disabled={!config.audio.microphoneAvailable}
            title={text.microphone}
            onClick={() => send({ type: "toggle-microphone" })}
          >
            {config.audio.microphoneMuted || !config.audio.microphoneEnabled ? <MicOff size={18} /> : <Mic size={18} />}
          </button>

          <button
            className={`toolboxIconButton underlined audioButton ${!config.audio.systemMuted && config.audio.systemEnabled ? "active" : ""}`}
            disabled={!config.audio.systemAvailable}
            title={text.systemAudio}
            onClick={() => send({ type: "toggle-system-audio" })}
          >
            {config.audio.systemMuted || !config.audio.systemEnabled ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>

          <button className="toolboxIconButton" title="Minimize" onClick={() => send({ type: "toggle-minimize" })}>
            <Minus size={20} />
          </button>
          <button className="toolboxIconButton" title="Hide" onClick={() => send({ type: "toggle-hide" })}>
            <ChevronUp size={20} />
          </button>
          <button className="toolboxIconButton close" title={text.hideToolbar} onClick={() => send({ type: "toolbar-visibility", visible: false })}>
            <X size={20} />
          </button>
        </div>

        {config.toolboxPanelOpen ? (
          <div className="toolboxDrawingPanel">
            <div className="toolboxPanelSection toolGrid" aria-label="Drawing tools">
              {toolButtons.map((tool) => {
                const Icon = tool.icon;
                const active = config.activeTool === tool.id;
                const label = labelForTool(tool.id, text);
                return (
                  <button
                    key={tool.id}
                    className={`toolboxIconButton ${active ? "active" : ""}`}
                    title={active && tool.id !== "select" ? `${label}: click again to turn off` : label}
                    onClick={() => chooseTool(tool.id)}
                  >
                    <Icon size={16} />
                  </button>
                );
              })}
            </div>

            <div className="toolboxPanelSection stylePanel">
              <input title={text.color} aria-label={text.color} type="color" value={config.style.color} onChange={(event) => patchStyle({ color: event.target.value })} />
              <label title={text.thickness}>
                <span>{config.style.thickness}px</span>
                <input type="range" min={1} max={36} value={config.style.thickness} onChange={(event) => patchStyle({ thickness: Number(event.target.value) })} />
              </label>
              <label title={text.opacity}>
                <span>{Math.round(config.style.opacity * 100)}%</span>
                <input type="range" min={0.1} max={1} step={0.05} value={config.style.opacity} onChange={(event) => patchStyle({ opacity: Number(event.target.value) })} />
              </label>
              <label title={text.fontSize}>
                <span>{config.style.fontSize}px</span>
                <input type="range" min={14} max={96} value={config.style.fontSize} onChange={(event) => patchStyle({ fontSize: Number(event.target.value) })} />
              </label>
              <select title="Font" value={config.style.fontFamily} onChange={(event) => patchStyle({ fontFamily: event.target.value })}>
                {fonts.map((font) => (
                  <option key={font} value={font}>
                    {font.split(",")[0]}
                  </option>
                ))}
              </select>
              <button className={`toolboxIconButton ${config.style.bold ? "active" : ""}`} title="Bold" onClick={() => patchStyle({ bold: !config.style.bold })}>
                <Bold size={15} />
              </button>
              <button className={`toolboxIconButton ${config.style.italic ? "active" : ""}`} title="Italic" onClick={() => patchStyle({ italic: !config.style.italic })}>
                <Italic size={15} />
              </button>
            </div>

            <div className="toolboxPanelSection effectsPanel">
              <button className="toolboxTextButton compactText" title={text.zoomIn} onClick={() => send({ type: "zoom", zoom: clamp(config.zoom + 0.2, 1, 4) })}>
                <ZoomIn size={16} />
                <span>{config.zoom.toFixed(1)}x</span>
              </button>
              <button className="toolboxIconButton muted" title={text.zoomOut} onClick={() => send({ type: "zoom", zoom: clamp(config.zoom - 0.2, 1, 4) })}>
                <ZoomOut size={16} />
              </button>
              <button className={`toolboxTextButton compactText ${config.highlightClicks ? "active" : ""}`} title={text.clicks} onClick={() => send({ type: "toggle-clicks" })}>
                <Eye size={16} />
                <span>{text.clicks}</span>
              </button>
              <button className={`toolboxTextButton compactText ${config.spotlight ? "active" : ""}`} title={text.spotlight} onClick={() => send({ type: "toggle-spotlight" })}>
                <Eye size={16} />
                <span>{text.spotlight}</span>
              </button>
              <button className="toolboxIconButton" title={text.clearAnnotations} onClick={() => send({ type: "clear" })}>
                <RotateCcw size={16} />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

function compactHotkey(hotkey?: string): string {
  if (!hotkey) {
    return "";
  }
  const compact = hotkey.replace("CommandOrControl", "Ctrl").replace(/\s+/g, "");
  return compact.length <= 6 ? compact : "";
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
