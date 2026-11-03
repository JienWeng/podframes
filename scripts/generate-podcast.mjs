#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = "what-makes-a-good-cold-open-episode"; // Approved Jason/May template.

async function main() {
  const { values, positionals } = parseArgs({ options: { topic: { type: "string" }, duration: { type: "string" }, check: { type: "boolean" } }, allowPositionals: true });
  const topicMode = values.topic !== undefined;
  if (positionals.length !== (topicMode ? 1 : 2)) throw new Error("Usage: node scripts/generate-podcast.mjs <episode.md|episode.txt> <episode-slug> [--check]\nOr: node scripts/generate-podcast.mjs --topic <topic> <episode-slug> [--duration <seconds>] [--check]");
  const slug = positionals[topicMode ? 0 : 1];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Episode slug must use lowercase letters, numbers, and single hyphens.");
  const command = ["podframes", "generate", "--template", template, "--slug", slug];
  if (topicMode) {
    if (!values.topic.trim()) throw new Error("Supply a non-empty topic.");
    command.push("--topic", values.topic);
    if (values.duration !== undefined) {
      const seconds = Number(values.duration);
      if (!Number.isFinite(seconds) || seconds < 15 || seconds > 600) throw new Error("Duration must be 15–600 seconds.");
      command.push("--duration", String(seconds));
    }
  } else {
    if (values.duration !== undefined) throw new Error("--duration guides topic drafting; it cannot shorten an imported script.");
    const input = positionals[0];
    if (!/\.(md|txt)$/i.test(input)) throw new Error("Supply a speaker-labelled .md or .txt script.");
    const script = resolve(process.cwd(), input);
    await access(script);
    command.push("--script", script);
  }
  if (values.check) command.push("--only", "script");
  const child = spawn("pnpm", command, { cwd: root, stdio: "inherit", env: { ...process.env, INIT_CWD: root } });
  child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
    if (code === 0) console.log(values.check ? "Script stage complete. Re-run without --check to generate the video." : `Video: ${resolve(root, "projects", slug, "output.mp4")}`);
  });
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
