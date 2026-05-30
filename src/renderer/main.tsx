import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { RecordingSurfaceApp } from "./components/RecordingSurfaceApp";
import { RecordingToolboxApp } from "./components/RecordingToolboxApp";
import { RegionOverlayApp } from "./components/RegionOverlayApp";
import "./styles.css";

const isRegionOverlay = window.location.hash.startsWith("#/region-overlay");
const isRecordingOverlay = window.location.hash.startsWith("#/recording-overlay");
const isRecordingSurface = window.location.hash.startsWith("#/recording-surface");
if (isRegionOverlay || isRecordingOverlay || isRecordingSurface) {
  document.documentElement.dataset.overlay = isRegionOverlay ? "region" : isRecordingSurface ? "surface" : "recording";
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isRegionOverlay ? (
      <RegionOverlayApp />
    ) : isRecordingOverlay ? (
      <RecordingToolboxApp />
    ) : isRecordingSurface ? (
      <RecordingSurfaceApp />
    ) : (
      <App />
    )}
  </React.StrictMode>
);
