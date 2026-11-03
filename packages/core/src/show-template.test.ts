import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "./project";
import { DEFAULT_HOSTS } from "./config";
import { applyShowTemplate } from "./show-template";
import { generate } from "./pipeline";
import { parsePastedScript } from "./script-import";
import { runBroll } from "./stages/broll";
import { clearStages } from "./editing";
import { Reporter } from "./util/events";
import type { StageContext } from "./stages/context";

test("a show template copies exact portraits and reuses relevant B-roll with fresh timing", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "podframes-template-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = { topic: "Show", hosts: structuredClone(DEFAULT_HOSTS), language: "zh" };
  const source = await Project.create(config, root, "show-template");
  await mkdir(source.abs("stills"), { recursive: true });
  await mkdir(source.abs("broll"), { recursive: true });
  await writeFile(source.abs("stills/a.png"), "portrait A");
  await writeFile(source.abs("stills/b.png"), "portrait B");
  await writeFile(source.abs("broll/photo.jpg"), "existing photo");
  source.state.uploads = { [config.hosts[0].id]: "stills/a.png" };
  source.state.stills = { hosts: { [config.hosts[1].id]: { imagePath: "stills/b.png" } } };
  source.state.broll = { cues: [{ id: "old", type: "broll", start: 80, end: 84, title: "Studio", imagePrompt: "A recording studio", imagePath: "broll/photo.jpg" }] };
  await source.save();
  const script = parsePastedScript("HOST_A: 新一集。\nHOST_B: 一起看看。", config.hosts);
  const episode = await generate({ ...config, topic: "New episode" }, { root, slug: "episode-2", template: source.slug, script, only: ["script"], console: false });
  const portrait = episode.state.uploads![config.hosts[0].id]!;
  assert.equal(await readFile(episode.abs(portrait), "utf8"), "portrait A");
  assert.equal(episode.state.templateSource, source.slug);
  assert.equal(episode.state.broll, undefined);
  assert.equal(episode.state.speech, undefined);
  assert.equal(episode.state.clips, undefined);
  await writeFile(source.abs("stills/a.png"), "changed source");
  assert.equal(await readFile(episode.abs(portrait), "utf8"), "portrait A");
  episode.state.speech = { audioPath: "audio.mp3", durationSec: 8, mediaType: "audio/mpeg", words: [], turns: [] };
  const codex = {
    generateStructured: async (args: { contents: string }) => {
      assert.match(args.contents, /asset-1/);
      return [{ type: "broll", start: 1, end: 4, reuseImageId: "asset-1", title: "Studio" }];
    },
    generateImageToFile: async () => { throw new Error("Saved image must be reused"); },
  } as unknown as StageContext["codex"];
  await runBroll({ project: episode, codex, env: {}, reporter: new Reporter({ console: false }) });
  assert.equal(episode.state.broll!.cues[0]!.start, 1);
  const imagePath = episode.state.broll!.cues[0]!.imagePath!;
  assert.equal(await readFile(episode.abs(imagePath), "utf8"), "existing photo");
  await clearStages(episode, ["broll"]);
  await access(episode.abs(imagePath));
  await Project.delete(root, source.slug);
  await access(episode.abs(portrait));
  await access(episode.abs(imagePath));
});

test("invalid templates fail without replacing characters or leaving a partial episode", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "podframes-template-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = { topic: "Show", hosts: structuredClone(DEFAULT_HOSTS) };
  const source = await Project.create(config, root, "missing-portraits");
  const script = parsePastedScript("A: Hello.\nB: Hi.", config.hosts);
  await assert.rejects(generate(config, { root, slug: "new-episode", template: source.slug, script, only: ["script"], console: false }), /no saved portrait/);
  assert.equal(await Project.load(root, "new-episode"), null);
  const target = await Project.create(config, root, "other");
  await writeFile(join(root, "outside.png"), "private file");
  source.state.uploads = { [config.hosts[0].id]: "../../outside.png" };
  await assert.rejects(applyShowTemplate(target, source), /inside its project/);
  await assert.rejects(applyShowTemplate(source, source), /different slugs/);
});
