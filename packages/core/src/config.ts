import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Host, PipelineOptions } from "./types";

/** Local Codex labels and installed animation model IDs. */
export const MODELS = {
  /** High-quality two-host script writing. */
  scriptModel: "codex-local",
  /** Structured editorial cue planning in local Codex. */
  cueModel: "codex-local",
  /** Built-in subscription image generation for host stills. */
  imageModel: "codex-image",
  /** Built-in subscription image generation for b-roll. */
  brollImageModel: "codex-image",
  /** fal LTX-2.3 — audio-to-video, per-turn lip-synced animation. */
  falVideoModel: "fal-ai/ltx-2.3-quality/audio-to-video",
  /** Replicate / Pruna AI p-video-avatar — default cheaper, faster per-turn audio-to-video. */
  replicateVideoModel: "prunaai/p-video-avatar",
} as const;

export const DEFAULT_OPTIONS: PipelineOptions = {
  videoProvider: "replicate-p-video",
  heygenAuth: "subscription",
  scriptModel: MODELS.scriptModel,
  cueModel: MODELS.cueModel,
  imageModel: MODELS.imageModel,
  brollImageModel: MODELS.brollImageModel,
  falVideoModel: MODELS.falVideoModel,
  replicateVideoModel: MODELS.replicateVideoModel,
  videoResolution: "720p",
  gapMs: 320,
  visualTreatment: "minimal",
  maxCues: 10,
  renderQuality: "high",
  fps: 30,
  captionStyle: "clean",
  captionColor: "#22D3EE",
  videoConcurrency: 4,
};

/** Curated default host pair. */
export const DEFAULT_HOSTS: [Host, Host] = [
  {
    id: "host_a",
    name: "Ada",
    speaker: "HOST_A",
    model: "fish/s2.1-pro",
    voice: "ca3007f96ae7499ab87d27ea3599956a",
    side: "left",
    persona: "warm, curious lead host who keeps things moving and asks the sharp follow-up",
    appearance:
      "East Asian woman in her early 30s, sleek straight black shoulder-length hair, light warm skin, olive blazer over a white tee, friendly expressive face",
  },
  {
    id: "host_b",
    name: "Theo",
    speaker: "HOST_B",
    model: "fish/s2.1-pro",
    voice: "9a9cf47702da476aa4629e2506d4a857",
    side: "right",
    persona: "lively, energetic American co-host who riffs, reacts, and grounds the excitement in specifics",
    appearance:
      "man in his late 30s, light stubble, glasses, fair skin, charcoal henley, animated friendly demeanor",
  },
];

export interface ResolvedEnv {
  heygenApiKey?: string;
  /** fal.ai key (used for LTX audio-to-video). */
  falApiKey?: string;
  /** Replicate key (used for the default p-video-avatar audio-to-video path). */
  replicateApiKey?: string;
}

const loadedEnvRoots = new Set<string>();

/** Load `.env.local` then `.env` from a root (idempotent PER ROOT — dotenv with
 *  override:false is already idempotent per key, so a later call with the real
 *  repo root still loads its files even if a library consumer called first). */
export function ensureEnvLoaded(cwd = process.cwd()): void {
  const root = resolve(cwd);
  if (loadedEnvRoots.has(root)) return;
  for (const file of [".env.local", ".env"]) {
    const path = resolve(root, file);
    if (existsSync(path)) loadDotenv({ path, override: false });
  }
  loadedEnvRoots.add(root);
}

export function resolveEnv(cwd = process.cwd()): ResolvedEnv {
  ensureEnvLoaded(cwd);
  return {
    heygenApiKey: process.env.HEYGEN_API_KEY,
    falApiKey: process.env.FAL_API_KEY || process.env.FAL_KEY,
    replicateApiKey: process.env.REPLICATE_API_KEY || process.env.REPLICATE_API_TOKEN,
  };
}

export function mergeOptions(overrides?: Partial<PipelineOptions>): PipelineOptions {
  return { ...DEFAULT_OPTIONS, ...(overrides ?? {}) };
}
