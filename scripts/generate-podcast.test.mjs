import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("standalone runner forwards paths safely, supports validation, and propagates failure", async (t) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "podcast-runner-test-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const capture = join(dir, "capture.json");
  await writeFile(join(dir, "pnpm"), '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.PODCAST_TEST_CAPTURE,JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));process.exit(Number(process.env.PODCAST_TEST_EXIT||0));\n', { mode: 0o755 });
  await writeFile(join(dir, "my episode.md"), "HOST_A: Hello\nHOST_B: Hi\n");
  const run = (args, code = "0") => spawnSync(process.execPath, [join(root, "scripts/generate-podcast.mjs"), ...args], {
    cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PODCAST_TEST_CAPTURE: capture, PODCAST_TEST_EXIT: code },
  });
  assert.equal(run(["my episode.md", "episode-004", "--check"]).status, 0);
  const checked = JSON.parse(await readFile(capture, "utf8"));
  assert.equal(checked.cwd, root);
  assert.deepEqual(checked.args, ["podframes", "generate", "--template", "what-makes-a-good-cold-open-episode", "--slug", "episode-004", "--script", join(dir, "my episode.md"), "--only", "script"]);
  assert.equal(run(["--topic", "A topic; not a shell command", "episode-005", "--duration", "90", "--check"]).status, 0);
  assert.deepEqual(JSON.parse(await readFile(capture, "utf8")).args, ["podframes", "generate", "--template", "what-makes-a-good-cold-open-episode", "--slug", "episode-005", "--topic", "A topic; not a shell command", "--duration", "90", "--only", "script"]);
  assert.equal(run(["--topic", "Topic", "episode-005", "--duration", "0"]).status, 1);
  assert.equal(run(["--topic", "", "episode-005"]).status, 1);
  assert.equal(run(["my episode.md", "episode-004", "--duration", "90"]).status, 1);
  assert.equal(run(["my episode.md", "episode-004"], "7").status, 7);
  assert.ok(!JSON.parse(await readFile(capture, "utf8")).args.includes("--force"));
  assert.equal(run(["my episode.md", "../bad"]).status, 1);
  assert.equal(run([]).status, 1);
});
