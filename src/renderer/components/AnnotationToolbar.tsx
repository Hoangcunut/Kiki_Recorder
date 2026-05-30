import {
  ArrowUpRight,
  Circle,
  Eraser,
  Highlighter,
  Minus,
  MousePointer2,
  PenLine,
  Pilcrow,
  Redo2,
  RotateCcw,
  Square,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { ComponentType } from "react";
import { AnnotationStyle, ToolName } from "../../shared/types";
import { labelForTool, useI18n } from "../i18n";

type Props = {
  activeTool: ToolName;
  style: AnnotationStyle;
  zoom: number;
  spotlight: boolean;
  onToolChange: (tool: ToolName) => void;
  onStyleChange: (style: AnnotationStyle) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onZoomChange: (zoom: number) => void;
  onSpotlightChange: (enabled: boolean) => void;
};

const tools: Array<{ id: ToolName; icon: ComponentType<{ size?: number }> }> = [
  { id: "select", icon: MousePointer2 },
  { id: "pen", icon: PenLine },
  { id: "highlighter", icon: Highlighter },
  { id: "text", icon: Type },
  { id: "arrow", icon: ArrowUpRight },
  { id: "line", icon: Minus },
  { id: "rectangle", icon: Square },
  { id: "circle", icon: Circle },
  { id: "marker", icon: Pilcrow },
  { id: "blur", icon: Square },
  { id: "pixelate", icon: Square },
  { id: "eraser", icon: Eraser }
];

export function AnnotationToolbar({
  activeTool,
  style,
  zoom,
  spotlight,
  onToolChange,
  onStyleChange,
  onUndo,
  onRedo,
  onClear,
  onZoomChange,
  onSpotlightChange
}: Props) {
  const text = useI18n();

  return (
    <div className="toolbar">
      <div className="toolGroup">
        {tools.map((tool) => {
          const Icon = tool.icon;
          const label = labelForTool(tool.id, text);
          return (
            <button
              key={tool.id}
              className={`iconButton ${activeTool === tool.id ? "active" : ""}`}
              title={label}
              aria-label={label}
              onClick={() => onToolChange(tool.id)}
            >
              <Icon size={18} />
            </button>
          );
        })}
      </div>

      <div className="toolGroup">
        <label className="compactField" title={text.color}>
          <input
            type="color"
            value={style.color}
            onChange={(event) => onStyleChange({ ...style, color: event.target.value })}
          />
        </label>
        <label className="rangeField" title={text.thickness}>
          <span>{style.thickness}px</span>
          <input
            type="range"
            min={1}
            max={32}
            value={style.thickness}
            onChange={(event) => onStyleChange({ ...style, thickness: Number(event.target.value) })}
          />
        </label>
        <label className="rangeField" title={text.opacity}>
          <span>{Math.round(style.opacity * 100)}%</span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={style.opacity}
            onChange={(event) => onStyleChange({ ...style, opacity: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className="toolGroup">
        <button className="iconButton" title={text.undo} aria-label={text.undo} onClick={onUndo}>
          <Undo2 size={18} />
        </button>
        <button className="iconButton" title={text.redo} aria-label={text.redo} onClick={onRedo}>
          <Redo2 size={18} />
        </button>
        <button className="iconButton" title={text.clearAnnotations} aria-label={text.clearAnnotations} onClick={onClear}>
          <RotateCcw size={18} />
        </button>
      </div>

      <div className="toolGroup">
        <button className="iconButton" title={text.zoomOut} aria-label={text.zoomOut} onClick={() => onZoomChange(Math.max(1, zoom - 0.25))}>
          <ZoomOut size={18} />
        </button>
        <span className="pill">{zoom.toFixed(2)}x</span>
        <button className="iconButton" title={text.zoomIn} aria-label={text.zoomIn} onClick={() => onZoomChange(Math.min(4, zoom + 0.25))}>
          <ZoomIn size={18} />
        </button>
        <button
          className={`textButton ${spotlight ? "active" : ""}`}
          onClick={() => onSpotlightChange(!spotlight)}
        >
          {text.spotlight}
        </button>
      </div>
    </div>
  );
}
