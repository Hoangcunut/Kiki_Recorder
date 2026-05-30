# KikiRecorder

KikiRecorder is a privacy-first desktop screen recorder built with Electron, React, Tailwind CSS, and FFmpeg.

- Free, no watermark, no sign-up, no telemetry.
- Saves recordings, screenshots, projects, and settings locally.
- Records to MP4 by default. The app captures WebM with `MediaRecorder`, then converts it to MP4/H.264 with bundled FFmpeg. If conversion fails, the WebM fallback is kept.
- Supports screen, window, desktop-area, browser-picker, and webcam-only recording modes.
- Supports webcam picture-in-picture, microphone/system audio, push-to-talk, annotations, screenshot annotation, scheduled recording, local history, and FFmpeg exports.
- Desktop-area mode opens a transparent full-screen picker so you can drag anywhere, see the frame size, then move or resize the frame before recording.
- Start is guarded by a `preparing` state, so repeated clicks cannot spawn multiple picker/overlay windows while the app is waiting for region selection or capture permission.
- Window recording retries video-only capture automatically if system-audio capture makes the first capture request fail, so the recording and toolbox can still start.
- During recording, controls appear in a separate small always-on-top toolbox window with a dark glass background like the reference toolbar. The toolbox can be dragged, hidden, made more transparent, and shown again with the toolbar hotkey. It closes automatically when recording stops.
- The toolbox is shown only after you start recording; the main app screen stays as the normal recorder setup UI.
- Direct desktop annotation uses a transparent drawing surface only when it is needed. Clicking a drawing tool turns interaction on; clicking the same tool again returns to Select/click-through mode while the annotation remains visible and is still rendered into the saved video.
- Includes UTF-8 UI localization for English and Tiếng Việt.
- Current structure and feature coverage are documented in `SOFTWARE_STRUCTURE.md`.

## Requirements

- Node.js 22 or newer
- FFmpeg is bundled through `ffmpeg-static`

## Run

```bash
npm install
npm run dev
```

On Windows PowerShell, use `npm.cmd` if script execution blocks `npm.ps1`:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' install
& 'C:\Program Files\nodejs\npm.cmd' run dev
```

## Build

```bash
npm run build
npm run pack
npm run dist
```

Artifacts are written to `release/`.

Run the unpacked Windows build:

```powershell
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& '.\release\win-unpacked\KikiRecorder.exe'
```

If the packaged app opens and closes immediately from PowerShell, check `ELECTRON_RUN_AS_NODE`. Electron exits like a Node process when this variable is set.

## Recording Toolbox

The toolbox appears when a recording session starts. It is a separate centered window near the top of the captured display, not part of the main app layout.
For desktop-area mode, the region picker is a single full-screen overlay on the selected/primary display. Confirming that picker starts the actual recording; canceling it returns the app to idle without opening the toolbox.

The recording toolbox provides:

- Pause/resume, stop, restart.
- Mic and system-audio mute toggles.
- Pencil button opens the full real-time drawing and annotation panel.
- Full drawing panel: pen, highlighter, text, arrow, line, rectangle, circle, step marker, blur, pixelate, eraser, undo/redo/clear, style controls, smooth zoom, click highlight, and spotlight.
- Smooth zoom controls.
- Click-highlight toggle.
- Hide button.

Drag the toolbox by its handle. Use the close button to hide it while recording, then use the configured `toggleToolbar` hotkey to show it again. Click the pencil button to open drawing tools, choose a tool to draw directly on the captured desktop area, then click the active tool again to stop intercepting the desktop while keeping the drawing visible. The drawing surface is not created until a drawing tool, spotlight, or an annotation needs it. When recording stops, the toolbox and drawing surface are closed by the app.

The toolbox is intentionally separate from the main app window. Starting a recording does not force the main app window to stay on top.

## Notes

- macOS requires Screen Recording, Camera, and Microphone permission in System Settings.
- System audio support depends on OS capture support. Electron/Chromium supports loopback capture on Windows and Linux; macOS generally needs an audio loopback device for full system audio capture.
- Browser tab capture is exposed as an experimental system-picker mode because Electron cannot enumerate arbitrary external browser tabs like a Chrome extension can.
- Packaged MP4 export resolves FFmpeg from `app.asar.unpacked`; if MP4 conversion fails, the raw WebM is kept as a fallback instead of discarding the recording.
- If the packaged Windows app opens to a black screen, rebuild with `npm run build` and `npm run pack`, then launch `release\win-unpacked\KikiRecorder.exe`; the renderer uses relative assets through `base: "./"`.
- On Windows, the app starts with software rendering/GPU fallback switches to avoid black-screen or renderer-crash cases caused by unstable GPU drivers or restricted display environments.
- If recording does not start, reselect the source/area and check OS screen-recording permission. The app uses Electron `setDisplayMediaRequestHandler` plus `getDisplayMedia()` as the primary capture path, with a legacy desktop capture fallback for diagnosis.
- If toolbox does not appear, first check that the left button changed from Start to Stop and the timer is running. The toolbox opens only after the recorder actually enters recording/countdown; if capture permission fails, the app stays on the setup screen and shows an error banner.
