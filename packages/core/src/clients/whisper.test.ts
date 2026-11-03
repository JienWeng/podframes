import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { transcribeWords, whisperStatus } from "./whisper";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "podframes-whisper-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  process.env.PATH = `${root}:${process.env.PATH}`;
  process.env.WHISPER_MODEL = join(root, "model.bin");
  process.env.WHISPER_TEST_ROOT = root;
  await writeFile(process.env.WHISPER_MODEL, "model");
  const script = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const root = process.env.WHISPER_TEST_ROOT;
const binary = path.basename(process.argv[1]);
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify({binary,args})+'\\n');
if (binary === 'ffmpeg') fs.writeFileSync(args[args.length-1], 'wav');
else if (args.includes('--help')) process.stdout.write('whisper help');
else if (process.env.WHISPER_TEST_FAIL) { process.stderr.write('decode failure'); process.exit(1); }
else {
  const transcription = JSON.parse(process.env.WHISPER_TEST_SEGMENTS || '[{"text":" Hello","offsets":{"from":120,"to":400}},{"text":" world.","offsets":{"from":500,"to":900}}]');
  fs.writeFileSync(args[args.indexOf('-of')+1]+'.json', JSON.stringify({transcription}));
}
`;
  await Promise.all(["ffmpeg", "whisper-cli"].map((name) => writeFile(join(root, name), script, { mode: 0o755 })));
  return {
    root,
    calls: async () => (await readFile(join(root, "calls.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line)),
  };
}

test("converts audio and requests measured word offsets with multilingual detection", async (t) => {
  const { calls } = await fixture(t);
  assert.equal(await whisperStatus(), true);
  assert.deepEqual(await transcribeWords(new Uint8Array([1, 2, 3])), [
    { text: "Hello", start: 0.12, end: 0.4 }, { text: "world.", start: 0.5, end: 0.9 },
  ]);
  const seen = await calls();
  const convert = seen.find((call) => call.binary === "ffmpeg");
  assert.deepEqual(convert.args.slice(-7, -1), ["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"]);
  const transcribe = seen.find((call) => call.binary === "whisper-cli" && !call.args.includes("--help"));
  assert.deepEqual(transcribe.args.slice(-6), ["-ml", "1", "-sow", "-l", "auto", "--no-prints"]);
  assert.ok(transcribe.args.includes("-oj"));
  await assert.rejects(stat(transcribe.args[transcribe.args.indexOf("-f") + 1]), { code: "ENOENT" });
});

test("missing model and empty audio fail before decoding", async (t) => {
  await fixture(t);
  await assert.rejects(transcribeWords(new Uint8Array()), /empty audio/);
  await rm(process.env.WHISPER_MODEL!);
  assert.equal(await whisperStatus(), false);
  await assert.rejects(transcribeWords(new Uint8Array([1])), /Whisper model missing/);
});

test("selected regional language controls decoder language", async (t) => {
  const { calls } = await fixture(t);
  await transcribeWords(new Uint8Array([1]), undefined, "ms-MY");
  await transcribeWords(new Uint8Array([1]), undefined, "ZH-Hans");
  const commands = (await calls()).filter((call) => call.binary === "whisper-cli");
  assert.deepEqual(commands.map((call) => call.args[call.args.indexOf("-l") + 1]), ["ms", "zh"]);
});

test("malformed language fails before launching media tools", async (t) => {
  const { root } = await fixture(t);
  for (const language of ["", "en;whoami", "--help", "x", "en-US/../"]) {
    await assert.rejects(transcribeWords(new Uint8Array([1]), undefined, language), /Whisper language/);
  }
  await assert.rejects(stat(join(root, "calls.jsonl")), { code: "ENOENT" });
});

test("missing, phrase-level, invalid and unsorted timestamps fail without estimates", async (t) => {
  await fixture(t);
  for (const segments of [[], [{ text: "", offsets: { from: 0, to: 100 } }, { text: " ", offsets: { from: 100, to: 200 } }], [{ text: "Hello world", offsets: { from: 0, to: 1000 } }],
    [{ text: "Hello", offsets: { from: 1000, to: 500 } }], [{ text: "Hello", offsets: { from: -1, to: 100 } }],
    [{ text: "Hello", offsets: { from: 500, to: 700 } }, { text: "world", offsets: { from: 0, to: 100 } }]]) {
    process.env.WHISPER_TEST_SEGMENTS = JSON.stringify(segments);
    await assert.rejects(transcribeWords(new Uint8Array([1])), /word timestamps/);
  }
});

test("initial silence segments do not discard measured spoken words", async (t) => {
  await fixture(t);
  process.env.WHISPER_TEST_SEGMENTS = JSON.stringify([
    { text: "", offsets: { from: 0, to: 110 } },
    { text: " ", offsets: { from: 110, to: 120 } },
    { text: " Hello", offsets: { from: 120, to: 400 } },
    { text: " world.", offsets: { from: 500, to: 900 } },
  ]);
  assert.deepEqual(await transcribeWords(new Uint8Array([1])), [
    { text: "Hello", start: 0.12, end: 0.4 }, { text: "world.", start: 0.5, end: 0.9 },
  ]);
});

test("decoder failure still removes temporary media", async (t) => {
  const { calls } = await fixture(t);
  process.env.WHISPER_TEST_FAIL = "1";
  await assert.rejects(transcribeWords(new Uint8Array([1])), /decode failure/);
  const transcribe = (await calls()).find((call) => call.binary === "whisper-cli");
  await assert.rejects(stat(transcribe.args[transcribe.args.indexOf("-f") + 1]), { code: "ENOENT" });
});

test("cancellation rejects before launching media tools", async (t) => {
  const { root } = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(transcribeWords(new Uint8Array([1]), controller.signal), { name: "AbortError" });
  await assert.rejects(stat(join(root, "calls.jsonl")), { code: "ENOENT" });
});
