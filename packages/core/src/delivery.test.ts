import test from "node:test";
import assert from "node:assert/strict";
import { directScriptDelivery } from "./delivery";
import { DEFAULT_HOSTS } from "./config";
import type { CodexClient } from "./clients/codex";
import type { Script } from "./types";

const script: Script = {
  topic: "Check the number", title: "Check the number", hook: "Two hosts compare notes.",
  turns: [
    { index: 0, hostId: DEFAULT_HOSTS[0].id, speaker: "HOST_A", text: "[curious] The figure was 60, not 16." },
    { index: 1, hostId: DEFAULT_HOSTS[1].id, speaker: "HOST_B", text: "That changes things. Let's check the source." },
  ], sources: [{ title: "Source", url: "https://example.com/report", publishedAt: "2026-11-02" }], researchedAt: "2026-11-02T00:00:00Z",
};

test("delivery pass uses both hosts and context while preserving words, facts, metadata and inline cues", async () => {
  const hosts = structuredClone(DEFAULT_HOSTS);
  hosts[0].defaultStyle = "warm and measured";
  const original = structuredClone(script);
  const result = [
    { index: 0, text: "[matter-of-fact, slow slightly on the number] The figure was 60, not 16." },
    { index: 1, text: "[quiet disbelief] That changes things. [composed, conversational] Let's check the source." },
  ];
  const codex = { generateStructured: async (args: { system: string; contents: string }) => {
    assert.match(args.system, /There is no tag quota/);
    assert.match(args.system, /conversational action/);
    assert.match(args.contents, /warm and measured/);
    assert.match(args.contents, /LIBRARY_DIRECTION_MARKER/);
    assert.match(args.contents, /HOST_B|host_b/);
    return result;
  } } as unknown as CodexClient;
  const directed = await directScriptDelivery(codex, script, hosts, "gpt-6.1-sol", "LIBRARY_DIRECTION_MARKER");
  assert.deepEqual(script, original);
  assert.deepEqual(directed.sources, script.sources);
  assert.equal(directed.researchedAt, script.researchedAt);
  assert.equal(directed.turns[1]!.hostId, script.turns[1]!.hostId);
  assert.equal(directed.turns[1]!.text, result[1]!.text);
});

test("delivery rejects changed numbers, punctuation, words, ordering, and excessive tags", async () => {
  const valid = script.turns.map(({ index, text }) => ({ index, text }));
  const invalid = [
    [{ ...valid[0]!, text: "The figure was 16, not 60." }, valid[1]],
    [{ ...valid[0]!, text: "The figure was 60, not 16!" }, valid[1]],
    [valid[1], valid[0]], [valid[0]],
    [{ ...valid[0]!, text: `[calm] [serious] [slow] The figure was 60, not 16.` }, valid[1]],
    [{ ...valid[0]!, text: `[${"x".repeat(121)}] The figure was 60, not 16.` }, valid[1]],
  ];
  for (const output of invalid) {
    const codex = { generateStructured: async () => output } as unknown as CodexClient;
    await assert.rejects(directScriptDelivery(codex, script, DEFAULT_HOSTS, "gpt-6.1-sol"), /original script was kept/);
  }
});
