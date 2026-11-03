import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { run } from "../util/proc";
import { readJson, writeJson } from "../util/fs";

export type HeygenAuth = "subscription" | "api";

export interface HeygenVideoArgs {
  auth: HeygenAuth;
  apiKey?: string;
  aspectRatio?: "16:9" | "9:16";
  resolution?: "720p" | "1080p";
  imagePath: string;
  audioPath: string;
  prompt: string;
  outputPath: string;
  signal?: AbortSignal;
}

function heygenEnv(auth: HeygenAuth, apiKey?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HEYGEN_OUTPUT: "json", HEYGEN_NO_UPDATE_CHECK: "1", HEYGEN_NO_ANALYTICS: "1" };
  if (auth === "subscription") {
    delete env.HEYGEN_API_KEY;
    delete env.HEYGEN_NONINTERACTIVE;
  } else if (auth === "api") {
    if (!apiKey?.trim()) throw new Error("HEYGEN_API_KEY is required for HeyGen API billing");
    env.HEYGEN_API_KEY = apiKey;
  } else {
    throw new Error("HeyGen authentication must be subscription or api");
  }
  return env;
}

async function command(args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal, timeoutMs = 60_000, input?: string): Promise<Record<string, unknown>> {
  try {
    const result = await run("heygen", args, { env, signal, timeoutMs, input });
    const value: unknown = JSON.parse(result.stdout);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("HeyGen CLI returned invalid JSON");
    return value as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(env.HEYGEN_API_KEY ? message.split(env.HEYGEN_API_KEY).join("[redacted]") : message);
  }
}

/** Never changes CLI credentials; the billing selection must match the active credential. */
export async function assertHeygenAuth(auth: HeygenAuth, apiKey?: string): Promise<void> {
  const status = await command(["auth", "status"], heygenEnv(auth, apiKey));
  const credential = status.credential as { type?: string } | undefined;
  if (credential?.type !== (auth === "subscription" ? "oauth" : "api_key")) {
    throw new Error(auth === "subscription"
      ? "HeyGen subscription login required: run `heygen auth login --oauth` in your terminal"
      : "HeyGen API key authentication is unavailable; check HEYGEN_API_KEY");
  }
}

export async function heygenStatus(auth: HeygenAuth = "subscription", apiKey?: string): Promise<boolean> {
  try {
    await assertHeygenAuth(auth, apiKey);
    return true;
  } catch {
    return false;
  }
}

function data(response: Record<string, unknown>): Record<string, unknown> {
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) throw new Error("HeyGen CLI response is missing data");
  return response.data as Record<string, unknown>;
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`HeyGen CLI response has no valid ${field}`);
  return value;
}

interface PendingVideo {
  key: string;
  requestKey: string;
  createdAt: number;
  imageAssetId?: string;
  audioAssetId?: string;
  videoId?: string;
  terminalFailed?: boolean;
}

/** Persist the remote job before polling, so interrupted runs resume without buying another clip. */
export async function audioToVideo(args: HeygenVideoArgs): Promise<{ path: string }> {
  const env = heygenEnv(args.auth, args.apiKey);
  await assertHeygenAuth(args.auth, args.apiKey);
  const aspectRatio = args.aspectRatio ?? "16:9";
  const resolution = args.resolution ?? "720p";
  if (!["16:9", "9:16"].includes(aspectRatio) || !["720p", "1080p"].includes(resolution)) throw new Error("Unsupported HeyGen aspect ratio or resolution");
  const [image, audio] = await Promise.all([readFile(args.imagePath), readFile(args.audioPath)]);
  if (!image.length || !audio.length) throw new Error("HeyGen image and audio must not be empty");
  const key = createHash("sha256").update(`${image.length}:`).update(image).update(audio)
    .update(JSON.stringify([args.prompt, aspectRatio, resolution, args.auth])).digest("hex");
  const sidecar = `${args.outputPath}.heygen.json`;
  let pending = await readJson<PendingVideo>(sidecar).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (pending && (typeof pending.key !== "string" || typeof pending.requestKey !== "string" || !Number.isFinite(pending.createdAt))) throw new Error("Invalid HeyGen pending-job sidecar");
  if (pending?.key !== key) pending = undefined;
  if (!pending) {
    pending = { key, requestKey: randomUUID(), createdAt: Date.now() };
    await writeJson(sidecar, pending);
  }
  if (!pending.videoId) {
    // HeyGen only deduplicates for 24h; an uncertain older create needs reconciliation.
    if (Date.now() - pending.createdAt >= 24 * 60 * 60_000) throw new Error("HeyGen pending create is over 24 hours old; reconcile it with `heygen video list` before retrying");
    if (!pending.imageAssetId || !pending.audioAssetId) {
      const imageAsset = data(await command(["asset", "create", "--file", args.imagePath], env, args.signal));
      const audioAsset = data(await command(["asset", "create", "--file", args.audioPath], env, args.signal));
      pending.imageAssetId = identifier(imageAsset.asset_id, "image asset_id");
      pending.audioAssetId = identifier(audioAsset.asset_id, "audio asset_id");
      // A lost create response must replay the same body, including uploaded asset IDs.
      await writeJson(sidecar, pending);
    }
    const response = data(await command(["video", "create", "-d", "-", "--idempotency-key", pending.requestKey], env, args.signal, 60_000, JSON.stringify({
      type: "image",
      image: { type: "asset_id", asset_id: identifier(pending.imageAssetId, "image asset_id") },
      audio_asset_id: identifier(pending.audioAssetId, "audio asset_id"),
      aspect_ratio: aspectRatio,
      resolution,
      motion_prompt: args.prompt,
      expressiveness: "low",
    })));
    pending.videoId = identifier(response.video_id, "video_id");
    await writeJson(sidecar, pending);
  }
  const videoId = identifier(pending.videoId, "video_id");
  const deadline = Date.now() + 20 * 60_000;
  for (;;) {
    args.signal?.throwIfAborted();
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`HeyGen video ${videoId} timed out; retry to resume the same job`);
    const video = data(await command(["video", "get", videoId], env, args.signal, Math.min(60_000, remaining)));
    if (video.status === "completed") break;
    if (video.status === "failed" || video.status === "canceled" || video.status === "cancelled") {
      pending.terminalFailed = true;
      await writeJson(sidecar, pending);
      throw new Error(`HeyGen video ${videoId} ${String(video.status)}`);
    }
    if (typeof video.status !== "string") throw new Error("HeyGen video response is missing status");
    await delay(Math.min(3000, remaining), undefined, { signal: args.signal });
  }
  await command(["video", "download", videoId, "--output-path", args.outputPath], env, args.signal, 180_000);
  if (!(await stat(args.outputPath)).size) throw new Error("HeyGen downloaded an empty video");
  return { path: args.outputPath };
}
