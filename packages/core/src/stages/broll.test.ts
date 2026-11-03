import test from "node:test";
import assert from "node:assert/strict";
import { brollImagePath, brollImagePrompt } from "./broll";
import { contentHash } from "../util/fs";
import { brollMotion, brollMotionAt } from "../shared";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "../project";
import { DEFAULT_HOSTS } from "../config";
import { Reporter } from "../util/events";
import { runBroll } from "./broll";
import type { StageContext } from "./context";

test("b-roll cache tracks the complete art direction and canvas geometry", () => {
  const cue = { id: "cue-1", imagePrompt: "Close detail of a server rack in daylight" };
  const prompt = brollImagePrompt(cue.imagePrompt);
  assert.ok(prompt.startsWith(cue.imagePrompt));
  assert.match(prompt, /not a news photograph of the actual event/);
  assert.match(prompt, /no text/i);
  assert.equal(brollImagePath(cue), `broll/cue-1-${contentHash(prompt, 8)}.png`);
  assert.equal(brollImagePath(cue, "9:16"), `broll/cue-1-${contentHash(prompt, 8)}-9x16.png`);
  assert.notEqual(brollImagePath(cue), brollImagePath({ ...cue, imagePrompt: "A coastal city at dawn" }));
});

test("resuming B-roll preserves uploaded photos and never silently regenerates a missing photo", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "podframes-photo-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = await Project.create({ topic: "Photo edit", hosts: structuredClone(DEFAULT_HOSTS) }, root, "photo-test");
  project.state.script = { topic: "Photo edit", title: "Photo edit", hook: "", turns: [] };
  project.state.speech = { audioPath: "audio.mp3", durationSec: 6, mediaType: "audio/mpeg", words: [], turns: [] };
  const cue = { id: "cue-1", type: "broll" as const, start: 1, end: 4, imagePrompt: "A candid scene", imagePath: "broll/upload-test.jpg" };
  project.state.broll = { cues: [cue] };
  await mkdir(project.abs("broll"), { recursive: true });
  await writeFile(project.abs(cue.imagePath), "photo fixture");
  const ctx: StageContext = { project, codex: {} as StageContext["codex"], env: {}, reporter: new Reporter({ console: false }) };
  await runBroll(ctx);
  assert.equal(project.state.broll.cues[0]!.imagePath, "broll/upload-test.jpg");
  delete project.state.stages.broll;
  await rm(project.abs(cue.imagePath));
  await assert.rejects(runBroll(ctx), /Uploaded photo.*missing/);
});

test("b-roll pans throughout the cue, alternates direction, and scrubs deterministically", () => {
  for (const index of [0, 1]) {
    const motion = brollMotion(index);
    assert.deepEqual(brollMotionAt(index, 0, 4), motion.from);
    assert.deepEqual(brollMotionAt(index, 4, 4), motion.to);
    const halfway = brollMotionAt(index, 2, 4);
    assert.ok(halfway.scale > motion.from.scale && halfway.scale < motion.to.scale);
    assert.notEqual(halfway.xPercent, motion.from.xPercent);
  }
  assert.equal(brollMotion(0).to.xPercent, -brollMotion(1).to.xPercent);
});
