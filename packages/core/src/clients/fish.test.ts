import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexClient } from "./codex";
import { extForMediaType, synthesizeOne } from "./fish";

const args = { model: "fish/s2.1-pro", voice: "voice-reference", text: "Hello world" };
const url = "https://platform.r2.fish.audio/test.mp3";

test("speech uses website MCP and downloads audio without an API credential", async (t) => {
  const generation = t.mock.method(CodexClient.prototype, "generateStructured", async (request: Parameters<CodexClient["generateStructured"]>[0]) => {
    assert.equal(request.fishMcp, true);
    assert.deepEqual(JSON.parse(request.contents), { text: args.text, voice_id: args.voice, model: "s2.1-pro", language: "en" });
    return { audioUrls: [url], error: "" };
  });
  const download = t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    assert.equal(input, url);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.headers, undefined);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
  });
  const output = await synthesizeOne(args);
  assert.deepEqual([...output.audio], [1, 2, 3]);
  assert.equal(output.mediaType, "audio/mpeg");
  assert.equal(extForMediaType(output.mediaType), "mp3");
  assert.equal(generation.mock.callCount(), 1);
  assert.equal(download.mock.callCount(), 1);
});

test("download retries reuse already generated speech", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "podframes-fish-cache-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const generation = t.mock.method(CodexClient.prototype, "generateStructured", async () => ({ audioUrls: [url], error: "" }));
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => ++attempts === 1
    ? new Response("failure", { status: 503 })
    : new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } }));
  const request = { ...args, cachePath: join(dir, "speech.json") };
  await assert.rejects(synthesizeOne(request), /download failed.*503/);
  assert.deepEqual(JSON.parse(await readFile(request.cachePath, "utf8")).audioUrls, [url]);
  assert.equal((await synthesizeOne(request)).audio.length, 1);
  assert.equal(generation.mock.callCount(), 1);
  await synthesizeOne({ ...request, text: "Changed line" });
  assert.equal(generation.mock.callCount(), 2);
});

test("invalid speech inputs fail before using website credits", async (t) => {
  const generation = t.mock.method(CodexClient.prototype, "generateStructured", async () => { throw new Error("unexpected call"); });
  await assert.rejects(synthesizeOne({ ...args, model: "fish/typo" }), /Unsupported Fish website model/);
  await assert.rejects(synthesizeOne({ ...args, voice: "" }), /voice reference/);
  await assert.rejects(synthesizeOne({ ...args, text: " " }), /text must not be empty/);
  await assert.rejects(synthesizeOne({ ...args, language: "ms;bad" }), /Invalid Fish language code/);
  await assert.rejects(synthesizeOne({ ...args, providerOptions: { temperature: 0.5 } }), /developer API provider options/);
  assert.equal(generation.mock.callCount(), 0);
});

test("selected language reaches Fish and separates speech caches", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "podframes-fish-language-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const languages: string[] = [];
  t.mock.method(CodexClient.prototype, "generateStructured", async (request: Parameters<CodexClient["generateStructured"]>[0]) => {
    languages.push(JSON.parse(request.contents).language);
    return { audioUrls: [url], error: "" };
  });
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } }));
  const request = { ...args, cachePath: join(dir, "speech.json") };
  await synthesizeOne({ ...request, language: "en" });
  await synthesizeOne({ ...request, language: "ms" });
  await synthesizeOne({ ...request, language: "ms-MY" });
  assert.deepEqual(languages, ["en", "ms"]);
});

test("selected speech model reaches Fish and separates speech caches", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "podframes-fish-model-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const models: string[] = [];
  t.mock.method(CodexClient.prototype, "generateStructured", async (request: Parameters<CodexClient["generateStructured"]>[0]) => {
    models.push(JSON.parse(request.contents).model);
    return { audioUrls: [url], error: "" };
  });
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } }));
  const request = { ...args, cachePath: join(dir, "speech.json") };
  await synthesizeOne(request);
  await synthesizeOne({ ...request, model: "fish/drama-3" });
  await synthesizeOne({ ...request, model: "fish/drama-3" });
  assert.deepEqual(models, ["s2.1-pro", "drama-3"]);
});

test("MCP errors never fall back to developer API generation", async (t) => {
  t.mock.method(CodexClient.prototype, "generateStructured", async () => ({ audioUrls: [], error: "Website credits exhausted" }));
  const download = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected request"); });
  await assert.rejects(synthesizeOne(args), /Website credits exhausted/);
  assert.equal(download.mock.callCount(), 0);
});

test("audio URLs must be trusted HTTPS Fish hosts", async (t) => {
  const download = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected request"); });
  for (const bad of ["http://platform.r2.fish.audio/x", "https://127.0.0.1/x", "https://fish.audio.evil.test/x", "https://user:password@platform.r2.fish.audio/x"]) {
    const generation = t.mock.method(CodexClient.prototype, "generateStructured", async () => ({ audioUrls: [bad], error: "" }));
    await assert.rejects(synthesizeOne(args), /HTTPS Fish Audio host/);
    generation.mock.restore();
  }
  assert.equal(download.mock.callCount(), 0);
});

test("corrupt cached speech does not silently buy a replacement", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "podframes-fish-corrupt-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cachePath = join(dir, "speech.json");
  await writeFile(cachePath, "broken JSON");
  const generation = t.mock.method(CodexClient.prototype, "generateStructured", async () => { throw new Error("unexpected call"); });
  await assert.rejects(synthesizeOne({ ...args, cachePath }), SyntaxError);
  assert.equal(generation.mock.callCount(), 0);
});
