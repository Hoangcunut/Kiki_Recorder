import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getFfmpegPath } from "./ffmpeg";
import { getRecordingsDir } from "./storage";
import { sanitizeFileName } from "./paths";

interface PipeSession {
  id: string;
  ffmpeg: ChildProcess;
  outputPath: string;
  bytesWritten: number;
  startedAt: number;
  closed: boolean;
  exitCode: number | null;
  lastStderr: string;
  stdinError: boolean;
}

let activeSession: PipeSession | null = null;

/**
 * Start a live ffmpeg pipe session. MediaRecorder chunks (WebM) will be
 * written to ffmpeg's stdin, and ffmpeg will encode to MP4 in real-time.
 */
export function startPipe(options: {
  fileName?: string;
  fps?: number;
}): { id: string; outputPath: string } {
  if (activeSession && !activeSession.closed) {
    console.log("[ffmpeg-pipe] Closing previous session before starting new one");
    try { activeSession.ffmpeg.stdin?.end(); } catch { /* ignore */ }
    try { activeSession.ffmpeg.kill(); } catch { /* ignore */ }
    activeSession = null;
  }

  const dir = getRecordingsDir();
  fs.mkdirSync(dir, { recursive: true });

  const id = crypto.randomUUID();
  const baseName = sanitizeFileName(options.fileName || `Recording-${id}`) || `Recording-${id}`;
  const outputPath = uniquePath(dir, baseName, "mp4");
  const ffmpegPath = getFfmpegPath();

  console.log("[ffmpeg-pipe] Starting pipe session:", { id, outputPath, ffmpegPath });


  const args = [
    "-y",
    "-probesize", "50M",
    "-analyzeduration", "10M",
    "-f", "webm",
    "-i", "pipe:0",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-fps_mode", "vfr",
    "-c:a", "aac",
    "-b:a", "192k",
    "-max_muxing_queue_size", "1024",
    "-movflags", "frag_keyframe+empty_moov",
    "-f", "mp4",
    outputPath
  ];

  console.log("[ffmpeg-pipe] ffmpeg command:", ffmpegPath, args.join(" "));

  const ffmpeg = spawn(ffmpegPath, args, {
    windowsHide: true,
    stdio: ["pipe", "ignore", "pipe"]
  });

  const session: PipeSession = {
    id,
    ffmpeg,
    outputPath,
    bytesWritten: 0,
    startedAt: Date.now(),
    closed: false,
    exitCode: null,
    lastStderr: "",
    stdinError: false
  };

  // CRITICAL: Handle stdin errors to prevent uncaught exceptions crashing the app
  ffmpeg.stdin?.on("error", (err) => {
    console.warn("[ffmpeg-pipe] stdin error (suppressed):", err.message);
    session.stdinError = true;
  });

  ffmpeg.stderr?.setEncoding("utf8");
  ffmpeg.stderr?.on("data", (chunk: string) => {
    session.lastStderr = chunk.trim();
    console.log("[ffmpeg-pipe] stderr:", session.lastStderr);
  });

  ffmpeg.on("error", (err) => {
    console.error("[ffmpeg-pipe] spawn error:", err.message);
    session.closed = true;
    session.exitCode = -1;
  });

  ffmpeg.on("close", (code) => {
    console.log("[ffmpeg-pipe] process closed with code:", code, "bytesWritten:", session.bytesWritten);
    session.closed = true;
    session.exitCode = code;
  });

  activeSession = session;
  return { id, outputPath };
}

/**
 * Write a chunk of WebM data to the active pipe session.
 */
export function writeChunk(data: ArrayBuffer | Buffer): boolean {
  if (!activeSession || activeSession.closed || activeSession.stdinError) {
    return false;
  }
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.byteLength === 0) {
    return true;
  }
  try {
    // Check if stdin is still writable
    if (!activeSession.ffmpeg.stdin || activeSession.ffmpeg.stdin.destroyed) {
      activeSession.stdinError = true;
      return false;
    }
    activeSession.ffmpeg.stdin.write(buf);
    activeSession.bytesWritten += buf.byteLength;
    if (activeSession.bytesWritten % 200000 < buf.byteLength) {
      console.log("[ffmpeg-pipe] written total:", activeSession.bytesWritten, "bytes");
    }
    return true;
  } catch (err) {
    console.warn("[ffmpeg-pipe] write error (suppressed):", err);
    activeSession.stdinError = true;
    return false;
  }
}

