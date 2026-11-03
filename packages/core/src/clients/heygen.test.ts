import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { audioToVideo, assertHeygenAuth, heygenStatus } from "./heygen";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "podframes-heygen-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const oldEnv = { ...process.env };
  t.after(() => { process.env = oldEnv; });
  process.env.PATH = `${root}:${process.env.PATH}`;
  process.env.HEYGEN_TEST_ROOT = root;
  process.env.HEYGEN_API_KEY = "inherited-api-secret";
  process.env.HEYGEN_NONINTERACTIVE = "1";
  process.env.HEYGEN_OUTPUT = "human";
  await writeFile(join(root, "heygen"), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.HEYGEN_TEST_ROOT;
const args = process.argv.slice(2);
const input = fs.readFileSync(0, 'utf8');
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify({args,input,key:process.env.HEYGEN_API_KEY,noninteractive:process.env.HEYGEN_NONINTERACTIVE,output:process.env.HEYGEN_OUTPUT})+'\\n');
let result;
if (args[0] === 'auth') {
  result = {credential:{type:process.env.HEYGEN_TEST_WRONG_AUTH || (process.env.HEYGEN_API_KEY ? 'api_key' : 'oauth')}};
} else if (args[0] === 'asset') {
  const countFile = path.join(root, 'assets-counter');
  const count = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, 'utf8')) + 1 : 1;
  fs.writeFileSync(countFile, String(count));
  const suffix = process.env.HEYGEN_TEST_UNIQUE_ASSETS ? '-'+count : '';
  result = {data:{asset_id: (args[args.length-1].endsWith('.png') ? 'image-asset' : 'audio-asset')+suffix}};
} else if (args[1] === 'create') {
  if (!JSON.parse(input).audio_asset_id) throw Error('missing audio');
  const failedCreate = path.join(root, 'failed-create');
  if (process.env.HEYGEN_TEST_LOST_CREATE && !fs.existsSync(failedCreate)) {
    fs.writeFileSync(failedCreate, 'created');
    process.stderr.write('lost create response');
    process.exit(1);
  }
  result = {data:{video_id:'video-1',status:'pending'}};
} else if (args[1] === 'get') {
  if (process.env.HEYGEN_TEST_FAIL_GET === '1') { process.stderr.write('temporary error '+process.env.HEYGEN_API_KEY); process.exit(1); }
  result = {data:{video_id:'video-1',status:process.env.HEYGEN_TEST_VIDEO_STATUS || 'completed'}};
} else if (args[1] === 'download') {
  fs.writeFileSync(args[args.indexOf('--output-path')+1], 'video-bytes');
  result = {path:args[args.indexOf('--output-path')+1]};
} else throw Error('unexpected args');
process.stdout.write(JSON.stringify(result));
`, { mode: 0o755 });
  const imagePath = join(root, "host.png");
  const audioPath = join(root, "turn.mp3");
  const outputPath = join(root, "clip.mp4");
  await writeFile(imagePath, "image-bytes");
  await writeFile(audioPath, "audio-bytes");
  return {
    args: { auth: "subscription" as const, imagePath, audioPath, outputPath, prompt: "Talk to camera", aspectRatio: "16:9" as const, resolution: "720p" as const },
    root,
    calls: async () => (await readFile(join(root, "calls.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line)),
  };
}

test("subscription uses OAuth, uploads real media, creates and downloads a video", async (t) => {
  const { args, calls } = await fixture(t);
  assert.deepEqual(await audioToVideo(args), { path: args.outputPath });
  assert.equal(await readFile(args.outputPath, "utf8"), "video-bytes");
  const seen = await calls();
  assert.ok(seen.every((call) => call.key === undefined && call.noninteractive === undefined && call.output === "json"));
  assert.deepEqual(seen.map((call) => call.args.slice(0, 2)), [["auth", "status"], ["asset", "create"], ["asset", "create"], ["video", "create"], ["video", "get"], ["video", "download"]]);
  const create = seen.find((call) => call.args[0] === "video" && call.args[1] === "create");
  assert.deepEqual(JSON.parse(create.input), {
    type: "image", image: { type: "asset_id", asset_id: "image-asset" }, audio_asset_id: "audio-asset",
    aspect_ratio: "16:9", resolution: "720p", motion_prompt: args.prompt, expressiveness: "low",
  });
  assert.match(create.args[create.args.indexOf("--idempotency-key") + 1], /^[a-f0-9-]{36}$/);
  assert.equal(process.env.HEYGEN_API_KEY, "inherited-api-secret");
});

test("API billing requires explicit key and rejects OAuth fallback", async (t) => {
  await fixture(t);
  await assert.rejects(assertHeygenAuth("api"), /HEYGEN_API_KEY is required/);
  await assertHeygenAuth("api", "explicit-api-key");
  process.env.HEYGEN_TEST_WRONG_AUTH = "oauth";
  await assert.rejects(assertHeygenAuth("api", "explicit-api-key"), /API key authentication/);
  process.env.HEYGEN_TEST_WRONG_AUTH = "api_key";
  assert.equal(await heygenStatus("subscription"), false);
});

test("interrupted polling resumes persisted job without another create", async (t) => {
  const { args, calls } = await fixture(t);
  process.env.HEYGEN_TEST_FAIL_GET = "1";
  await assert.rejects(audioToVideo({ ...args, auth: "api", apiKey: "explicit-secret" }), (error: Error) =>
    error.message.includes("[redacted]") && !error.message.includes("explicit-secret"));
  delete process.env.HEYGEN_TEST_FAIL_GET;
  await audioToVideo({ ...args, auth: "api", apiKey: "explicit-secret" });
  const seen = await calls();
  assert.equal(seen.filter((call) => call.args[0] === "video" && call.args[1] === "create").length, 1);
  assert.equal(seen.filter((call) => call.args[0] === "asset").length, 2);
});

test("lost create response replays identical body and key without uploading assets again", async (t) => {
  const { args, calls } = await fixture(t);
  process.env.HEYGEN_TEST_UNIQUE_ASSETS = "1";
  process.env.HEYGEN_TEST_LOST_CREATE = "1";
  await assert.rejects(audioToVideo(args), /lost create response/);
  await audioToVideo(args);
  const seen = await calls();
  const creates = seen.filter((call) => call.args[0] === "video" && call.args[1] === "create");
  assert.equal(creates.length, 2);
  assert.deepEqual(creates[0].args, creates[1].args);
  assert.equal(creates[0].input, creates[1].input);
  assert.equal(seen.filter((call) => call.args[0] === "asset").length, 2);
});

test("failed job does not create a replacement on retry", async (t) => {
  const { args, calls } = await fixture(t);
  process.env.HEYGEN_TEST_VIDEO_STATUS = "failed";
  await assert.rejects(audioToVideo(args), /video-1 failed/);
  await assert.rejects(audioToVideo(args), /video-1 failed/);
  assert.equal(JSON.parse(await readFile(`${args.outputPath}.heygen.json`, "utf8")).terminalFailed, true);
  assert.equal((await calls()).filter((call) => call.args[0] === "video" && call.args[1] === "create").length, 1);
});

test("uncertain create older than idempotency window refuses another paid request", async (t) => {
  const { args, calls } = await fixture(t);
  await audioToVideo(args);
  const sidecarPath = `${args.outputPath}.heygen.json`;
  const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
  delete sidecar.videoId;
  sidecar.createdAt = Date.now() - 25 * 60 * 60_000;
  await writeFile(sidecarPath, JSON.stringify(sidecar));
  await assert.rejects(audioToVideo(args), /over 24 hours old/);
  assert.equal((await calls()).filter((call) => call.args[0] === "video" && call.args[1] === "create").length, 1);
});

test("explicit regeneration and changed inputs use new idempotency keys", async (t) => {
  const { args, calls } = await fixture(t);
  await audioToVideo(args);
  await rm(`${args.outputPath}.heygen.json`);
  await audioToVideo(args);
  await writeFile(args.imagePath, "different-image");
  await audioToVideo(args);
  const creates = (await calls()).filter((call) => call.args[0] === "video" && call.args[1] === "create");
  assert.equal(creates.length, 3);
  assert.equal(new Set(creates.map((call) => call.args[call.args.indexOf("--idempotency-key") + 1])).size, 3);
});
