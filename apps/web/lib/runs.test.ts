import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  automationEvent,
  claimAutomation,
  enqueueAutomation,
} from "@podframes/core";
import { GET } from "../app/api/projects/[slug]/run/route";

test("progress stream stays with its job when a newer run is queued", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-stream-"));
  const cwd = process.cwd();
  try {
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []");
    process.chdir(root);
    const first = enqueueAutomation(root, "episode", {});
    claimAutomation(root);
    const response = await GET(
      new Request("http://localhost/api/projects/episode/run"),
      { params: Promise.resolve({ slug: "episode" }) },
    );
    const reader = response.body!.getReader();
    await reader.read();
    automationEvent(root, first.id, {
      type: "done",
      done: { slug: "first-job" },
    });
    enqueueAutomation(root, "episode", {});
    const terminal = await reader.read();
    assert.match(new TextDecoder().decode(terminal.value), /first-job/);
    assert.equal((await reader.read()).done, true);
  } finally {
    process.chdir(cwd);
    await rm(root, { recursive: true, force: true });
  }
});