/**
 * Finish the pipe session: close ffmpeg's stdin and wait for it to
 * finalize the MP4 file.
 */
export async function finishPipe(): Promise<{
  outputPath: string;
  bytesWritten: number;
  durationMs: number;
} | null> {
  const session = activeSession;
  if (!session) {
    console.error("[ffmpeg-pipe] finishPipe called but no active session");
    return null;
  }
  activeSession = null;

  console.log("[ffmpeg-pipe] Finishing pipe. bytesWritten:", session.bytesWritten, "closed:", session.closed, "stdinError:", session.stdinError);

  const makeResult = () => ({
    outputPath: session.outputPath,
    bytesWritten: session.bytesWritten,
    durationMs: Date.now() - session.startedAt
  });

  // If already closed (ffmpeg exited), return result immediately
  if (session.closed) {
    console.log("[ffmpeg-pipe] Session already closed. exitCode:", session.exitCode);
    // If ffmpeg exited with error AND file doesn't exist, return null
    if (session.exitCode !== 0 && !fs.existsSync(session.outputPath)) {
      return null;
    }
    return makeResult();
  }

  // Close stdin to signal EOF to ffmpeg, then wait for it to exit
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn("[ffmpeg-pipe] Timeout waiting for ffmpeg to exit, killing...");
      try { session.ffmpeg.kill("SIGKILL"); } catch { /* ignore */ }
      session.closed = true;
      if (fs.existsSync(session.outputPath)) {
        resolve(makeResult());
      } else {
        resolve(null);
      }
    }, 15000);

    session.ffmpeg.on("close", (code) => {
      clearTimeout(timeout);
      session.closed = true;
      session.exitCode = code;
      console.log("[ffmpeg-pipe] ffmpeg exited after stdin close. exitCode:", code);
      if (fs.existsSync(session.outputPath)) {
        resolve(makeResult());
      } else {
        console.error("[ffmpeg-pipe] Output file not found after ffmpeg exit");
        resolve(null);
      }
    });

    // If process already exited by now
    if (session.ffmpeg.exitCode !== null) {
      clearTimeout(timeout);
      session.closed = true;
      session.exitCode = session.ffmpeg.exitCode;
      console.log("[ffmpeg-pipe] ffmpeg already exited with code:", session.ffmpeg.exitCode);
      if (fs.existsSync(session.outputPath)) {
        resolve(makeResult());
      } else {
        resolve(null);
      }
      return;
    }

    try {
      console.log("[ffmpeg-pipe] Closing ffmpeg stdin...");
      if (session.ffmpeg.stdin && !session.ffmpeg.stdin.destroyed) {
        session.ffmpeg.stdin.end();
      }
    } catch (err) {
      console.warn("[ffmpeg-pipe] Error closing stdin (suppressed):", err);
      clearTimeout(timeout);
      if (fs.existsSync(session.outputPath)) {
        resolve(makeResult());
      } else {
        resolve(null);
      }
    }
  });
}

/**
 * Cancel an active pipe session (discard the recording).
 */
export function cancelPipe(): void {
  if (!activeSession) {
    return;
  }
  const session = activeSession;
  activeSession = null;
  console.log("[ffmpeg-pipe] Cancelling pipe session");
  try {
    if (session.ffmpeg.stdin && !session.ffmpeg.stdin.destroyed) {
      session.ffmpeg.stdin.end();
    }
  } catch { /* ignore */ }
  try {
    session.ffmpeg.kill("SIGKILL");
  } catch { /* ignore */ }
  // Clean up partial file
  setTimeout(() => {
    try {
      if (fs.existsSync(session.outputPath)) {
        fs.unlinkSync(session.outputPath);
      }
    } catch { /* ignore */ }
  }, 500);
}

function uniquePath(dir: string, baseName: string, ext: string): string {
  let candidate = path.join(dir, `${baseName}.${ext}`);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${baseName} (${counter}).${ext}`);
    counter++;
  }
  return candidate;
}
