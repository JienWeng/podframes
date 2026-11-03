import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../util/proc";
import type { WordTs } from "../types";

const modelPath = (): string => process.env.WHISPER_MODEL || join(homedir(), ".cache", "podframes", "ggml-base.bin");

async function requireModel(): Promise<string> {
  const path = modelPath();
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || !info.size) throw new Error("Whisper model missing: set WHISPER_MODEL to a whisper.cpp ggml model file");
  return path;
}

export async function whisperStatus(): Promise<boolean> {
  try {
    await Promise.all([requireModel(), run("whisper-cli", ["--help"], { timeoutMs: 10_000 })]);
    return true;
  } catch {
    return false;
  }
}

/** whisper.cpp's -ml 1 -sow emits word segments; JSON offsets are milliseconds. */
export async function transcribeWords(audio: Uint8Array, signal?: AbortSignal, language = "auto"): Promise<WordTs[]> {
  signal?.throwIfAborted();
  if (!audio.length) throw new Error("Cannot transcribe empty audio");
  if (typeof language !== "string" || !/^[a-z]{2,20}(?:-[a-z0-9]{2,8})*$/i.test(language)) {
    throw new Error("Whisper language must be a language code or name, optionally with a regional tag");
  }
  const decoderLanguage = language.toLowerCase().split("-")[0]!;
  const model = await requireModel();
  const dir = await mkdtemp(join(tmpdir(), "podframes-whisper-"));
  try {
    const source = join(dir, "input.mp3");
    const wav = join(dir, "input.wav");
    const output = join(dir, "words");
    await writeFile(source, audio);
    await run("ffmpeg", ["-y", "-v", "error", "-i", source, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], { signal, timeoutMs: 60_000 });
    await run("whisper-cli", ["-m", model, "-f", wav, "-oj", "-of", output, "-ml", "1", "-sow", "-l", decoderLanguage, "--no-prints"], { signal, timeoutMs: 300_000 });
    const payload: unknown = JSON.parse(await readFile(`${output}.json`, "utf8"));
    const segments = payload && typeof payload === "object" && "transcription" in payload ? payload.transcription : undefined;
    if (!Array.isArray(segments)) throw new Error("Whisper returned no word timestamps");
    // whisper.cpp emits empty segments for silence, including before the first spoken word.
    const spoken = segments.filter((segment: unknown) => !(segment && typeof segment === "object" &&
      "text" in segment && typeof segment.text === "string" && !segment.text.trim()));
    if (!spoken.length) throw new Error("Whisper returned no word timestamps");
    let previousStart = -1;
    return spoken.map((segment: unknown): WordTs => {
      if (!segment || typeof segment !== "object") throw new Error("Whisper returned invalid word timestamps");
      const { text, offsets } = segment as Record<string, unknown>;
      if (!offsets || typeof offsets !== "object") throw new Error("Whisper returned invalid word timestamps");
      const { from, to } = offsets as Record<string, unknown>;
      if (typeof text !== "string" || !text.trim() || /\s/.test(text.trim()) ||
          typeof from !== "number" || typeof to !== "number" || !Number.isFinite(from) || !Number.isFinite(to) ||
          from < 0 || to < from || from < previousStart) {
        throw new Error("Whisper returned invalid word timestamps; expected individual words with measured offsets");
      }
      previousStart = from;
      return { text: text.trim(), start: from / 1000, end: to / 1000 };
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
