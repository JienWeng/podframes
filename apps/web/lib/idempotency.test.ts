import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { idempotentRequest } from "./idempotency";
import { generationAdmission } from "./usage-limits";

test("request receipts replay once, reject changed input and block uncertain retries", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-receipts-"));
  try {
    let calls = 0;
    const req = (key = "same-request-key-0001", body = "{}") =>
      new Request("http://localhost/api/v1/projects", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body,
      });
    const action = async () => {
      calls++;
      return Response.json({ slug: "one-episode" });
    };
    assert.equal((await idempotentRequest(root, req(), action)).status, 200);
    const replay = await idempotentRequest(root, req(), action);
    assert.equal(replay.headers.get("Idempotency-Replayed"), "true");
    assert.equal(calls, 1);
    const audio = await idempotentRequest(
      root,
      req("binary-request-0003"),
      async () =>
        new Response(new Uint8Array([0, 255, 128, 1]), {
          headers: { "Content-Type": "audio/mpeg" },
        }),
    );
    assert.equal(audio.status, 200);
    const audioReplay = await idempotentRequest(
      root,
      req("binary-request-0003"),
      action,
    );
    assert.deepEqual(
      [...new Uint8Array(await audioReplay.arrayBuffer())],
      [0, 255, 128, 1],
    );
    assert.equal(
      (await idempotentRequest(root, req(undefined, "different"), action))
        .status,
      409,
    );
    await assert.rejects(
      idempotentRequest(root, req("uncertain-request-0002"), async () => {
        throw new Error("crash");
      }),
    );
    assert.equal(
      (await idempotentRequest(root, req("uncertain-request-0002"), action))
        .status,
      409,
    );
    assert.equal(calls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("daily admission is durable and replays do not consume another operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-usage-"));
  const prior = process.env.PODFRAMES_DAILY_GENERATION_LIMIT;
  process.env.PODFRAMES_DAILY_GENERATION_LIMIT = "1";
  try {
    const req = (key: string) =>
      new Request("http://localhost/api/v1/generate", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });
    assert.equal(generationAdmission(root, req("one")), null);
    assert.equal(generationAdmission(root, req("one")), null);
    assert.equal(generationAdmission(root, req("two"))?.status, 429);
    assert.equal(
      generationAdmission(
        root,
        new Request("http://localhost/api/generate", {
          method: "POST",
          headers: { "Idempotency-Key": "one" },
        }),
      )?.status,
      429,
    );
    assert.equal(
      generationAdmission(root, new Request("http://localhost/api/projects")),
      null,
    );
  } finally {
    if (prior === undefined)
      delete process.env.PODFRAMES_DAILY_GENERATION_LIMIT;
    else process.env.PODFRAMES_DAILY_GENERATION_LIMIT = prior;
    await rm(root, { recursive: true, force: true });
  }
});
