import test from "node:test";
import assert from "node:assert/strict";
import { buildCaptionGroups, scriptCaptionTurns } from "./captions";
import type { TurnRegion } from "../types";

function turn(text: string, words: TurnRegion["words"]): TurnRegion {
  return { text, words, turnIndex: 0, hostId: "a", speaker: "A", start: 2, end: 6,
    durationSec: 4, mediaType: "audio/mpeg", segments: [{ audioPath: "a.mp3", durationSec: 4 }] };
}

test("script captions preserve wording, punctuation and measured timing without Fish tags", () => {
  const [aligned] = scriptCaptionTurns([turn("[curious] Hello, world!", [
    { text: "hello", start: 2.2, end: 3 }, { text: "world", start: 3.2, end: 4 },
  ])]);
  assert.deepEqual(aligned!.words, [
    { text: "Hello, ", start: 2.2, end: 3 }, { text: "world!", start: 3.2, end: 4 },
  ]);
  assert.equal(buildCaptionGroups([aligned!], 6, true)[0]!.text, "Hello, world!");
});

test("Chinese captions retain script characters without inserted spaces", () => {
  const turns = scriptCaptionTurns([turn("所以，两家都丢过钱。", [
    { text: "所以两家", start: 2.2, end: 3 }, { text: "都丢过钱", start: 3, end: 4 },
  ])]);
  assert.equal(buildCaptionGroups(turns, 20, true).map((group) => group.text).join(""), "所以，两家都丢过钱。");
});

test("recognition mistakes retain script wording with monotonic phrase timing", () => {
  const turns = scriptCaptionTurns([
    turn("[serious] Binance lost money.", [{ text: "Bybit lost money", start: 2.2, end: 5 }]),
    turn("No timestamps.", []), turn("[laughing]", []),
  ]);
  assert.equal(turns[0]!.words.map((word) => word.text).join(""), "Binance lost money.");
  assert.ok(turns[0]!.words.length > 1);
  for (const region of turns.slice(0, 2)) {
    for (let i = 0; i < region.words.length; i++) {
      const word = region.words[i]!;
      assert.ok(word.start >= region.start && word.end <= region.end && word.end > word.start);
      if (i) assert.ok(word.start >= region.words[i - 1]!.end);
    }
  }
  assert.equal(turns[1]!.words.map((word) => word.text).join(""), "No timestamps.");
  assert.deepEqual(turns[2]!.words, []);
});

test("long Mandarin turns split into short timed phrases without losing script text", () => {
  const text = "彼岸这次真是添加时期，十月二十九日，六十多亿美元没了。我们先看官方公告，再分清楚是哪一家交易所。";
  const regions = scriptCaptionTurns([turn(text, [{ text: text.replace("彼岸", "币安"), start: 2.1, end: 5.8 }])]);
  const groups = buildCaptionGroups(regions, 6, true);
  assert.ok(groups.length >= 4);
  assert.equal(groups.map((group) => group.text).join(""), text);
  for (let i = 0; i < groups.length; i++) {
    assert.ok([...groups[i]!.text].length <= 14);
    if (i) assert.ok(groups[i]!.start >= groups[i - 1]!.end);
  }
});
