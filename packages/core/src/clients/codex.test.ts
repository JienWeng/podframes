import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexClient, codexStatus, outputSchema } from "./codex";

test("Codex output schema closes nested objects and wraps array results", () => {
  assert.deepEqual(outputSchema({ type: "object", properties: {
    cues: { type: "array", items: { type: "object", properties: { title: { type: "string" } }, propertyOrdering: ["title"] } },
  } }), {
    type: "object", properties: { cues: { type: "array", items: {
      type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false,
    } } }, required: ["cues"], additionalProperties: false,
  });
});

test("Codex uses subscription auth, isolates requests, and preserves old images on failure", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "podframes-codex-test-"));
  const originalPath = process.env.PATH;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalFishKey = process.env.FISH_API_KEY;
  t.after(async () => {
    process.env.PATH = originalPath;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
    if (originalFishKey === undefined) delete process.env.FISH_API_KEY; else process.env.FISH_API_KEY = originalFishKey;
    await rm(dir, { recursive: true, force: true });
  });
  const binary = join(dir, "codex");
  await writeFile(binary, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'login') { console.log('Logged in using ChatGPT'); process.exit(0); }
if (process.env.OPENAI_API_KEY || process.env.FISH_API_KEY) process.exit(9);
if (!args.includes('--ignore-user-config') || !args.includes('--ephemeral')) process.exit(10);
let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  if (args.includes('--output-schema')) {
    const schema = JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'));
    if (args.includes('mcp_servers.fish-audio.required=true')) {
      if (!args.includes('mcp_servers.fish-audio.enabled_tools=[\"get_credit_balance\",\"text_to_speech\"]')) process.exit(12);
      if (!args.includes('mcp_servers.fish-audio.tools.text_to_speech.approval_mode=\"approve\"')) process.exit(13);
    }
    if (!['array','object'].includes(schema.properties.result.type)) process.exit(11);
    if (args.includes('web_search=\"live\"') && !input.includes('no-search')) {
      console.log(JSON.stringify({type:'item.completed',item:{type:'web_search',action:{type:'search'}}}));
      console.log(JSON.stringify({type:'item.completed',item:{type:'web_search',action:input.includes('metadata-view')?{type:'other'}:{type:'open_page',url:'https://www.binance.com/news'},results:input.includes('metadata-view')?[{ref_id:'turn1view0',url:'https://www.binance.com/news'}]:[]}}));
    }
    fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({result:input.includes('citation-mismatch') ? {sources:[{url:'https://unopened.example.org/news'}]} : input.includes('metadata-view') ? {sources:[{url:'https://www.binance.com/news'}]} : [{title:'Hello'}]}));
  } else if (!input.includes('missing-tool')) {
    fs.writeFileSync(args[args.indexOf('--cd') + 1] + '/output.png', Buffer.from([137,80,78,71,13,10,26,10]));
  }
});


`);
  await chmod(binary, 0o755);
  process.env.PATH = `${dir}:${originalPath}`;
  process.env.OPENAI_API_KEY = "must-not-reach-codex";
  process.env.FISH_API_KEY = "must-not-reach-codex";
  assert.equal(await codexStatus(), true);
  const client = new CodexClient();
  const result = await client.generateStructured({ model: "codex-local", contents: "Hello", schema: {
    type: "array", items: { type: "object", properties: { title: { type: "string" } } },
  } });
  assert.deepEqual(result, [{ title: "Hello" }]);
  assert.deepEqual(await client.generateStructured({ model: "codex-local", fishMcp: true, contents: "Speech", schema: {
    type: "array", items: { type: "object", properties: { title: { type: "string" } } },
  } }), [{ title: "Hello" }]);
  const research = { model: "codex-local", liveResearch: true, contents: "Research", schema: {
    type: "array", items: { type: "object", properties: { title: { type: "string" } } },
  } };
  assert.deepEqual(await client.generateStructured(research), [{ title: "Hello" }]);
  await assert.rejects(client.generateStructured({ ...research, contents: "no-search" }), /did not complete a web check/);
  await assert.rejects(client.generateStructured({ ...research, contents: "citation-mismatch", schema: { type: "object", properties: { sources: { type: "array", items: { type: "object", properties: { url: { type: "string" } } } } } } }), /unopened source link/);
  assert.deepEqual(await client.generateStructured({ ...research, contents: "metadata-view", schema: { type: "object", properties: { sources: { type: "array", items: { type: "object", properties: { url: { type: "string" } } } } } } }), { sources: [{ url: "https://www.binance.com/news" }] });
  const outputPath = join(dir, "avatar.png");
  await client.generateImageToFile({ model: "codex-image", prompt: "portrait", outputPath });
  const prior = await readFile(outputPath);
  await assert.rejects(client.generateImageToFile({ model: "codex-image", prompt: "missing-tool", outputPath }), /no output.png/);
  assert.deepEqual(await readFile(outputPath), prior);
});

test("capacity fallback retries before speech starts and never repeats a possible charge", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "podframes-capacity-test-"));
  const originalPath = process.env.PATH;
  t.after(async () => {
    process.env.PATH = originalPath;
    await rm(dir, { recursive: true, force: true });
  });
  const log = join(dir, "attempts.jsonl");
  const binary = join(dir, "codex");
  await writeFile(binary, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const model = args[args.indexOf('--model') + 1];
let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(model) + '\\n');
  if (model === 'gpt-6.1-sol') {
    if (!input.includes('opaque')) console.log(JSON.stringify({type:'turn.started'}));
    if (input.includes('paid-started')) console.log(JSON.stringify({type:'item.started',item:{type:'mcp_tool_call',tool:'text_to_speech'}}));
    else if (!input.includes('opaque')) console.log(JSON.stringify({type:'item.completed',item:{type:'mcp_tool_call',tool:'get_credit_balance'}}));
    console.error('ERROR: Selected model is at capacity. Please try a different model.');
    process.exit(1);
  }
  fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({result:'ok'}));
});
`);
  await chmod(binary, 0o755);
  process.env.PATH = `${dir}:${originalPath}`;
  const client = new CodexClient();
  const request = { model: "gpt-6.1-sol", fishMcp: true, schema: { type: "string" }, contents: "balance-only" };
  assert.equal(await client.generateStructured(request), "ok");
  assert.deepEqual((await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line)), ["gpt-6.1-sol", "gpt-6-sol"]);
  await writeFile(log, "");
  await assert.rejects(client.generateStructured({ ...request, contents: "paid-started" }), /Check Fish Audio history/);
  assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 1);
  await writeFile(log, "");
  await assert.rejects(client.generateStructured({ ...request, contents: "opaque" }), /Codex models are busy/);
  assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 1);
});
