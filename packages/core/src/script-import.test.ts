import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePastedScript, validateManualScript } from "./script-import";
import { DEFAULT_HOSTS } from "./config";
import { Project } from "./project";
import { generateProject, STAGES } from "./pipeline";

const hosts = structuredClone(DEFAULT_HOSTS);
hosts[0].name = "Jason"; hosts[1].name = "May";

test("plain text import maps names, preserves delivery and multiline dialogue", () => {
  const script = parsePastedScript("Jason: [curious] What happened?\nA second sentence.\n\nMay: We checked at 10:30.", hosts, "News");
  assert.equal(script.title, "News");
  assert.deepEqual(script.turns.map((turn) => [turn.index, turn.hostId, turn.text]), [
    [0, hosts[0].id, "[curious] What happened?\nA second sentence."], [1, hosts[1].id, "We checked at 10:30."],
  ]);
  assert.equal(script.sources, undefined);
});

test("Markdown import accepts a title, bold labels, fences, CRLF and Chinese colons", () => {
  const script = parsePastedScript("\uFEFF```markdown\r\n# 交易所新闻\r\n- **Jason:** [serious] 先看公告。\r\n**May**：好，别混淆。\r\n```", hosts);
  assert.equal(script.title, "交易所新闻");
  assert.deepEqual(script.turns.map((turn) => turn.text), ["[serious] 先看公告。", "好，别混淆。"]);
});

test("canonical host labels work independently of names; malformed scripts fail visibly", () => {
  assert.equal(parsePastedScript("HOST_A: First\nHOST_B: Second", hosts).turns[1]!.hostId, hosts[1].id);
  for (const input of ["", "Unlabelled intro\nA: First\nB: Second", "Jason: Only one", "Jason: One\nUnknown: Two", "Jason:\nMay: Two", "x".repeat(50_001)]) {
    assert.throws(() => parsePastedScript(input, hosts));
  }
  assert.throws(() => validateManualScript({ title: "", topic: "", hook: "", turns: [{ hostId: "other", text: "One" }, { hostId: hosts[1].id, text: "Two" }] }, hosts));
});

test("imported pipeline skips drafting and resumes unchanged audio without spending", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "podframes-import-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = await Project.create({ topic: "Import test", hosts }, root, "import-test");
  const script = parsePastedScript("A: Hello.\nB: Hi.", hosts, "Import test");
  const drafting = t.mock.method(STAGES[0]!, "run", async () => { throw new Error("Imported script must never be rewritten"); });
  await generateProject(project, { script, only: ["script"], force: true, console: false });
  assert.deepEqual(project.state.script, script);
  assert.equal(project.stageDone("script"), true);
  assert.equal(drafting.mock.callCount(), 0);
  await mkdir(project.abs("audio"), { recursive: true });
  await writeFile(project.abs("audio/keep.mp3"), "existing audio");
  project.markDone("speech");
  await generateProject(project, { script, only: ["script"], console: false });
  await access(project.abs("audio/keep.mp3"));
  assert.equal(project.stageDone("speech"), true);
  await generateProject(project, { script: parsePastedScript("A: Changed.\nB: Hi.", hosts), only: ["script"], console: false });
  assert.equal(project.stageDone("speech"), false);
  await assert.rejects(access(project.abs("audio/keep.mp3")));
});
