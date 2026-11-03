import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  automationEvent,
  automationJobs,
  cancelAutomation,
  claimAutomation,
  enqueueAutomation,
} from "./automation";
import { durableUpdate } from "./util/durable";
import { fileURLToPath } from "node:url";

test("queue persists jobs, serializes claims, keeps cancellation and terminal events", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-queue-"));
  try {
    const a = enqueueAutomation(root, "episode-a", { only: ["script"] });
    assert.throws(() => enqueueAutomation(root, "episode-a", {}), /already/);
    enqueueAutomation(root, "episode-b", {});
    assert.equal(claimAutomation(root)?.id, a.id);
    assert.equal(claimAutomation(root), null);
    assert.equal(cancelAutomation(root, "episode-a"), true);
    assert.equal(automationJobs(root)[0]!.cancel, true);
    automationEvent(root, a.id, { type: "done", done: { slug: a.slug } });
    assert.equal(claimAutomation(root)?.slug, "episode-b");
    const b = automationJobs(root)[1]!;
    automationEvent(root, b.id, {
      type: "error",
      message: "uncertain provider result",
    });
    assert.throws(
      () => enqueueAutomation(root, "episode-b", {}),
      /acknowledgeInterrupted/,
    );
    assert.equal(
      enqueueAutomation(root, "episode-b", {}, true).status,
      "queued",
    );
    assert.equal(automationJobs(root)[0]!.events.at(-1)?.type, "done");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dead workers require review and event sequences survive buffer truncation", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-recovery-"));
  try {
    const dead = spawnSync(process.execPath, ["-e", ""]);
    assert.equal(dead.status, 0);
    const job = enqueueAutomation(root, "episode", {});
    claimAutomation(root);
    for (let i = 0; i < 605; i++)
      automationEvent(root, job.id, { type: "event", message: String(i) });
    assert.equal(automationJobs(root)[0]!.events.length, 600);
    assert.ok(automationJobs(root)[0]!.events[0]!.seq > 0);
    durableUpdate(
      root,
      "queue",
      () => ({ jobs: [] as (typeof job)[] }),
      (queue) => {
        queue.jobs[0]!.pid = dead.pid;
      },
    );
    claimAutomation(root);
    assert.equal(automationJobs(root)[0]!.status, "interrupted");
    assert.throws(
      () => enqueueAutomation(root, "episode", {}),
      /acknowledgeInterrupted/,
    );
    assert.equal(enqueueAutomation(root, "episode", {}, true).status, "queued");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("separate worker consumes a durable job and persists its result across processes", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-worker-"));
  try {
    enqueueAutomation(root, "missing-project", { only: ["compose"] });
    const worker = fileURLToPath(
      new URL("../../../scripts/worker.mts", import.meta.url),
    );
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", worker, "--once", "--root", root],
      { encoding: "utf8", timeout: 20_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const job = automationJobs(root)[0]!;
    assert.equal(job.status, "error");
    assert.match(job.events.at(-1)?.message ?? "", /no longer exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
