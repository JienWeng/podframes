import { synthesizeOne, compilePerformance, ensureEnvLoaded } from "@podframes/core";
import { isLanguageCode, voicePreviewText } from "@podframes/core/shared";
import type { Host, ScriptTurn } from "@podframes/core";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRepoRoot } from "@/lib/root";

export const runtime = "nodejs";
export const maxDuration = 300;

// Auditioning voices is the highest-frequency paid call in the studio, and the
// sample text is usually identical — cache synthesized samples in memory.
const CACHE_MAX = 40;
const sampleCache = new Map<string, { audio: Buffer; mediaType: string }>();

/** Synthesize a one-line sample of a voice for the casting console. */
export async function POST(req: Request) {
  ensureEnvLoaded(findRepoRoot());
  let body: {
    model?: string;
    language?: string;
    voice?: string;
    stability?: number;
    style?: string;
    text?: string;
    providerOptions?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }
  if (!body.model || !body.voice) return new Response("model and voice are required", { status: 400 });
  if (body.language != null && !isLanguageCode(body.language)) return new Response("invalid language code", { status: 400 });
  const language = body.language ?? "en";

  // Reuse the performance compiler so the preview reflects the chosen voice settings.
  const host: Host = {
    id: "preview",
    name: "Preview",
    speaker: "PREVIEW",
    model: body.model,
    voice: body.voice,
    side: "left",
    ...(body.stability != null ? { defaultStability: body.stability } : {}),
    ...(body.style ? { defaultStyle: body.style } : {}),
    ...(body.providerOptions ? { providerOptions: body.providerOptions } : {}),
  };
  const turn: ScriptTurn = { index: 0, hostId: "preview", speaker: "PREVIEW", text: (body.text?.trim() || voicePreviewText(language)).slice(0, 240) };
  const compiled = compilePerformance(host, turn);

  const cacheKey = JSON.stringify([body.model, body.voice, compiled.text, compiled.providerOptions ?? body.providerOptions ?? null, ...(language === "en" ? [] : [language])]);
  const hit = sampleCache.get(cacheKey);
  if (hit) {
    return new Response(new Uint8Array(hit.audio), {
      headers: { "Content-Type": hit.mediaType, "Cache-Control": "no-store", "X-Sample-Cache": "hit" },
    });
  }

  try {
    const out = await synthesizeOne({
      model: body.model,
      language,
      voice: body.voice,
      text: compiled.text,
      providerOptions: compiled.providerOptions ?? body.providerOptions,
      signal: req.signal,
      cachePath: join(tmpdir(), "podframes-voice-previews", `${createHash("sha256").update(cacheKey).digest("hex")}.json`),
    });
    const audio = Buffer.from(out.audio);
    sampleCache.set(cacheKey, { audio, mediaType: out.mediaType });
    if (sampleCache.size > CACHE_MAX) sampleCache.delete(sampleCache.keys().next().value!); // LRU-ish: drop oldest
    return new Response(new Uint8Array(audio), {
      headers: { "Content-Type": out.mediaType, "Cache-Control": "no-store" },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 502 });
  }
}
