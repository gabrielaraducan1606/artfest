import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import os from "os";
import path from "path";
import fs from "fs/promises";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

/**
 * Elimină fizic pista audio dintr-un video, prin remux (fără
 * re-encodare video: `-c:v copy -an`). Rapid (I/O, nu transcodare)
 * și fără pierdere de calitate video.
 *
 * `mimeType` decide extensia temporară (mp4/webm) - ffmpeg alege
 * muxer-ul din extensie. `+faststart` se aplică doar la MP4.
 */
export async function stripVideoAudio(buffer, mimeType) {
  if (!ffmpegPath) {
    throw new Error("FFMPEG_NOT_AVAILABLE");
  }

  const isMp4 = mimeType === "video/mp4";
  const ext = isMp4 ? "mp4" : "webm";

  const tmpDir = os.tmpdir();
  const id = randomUUID();
  const inputPath = path.join(tmpDir, `video-in-${id}.${ext}`);
  const outputPath = path.join(tmpDir, `video-out-${id}.${ext}`);

  try {
    await fs.writeFile(inputPath, buffer);

    const args = [
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "copy",
      "-an",
      ...(isMp4 ? ["-movflags", "+faststart"] : []),
      outputPath,
    ];

    await execFileAsync(ffmpegPath, args, {
      timeout: 60_000,
      maxBuffer: 1024 * 1024 * 20,
    });

    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(inputPath, { force: true }).catch(() => {});
    await fs.rm(outputPath, { force: true }).catch(() => {});
  }
}
