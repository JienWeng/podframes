import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WritingClient,
  writingModel,
  verifyWritingSources,
  claudeStatus,
} from "./writing";
import { CodexClient } from "./codex";

const schema = {
  type: "object",
  properties: {
    sources: {
      type: "array",
      items: { type: "object", properties: { url: { type: "string" } } },
    },
  },
};
const result = { sources: [{ url: "https://www.example.org/news" }] };
const request = {
  model: "openai/test-model",
  contents: "Research a topic",
  schema,
  liveResearch: true,
};

function restoreEnv(t: { after: (fn: () => void) => void }, keys: string[]) {
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  });
}

test("writer routing validates model IDs and rejects unverified sources", () => {
  assert.deepEqual(writingModel("codex-local"), {
    provider: "codex",
    model: "codex-local",
  });
  assert.deepEqual(writingModel("claude-code/sonnet"), {
    provider: "claude-code",
    model: "sonnet",
  });
  for (const value of [
    "other/model",
    "anthropic/",
    "openai/https://x",
    "claude-code/--unsafe",
  ])
    assert.throws(() => writingModel(value), /valid model/);
  assert.throws(
    () => verifyWritingSources(result, false, [result.sources[0]!.url]),
    /research/,
  );
  assert.throws(
    () => verifyWritingSources(result, true, ["https://unopened.example.org"]),
    /unopened/,
  );
  assert.throws(
    () =>
      verifyWritingSources({ sources: [null] }, true, [result.sources[0]!.url]),
    /invalid/,
  );
});

test("OpenAI API uses explicit billing and verifies opened URLs", async (t) => {
  restoreEnv(t, ["OPENAI_API_KEY"]);
  process.env.OPENAI_API_KEY = "test-openai";
  t.mock.method(
    globalThis,
    "fetch",
    async (url: unknown, init?: RequestInit) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(
        (init!.headers as Record<string, string>).Authorization,
        "Bearer test-openai",
      );
      const payload = JSON.parse(String(init!.body));
      assert.equal(payload.model, "test-model");
      assert.equal(payload.store, false);
      assert.equal(payload.text.format.strict, true);
      return Response.json({
        status: "completed",
        output: [
          {
            type: "web_search_call",
            status: "completed",
            action: { type: "search" },
          },
          {
            type: "web_search_call",
            status: "completed",
            action: { type: "open_page", url: result.sources[0]!.url },
          },
          {
            type: "message",
            content: [
              { type: "output_text", text: JSON.stringify({ result }) },
            ],
          },
        ],
      });
    },
  );
  assert.deepEqual(
    await new WritingClient().generateStructured(request),
    result,
  );
});

test("Anthropic API continues paused research and verifies fetched pages", async (t) => {
  restoreEnv(t, ["ANTHROPIC_API_KEY"]);
  process.env.ANTHROPIC_API_KEY = "test-anthropic";
  let calls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: unknown, init?: RequestInit) => {
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      const payload = JSON.parse(String(init!.body));
      assert.equal(payload.output_config.format.type, "json_schema");
      calls++;
      if (calls === 1)
        return Response.json({
          stop_reason: "pause_turn",
          content: [
            {
              type: "web_search_tool_result",
              content: [{ url: result.sources[0]!.url }],
            },
          ],
        });
      assert.equal(payload.messages.length, 2);
      return Response.json({
        stop_reason: "end_turn",
        content: [
          {
            type: "web_fetch_tool_result",
            content: { type: "web_fetch_result", url: result.sources[0]!.url },
          },
          { type: "text", text: JSON.stringify({ result }) },
        ],
      });
    },
  );
  assert.deepEqual(
    await new WritingClient().generateStructured({
      ...request,
      model: "anthropic/test-model",
    }),
    result,
  );
  assert.equal(calls, 2);
});

test("API errors never fall back to a subscription or another provider", async (t) => {
  restoreEnv(t, ["OPENAI_API_KEY"]);
  process.env.OPENAI_API_KEY = "test-openai";
  const fallback = t.mock.method(
    CodexClient.prototype,
    "generateStructured",
    async () => {
      throw new Error("unexpected fallback");
    },
  );
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("error", { status: 401 }),
  );
  await assert.rejects(
    new WritingClient().generateStructured(request),
    /HTTP 401/,
  );
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(fallback.mock.callCount(), 0);
});

test("Claude Code uses isolated subscription auth and verified web-tool results", async (t) => {
  restoreEnv(t, ["PATH", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
  const dir = await mkdtemp(join(tmpdir(), "podframes-writer-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const executable = join(dir, "claude");
  await writeFile(
    executable,
    `#!${process.execPath}
const args = process.argv.slice(2);
if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) process.exit(9);
if (args[0] === 'auth') { console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai'})); process.exit(0); }
if (!args.includes('--safe-mode') || !args.includes('--strict-mcp-config') || !args.includes('dontAsk') || args.includes('--dangerously-skip-permissions')) process.exit(10);
if (!process.cwd().includes('podframes-claude-')) process.exit(11);
let text='';process.stdin.on('data',d=>text+=d);process.stdin.on('end',()=>{
console.log(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',id:'s',name:'WebSearch',input:{query:'news'}},{type:'tool_use',id:'f',name:'WebFetch',input:{url:'https://www.example.org/news'}}]}}));
console.log(JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:'s',content:'found'},{type:'tool_result',tool_use_id:'f',content:'read',is_error:text.includes('failed-fetch')}]}}));
console.log(JSON.stringify({type:'result',subtype:'success',structured_output:{result:{sources:[{url:'https://www.example.org/news'}]}}}));
});`,
  );
  await chmod(executable, 0o755);
  process.env.PATH = `${dir}:${process.env.PATH}`;
  process.env.ANTHROPIC_API_KEY = "must-not-reach-claude";
  process.env.OPENAI_API_KEY = "must-not-reach-claude";
  assert.equal(await claudeStatus(), true);
  const client = new WritingClient();
  assert.deepEqual(
    await client.generateStructured({
      ...request,
      model: "claude-code/sonnet",
    }),
    result,
  );
  await assert.rejects(
    client.generateStructured({
      ...request,
      model: "claude-code/sonnet",
      contents: "failed-fetch",
    }),
    /research/,
  );
});
