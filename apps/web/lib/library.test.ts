import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_HOSTS, Project } from "@podframes/core";
import {
  saveCast,
  readCast,
  listLibrary,
  libraryId,
  applySavedCast,
  createSeries,
  createSeriesEpisode,
} from "./library";

const portrait = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "podframes-library-"));
  const hosts = structuredClone(DEFAULT_HOSTS);
  hosts[0].model = "fish/drama-3";
  hosts[0].defaultStyle = "quietly curious";
  const project = await Project.create(
    {
      topic: "A reusable show",
      hosts,
      language: "zh",
      options: {
        captionStyle: "clean",
        videoProvider: "heygen",
        heygenAuth: "subscription",
      },
    },
    root,
    "source",
  );
  await mkdir(project.abs("stills"), { recursive: true });
  for (const host of hosts)
    await writeFile(project.abs(`stills/${host.id}.png`), portrait);
  project.state.uploads = Object.fromEntries(
    hosts.map((host) => [host.id, `stills/${host.id}.png`]),
  );
  await project.save();
  return { root, project };
}

test("saved cast copies its portrait and settings and preserves the target role", async (t) => {
  const { root, project } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const saved = await saveCast(
    { ...project.state.config.hosts[0], avatarKey: "ada" },
    portrait,
    root,
  );
  assert.equal((await readCast(saved.id, root)).host.model, "fish/drama-3");
  assert.equal(saved.host.avatarKey, undefined);
  const target = project.state.config.hosts[1];
  const originalRole = {
    id: target.id,
    side: target.side,
    speaker: target.speaker,
  };
  await applySavedCast(project, saved.id, target.id);
  assert.deepEqual(
    {
      id: project.state.config.hosts[1].id,
      side: project.state.config.hosts[1].side,
      speaker: project.state.config.hosts[1].speaker,
    },
    originalRole,
  );
  assert.equal(project.state.config.hosts[1].model, "fish/drama-3");
  assert.equal(project.state.config.hosts[1].defaultStyle, "quietly curious");
  assert.deepEqual(
    new Uint8Array(
      await readFile(project.abs(project.state.uploads![target.id])),
    ),
    portrait,
  );
  assert.equal((await listLibrary(root)).cast.length, 1);
  assert.throws(() => libraryId("../../secret"), /Invalid library/);
  await assert.rejects(saveCast(target, new Uint8Array([1, 2]), root), /PNG/);
});

test("series retains independent template assets after the source video is removed", async (t) => {
  const { root, project } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const series = await createSeries(
    "The weekly show",
    "Natural Mandarin conversation",
    project.slug,
    root,
  );
  await Project.delete(root, project.slug);
  const episode = await createSeriesEpisode(series.id, root);
  assert.equal(episode.state.seriesId, series.id);
  assert.equal(episode.state.config.language, "zh");
  assert.equal(episode.state.config.hosts[0].model, "fish/drama-3");
  assert.equal(episode.state.options.videoProvider, "heygen");
  assert.equal(episode.state.options.captionStyle, "clean");
  assert.equal(episode.state.script, undefined);
  assert.equal(episode.state.speech, undefined);
  for (const path of Object.values(episode.state.uploads!))
    assert.deepEqual(
      new Uint8Array(await readFile(episode.abs(path))),
      portrait,
    );
  assert.equal((await listLibrary(root)).series[0].id, series.id);
});

test("library API saves existing cast and starts linked series episodes", async (t) => {
  const { root, project } = await fixture();
  const previous = process.cwd();
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []");
  process.chdir(root);
  t.after(async () => { process.chdir(previous); await rm(root, { recursive: true, force: true }); });
  const { POST } = await import("../app/api/library/route");
  const request = (body: unknown) => new Request("http://localhost/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const saved = await POST(request({ kind: "cast", slug: project.slug, hostId: "host_a" }));
  assert.equal(saved.status, 201);
  assert.equal((await saved.json()).host.model, "fish/drama-3");
  const created = await POST(request({ kind: "series", title: "API show", description: "", template: project.slug }));
  assert.equal(created.status, 201);
  const series = await created.json();
  const episode = await POST(request({ kind: "episode", seriesId: series.id }));
  assert.equal(episode.status, 201);
  assert.equal((await episode.json()).seriesId, series.id);
  assert.equal((await POST(request({ kind: "episode", seriesId: "../../private" }))).status, 400);
});
