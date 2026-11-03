import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "./project";
import { DEFAULT_HOSTS } from "./config";
import { compilePerformance } from "./performance";
import { clearTurnClips } from "./editing";
import { isLanguageCode, languageLabel, voicePreviewText, withEmotionCue } from "./shared";
import { validateConfig } from "./validate";
import type { ConversationConfig } from "./types";

test("language choices preserve locale and use translated preview text", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-language-"));
  const config: ConversationConfig = { topic: "Bahasa Melayu", hosts: DEFAULT_HOSTS, language: "ms" };
  validateConfig(config);
  const project = await Project.create(config, root, "language");
  assert.equal((await Project.load(root, project.slug))?.state.config.language, "ms");
  assert.equal(languageLabel("ms-MY"), "Bahasa Melayu");
  assert.match(voicePreviewText("ms"), /selamat/);
  assert.match(voicePreviewText("zh"), /欢迎/);
  assert.equal(isLanguageCode("zh-Hans"), true);
  assert.equal(isLanguageCode("ms;bad"), false);
  assert.throws(() => validateConfig({ ...config, language: "" }), /language must be/);
});

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test("Project.delete removes the project directory and all nested artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-delete-"));
  const dir = join(root, "projects", "demo");
  await mkdir(join(dir, "audio"), { recursive: true });
  await mkdir(join(dir, "clips"), { recursive: true });
  await mkdir(join(dir, "composition", "media", "clips"), { recursive: true });
  await writeFile(join(dir, "project.json"), "{}");
  await writeFile(join(dir, "audio", "conversation.mp3"), "audio");
  await writeFile(join(dir, "clips", "turn-0-0.mp4"), "clip");
  await writeFile(join(dir, "composition", "media", "clips", "turn-0-0.mp4"), "linked clip");
  await writeFile(join(dir, "output.mp4"), "render");

  assert.equal(await Project.delete(root, "demo"), true);
  assert.equal(await exists(dir), false);
});

test("Project.delete ignores directories without project.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-delete-"));
  const dir = join(root, "projects", "_roster");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "avatar.png"), "shared cache");

  assert.equal(await Project.delete(root, "_roster"), false);
  assert.equal(await exists(dir), true);
});

test("Project.load refuses an outdated schemaVersion (clean cutover, no migration)", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-schema-"));
  const config: ConversationConfig = {
    topic: "Old schema refusal",
    hosts: [
      {
        id: "host_a",
        name: "Ada",
        speaker: "HOST_A",
        model: "google/gemini-3.1-flash-tts-preview",
        voice: "Aoede",
        side: "left",
      },
      {
        id: "host_b",
        name: "Theo",
        speaker: "HOST_B",
        model: "google/gemini-3.1-flash-tts-preview",
        voice: "Puck",
        side: "right",
      },
    ],
  };
  const project = await Project.create(config, root, "old-schema");
  // Simulate a project written by an older release: legacy shape + old version.
  project.state.schemaVersion = 2 as never;
  project.state.stills = {
    hosts: { host_a: { idlePath: "stills/host_a-idle.png" } },
  } as never;
  await project.save();

  await assert.rejects(
    () => Project.load(root, "old-schema"),
    /unsupported project\.json schema.*found 2/,
  );
});

test("Project.load fills new non-breaking option defaults on an existing schema", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-defaults-"));
  const config: ConversationConfig = {
    topic: "Keep old projects opening",
    hosts: [
      { id: "host_a", name: "Ada", speaker: "HOST_A", model: "google/model", voice: "Aoede", side: "left" },
      { id: "host_b", name: "Theo", speaker: "HOST_B", model: "google/model", voice: "Puck", side: "right" },
    ],
  };
  const project = await Project.create(config, root, "defaults");
  delete (project.state.options as Partial<typeof project.state.options>).visualTreatment;
  delete (project.state.options as Partial<typeof project.state.options>).heygenAuth;
  await project.save();

  const loaded = await Project.load(root, "defaults");
  assert.equal(loaded?.state.options.visualTreatment, "minimal");
  assert.equal(loaded?.state.options.heygenAuth, "subscription");
});

test("clip regeneration clears failed HeyGen jobs and keeps pending jobs resumable", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-heygen-retry-"));
  const project = await Project.create({ topic: "Retry remote jobs", hosts: DEFAULT_HOSTS }, root, "retry");
  project.state.speech = {
    audioPath: "audio/conversation.mp3", mediaType: "audio/mpeg", durationSec: 3, words: [],
    turns: [0, 1, 2].map((index) => ({
      turnIndex: index, hostId: "host_a", speaker: "HOST_A", text: "Hello",
      start: index, end: index + 1, words: [], mediaType: "audio/mpeg", durationSec: 1,
      segments: [{ audioPath: `audio/turn-${index}-0.mp3`, durationSec: 1 }],
    })),
  };
  project.state.clips = { clips: [{ id: "turn-2-0", role: "avatar", turnIndex: 2,
    path: "clips/turn-2-0.mp4", durationSec: 1, sourceImage: "avatar.png" }] };
  await mkdir(project.path("clips"), { recursive: true });
  for (let i = 0; i < 3; i++) {
    await writeFile(project.path("clips", `turn-${i}-0.mp4.heygen.json`), JSON.stringify({ videoId: `video-${i}`, terminalFailed: i === 0 }));
  }
  await writeFile(project.path("clips", "turn-2-0.mp4"), "clip");
  await clearTurnClips(project, [0, 1, 2]);
  assert.equal(await exists(project.path("clips", "turn-0-0.mp4.heygen.json")), false);
  assert.equal(await exists(project.path("clips", "turn-1-0.mp4.heygen.json")), true);
  assert.equal(await exists(project.path("clips", "turn-2-0.mp4.heygen.json")), false);
  assert.equal(await exists(project.path("clips", "turn-2-0.mp4")), false);
});

test("script duration and reference settings validate before generation", () => {
  const base: ConversationConfig = { topic: "Check sources", hosts: DEFAULT_HOSTS };
  validateConfig({ ...base, targetDurationSec: 120, autoEmotionTags: true, sourceUrls: ["https://www.binance.com/en/support/announcement"] });
  assert.throws(() => validateConfig({ ...base, targetDurationSec: 0 }), /15–600/);
  assert.throws(() => validateConfig({ ...base, sourceUrls: ["http://localhost/private"] }), /public HTTPS/);
  assert.throws(() => validateConfig({ ...base, sourceUrls: Array(6).fill("https://example.com/news") }), /at most five/);
});

test("a per-line Fish cue overrides the host default without conflicting tags", () => {
  const host = { ...DEFAULT_HOSTS[0], defaultStyle: "sarcastic" };
  const turn = { index: 0, hostId: host.id, speaker: host.speaker, text: "[serious] This is confirmed." };
  assert.equal(compilePerformance(host, turn).text, turn.text);
  assert.equal(compilePerformance(host, { ...turn, text: "Hello." }).text, "[sarcastic] Hello.");
  assert.equal(withEmotionCue("  [curious] [laughing] Hello [calm] there.", "serious"), "[serious] Hello [calm] there.");
  assert.equal(withEmotionCue("  [curious] [laughing] Hello.", ""), "Hello.");
});
