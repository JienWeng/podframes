import type { TurnRegion, WordTs } from "../types";

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export interface CaptionGroup {
  id: string;
  hostId: string;
  start: number;
  end: number;
  words: CaptionWord[];
  text: string;
  verbatim?: boolean;
}

const SENTENCE_END = /[.!?。！？]$/;
const PAUSE_GAP = 0.45;

const normalized = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Align script character boundaries to recognition, allowing spelling mistakes. */
function alignedBoundaries(script: string, heard: string): number[] {
  if (script === heard) return Array.from({ length: script.length + 1 }, (_, i) => i);
  // shortcut: exceptionally long turns use proportional timing; normal turns use edit alignment.
  if (script.length * heard.length > 500_000) return Array.from({ length: script.length + 1 }, (_, i) => i * heard.length / script.length);
  const width = heard.length + 1;
  const costs = new Uint16Array((script.length + 1) * width);
  for (let j = 0; j < width; j++) costs[j] = j;
  for (let i = 1; i <= script.length; i++) {
    costs[i * width] = i;
    for (let j = 1; j < width; j++) costs[i * width + j] = Math.min(
      costs[(i - 1) * width + j - 1]! + (script[i - 1] === heard[j - 1] ? 0 : 1),
      costs[(i - 1) * width + j]! + 1, costs[i * width + j - 1]! + 1,
    );
  }
  const boundaries = new Array<number>(script.length + 1);
  let i = script.length, j = heard.length;
  boundaries[i] = j;
  while (i || j) {
    const cost = costs[i * width + j]!;
    if (i && j && cost === costs[(i - 1) * width + j - 1]! + (script[i - 1] === heard[j - 1] ? 0 : 1)) { i--; j--; }
    else if (i && cost === costs[(i - 1) * width + j]! + 1) i--;
    else j--;
    boundaries[i] = j;
  }
  return boundaries;
}

/** Script wording aligned to measured speech; intra-word boundaries are interpolated. */
export function scriptCaptionTurns(turns: TurnRegion[]): TurnRegion[] {
  return turns.map((turn) => {
    const text = turn.text.replace(/\[[^\]]*\]/g, "").trim();
    const tokens: string[] = [];
    let prefix = "";
    for (const part of new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)) {
      if (part.isWordLike) { tokens.push(prefix + part.segment); prefix = ""; }
      else if (tokens.length) tokens[tokens.length - 1] += part.segment;
      else prefix += part.segment;
    }
    if (prefix) tokens.push(prefix);
    const measured = turn.words.filter((word) => normalized(word.text));
    if (!text) return { ...turn, words: [] };
    // shortcut: missing recognition uses turn-level interpolation; rerun alignment for precise timing.
    if (!measured.length) measured.push({ text, start: turn.start, end: turn.end });
    let cursor = 0;
    const spans = measured.map((word) => {
      const start = cursor;
      cursor += normalized(word.text).length;
      return { ...word, from: start, to: cursor };
    });
    const boundaries = alignedBoundaries(normalized(text), measured.map((word) => normalized(word.text)).join(""));
    const timeAt = (position: number, end: boolean) => {
      const span = spans.find((span) => end ? span.to >= position : span.to > position) ?? spans[spans.length - 1]!;
      return span.start + Math.max(0, Math.min(1, (position - span.from) / (span.to - span.from))) * (span.end - span.start);
    };
    cursor = 0;
    const words: WordTs[] = [];
    let pending = "";
    for (const token of tokens) {
      const from = cursor;
      cursor += normalized(token).length;
      const start = timeAt(boundaries[from]!, false), end = timeAt(boundaries[cursor]!, true);
      if (end <= start) {
        if (words.length) words[words.length - 1]!.text += token;
        else pending += token;
      } else { words.push({ text: pending + token, start, end }); pending = ""; }
    }
    if (pending && words.length) words[words.length - 1]!.text += pending;
    return { ...turn, words };
  });
}

/**
 * Group aligned words into readable caption phrases. Breaks on turn boundaries,
 * sentence-ending punctuation, long pauses, or `maxWords` — the per-style line
 * length (slam = 2 huge words per beat, boxed = a full subtitle line; see
 * CAPTION_STYLE_PRESETS). One group is on screen at a time — exactly what the
 * HyperFrames caption contract wants.
 */
export function buildCaptionGroups(turns: TurnRegion[], maxWords = 6, verbatim = false, maxChars = 28): CaptionGroup[] {
  const groups: CaptionGroup[] = [];

  for (const turn of turns) {
    let bucket: WordTs[] = [];
    const flush = () => {
      if (bucket.length === 0) return;
      const words = bucket.map((w) => ({ text: w.text, start: w.start, end: w.end }));
      groups.push({
        id: `cg-${groups.length}`,
        hostId: turn.hostId,
        start: words[0]!.start,
        end: words[words.length - 1]!.end,
        words,
        text: words.map((w) => w.text).join(verbatim ? "" : " ").trim(),
        verbatim,
      });
      bucket = [];
    };

    for (let i = 0; i < turn.words.length; i++) {
      const w = turn.words[i]!;
      const prev = turn.words[i - 1];
      const gap = prev ? w.start - prev.end : 0;
      const candidate = [...bucket, w].map((word) => word.text).join(verbatim ? "" : " ").trim();
      const units = [...candidate].reduce((sum, char) => sum + (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char) ? 2 : 1), 0);
      if (bucket.length > 0 && (bucket.length >= Math.min(maxWords, 5) || units > maxChars || w.end - bucket[0]!.start > 2.2 || gap >= PAUSE_GAP)) flush();
      bucket.push(w);
      if (SENTENCE_END.test(w.text)) flush();
    }
    flush();
  }

  return groups;
}
