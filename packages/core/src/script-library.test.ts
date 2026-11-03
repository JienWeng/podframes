import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadScriptExamples } from "./script-library";

test("script library uses language-specific excerpts, English fallback, and fresh edits", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "podframes-library-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await loadScriptExamples(root, "zh"), "");
  const dir = join(root, "examples/script-library");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "zh-01.md"), "ZH_STYLE_MARKER");
  await writeFile(join(dir, "en-01.md"), "EN_STYLE_MARKER");
  await writeFile(join(root, "private.md"), "PRIVATE_MARKER");
  await symlink(join(root, "private.md"), join(dir, "zh-private.md"));
  const chinese = await loadScriptExamples(root, "zh-CN");
  assert.match(chinese, /ZH_STYLE_MARKER/);
  assert.match(chinese, /not sources or evidence/);
  assert.doesNotMatch(chinese, /EN_STYLE_MARKER|PRIVATE_MARKER/);
  assert.match(await loadScriptExamples(root, "fr"), /EN_STYLE_MARKER/);
  await writeFile(join(dir, "zh-01.md"), "EDITED_STYLE_MARKER");
  assert.match(await loadScriptExamples(root, "zh"), /EDITED_STYLE_MARKER/);
  await writeFile(join(dir, "zh-01.md"), "x".repeat(6001));
  await assert.rejects(loadScriptExamples(root, "zh"), /too long/);
});
