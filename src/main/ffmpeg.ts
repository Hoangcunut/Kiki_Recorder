import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { ExportJob, ExportProgress } from "../shared/types";
import { sanitizeFileName } from "./paths";
import { getRecordingsDir } from "./storage";

const ffmpegPath = resolveFfmpegPath(ffmpegStatic || "ffmpeg");

export function getFfmpegPath(): string {
  return ffmpegPath;
}

function resolveFfmpegPath(candidate: string): string {
  if (candidate.includes("app.asar")) {
    const unpacked = candidate.replace("app.asar", "app.asar.unpacked");
    if (fs.existsSync(unpacked)) {
      return unpacked;
    }
  }
  return candidate;
}

function outputPathFor(job: ExportJob): string {
  if (job.outputPath) {
    return job.outputPath;
  }
  const parsed = path.parse(job.inputPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = sanitizeFileName(`${parsed.name}-${stamp}.${job.format}`);
  return path.join(getRecordingsDir(), base);
}

function atempoChain(speed: number): string {
  const parts: number[] = [];
  let remaining = speed;
  while (remaining > 2) {
    parts.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    parts.push(0.5);
    remaining /= 0.5;
  }
  parts.push(Number(remaining.toFixed(3)));
  return parts.map((part) => `atempo=${part}`).join(",");
}

function codecArgs(job: ExportJob): string[] {
  const quality = job.quality ?? "high";
  const crf = quality === "lossless" ? "0" : quality === "high" ? "18" : quality === "medium" ? "23" : "30";
  const bitrate = quality === "high" ? "8000k" : quality === "medium" ? "4500k" : "2200k";

  switch (job.format) {
    case "mp4":
      return ["-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k"];
    case "mov":
      return ["-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k"];
    case "webm":
      return [
        "-c:v",
        job.codec === "vp8" ? "libvpx" : "libvpx-vp9",
        "-b:v",
        bitrate,
        "-deadline",
        "realtime",
        "-c:a",
        "libopus",
        "-b:a",
        "160k"
      ];
    case "avi":
      return ["-c:v", "mpeg4", "-q:v", quality === "high" ? "2" : "5", "-c:a", "mp3", "-b:a", "192k"];
    case "gif":
      return ["-loop", "0"];
    default:
      return [];
  }
}

function videoFilter(job: ExportJob): string | undefined {
  const filters: string[] = [];
  if (job.crop && job.crop.width > 0 && job.crop.height > 0) {
    filters.push(`crop=${Math.round(job.crop.width)}:${Math.round(job.crop.height)}:${Math.round(job.crop.x)}:${Math.round(job.crop.y)}`);
  }
  if (job.playbackSpeed && job.playbackSpeed !== 1) {
    filters.push(`setpts=${(1 / job.playbackSpeed).toFixed(5)}*PTS`);
  }
  if (job.outputHeight && job.outputHeight > 0) {
    filters.push(`scale=-2:${Math.round(job.outputHeight)}`);
  }
  if (job.fps && job.fps > 0) {
    filters.push(`fps=${Math.round(job.fps)}`);
  }
  if (job.format === "gif") {
    filters.push("split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse");
  }
  return filters.length > 0 ? filters.join(",") : undefined;
}

function baseArgs(job: ExportJob, output: string): string[] {
  const args: string[] = ["-y"];
  if (typeof job.startSeconds === "number" && job.startSeconds > 0) {
    args.push("-ss", String(job.startSeconds));
  }
  args.push("-i", job.inputPath);
  if (job.extraAudioPath) {
    args.push("-i", job.extraAudioPath);
  }
  if (job.watermarkPath) {
    args.push("-i", job.watermarkPath);
  }
  if (typeof job.endSeconds === "number" && job.endSeconds > 0) {
    args.push("-to", String(job.endSeconds));
  }
  const outputArgs = job.format === "mp4" || job.format === "mov" ? ["-movflags", "+faststart", output] : [output];
  return args.concat(filterArgs(job), codecArgs(job), outputArgs);
}

function filterArgs(job: ExportJob): string[] {
  const vf = videoFilter(job);
  const speed = job.playbackSpeed ?? 1;

  if (job.watermarkPath) {
    const filters: string[] = [];
    const base = vf ? `[0:v]${vf}[base]` : "[0:v]null[base]";
    const opacity = typeof job.watermarkOpacity === "number" ? Math.max(0, Math.min(1, job.watermarkOpacity)) : 0.75;
    filters.push(base);
    filters.push(`[${job.extraAudioPath ? 2 : 1}:v]format=rgba,colorchannelmixer=aa=${opacity},scale='min(220,iw)':-1[logo]`);
    filters.push("[base][logo]overlay=W-w-28:H-h-28[v]");
    const args = ["-filter_complex", filters.join(";"), "-map", "[v]"];
    if (!job.muteAudio && job.format !== "gif") {
      args.push("-map", "0:a?");
    }
    return args;
  }

  const args: string[] = [];
  if (vf) {
    args.push("-vf", vf);
  }

  if (job.muteAudio || job.format === "gif") {
    args.push("-an");
    return args;
  }

  if (job.extraAudioPath) {
    args.push("-map", "0:v", "-map", "1:a", "-shortest");
    if (speed !== 1) {
      args.push("-filter:a", atempoChain(speed));
    }
  } else if (speed !== 1) {
    args.push("-af", atempoChain(speed));
  }
  return args;
}

function parseTimeSeconds(line: string): number | undefined {
  const match = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!match) {
    return undefined;
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export async function runFfmpeg(
  jobId: string,
  job: ExportJob,
  onProgress: (progress: ExportProgress) => void
): Promise<string> {
  if (!fs.existsSync(job.inputPath)) {
    throw new Error(`Input file not found: ${job.inputPath}`);
  }

  const output = outputPathFor(job);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const args = baseArgs(job, output);

  onProgress({ jobId, percent: 0, message: "Starting FFmpeg" });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let lastLine = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      lastLine = chunk.toString();
      const timeSeconds = parseTimeSeconds(lastLine);
      if (typeof timeSeconds === "number") {
        onProgress({ jobId, timeSeconds, message: `Encoded ${timeSeconds.toFixed(1)}s` });
      }
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        onProgress({ jobId, percent: 100, message: "Export complete" });
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${lastLine}`));
      }
    });
  });

  return output;
}
