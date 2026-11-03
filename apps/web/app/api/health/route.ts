import { resolveEnv, claudeStatus, codexStatus, fishStatus, whisperStatus, workerOnline } from "@podframes/core";
import { heygenStatus } from "@podframes/core";
import { exec } from "node:child_process";
import { findRepoRoot } from "@/lib/root";

export const runtime = "nodejs";

/** Which keys/binaries are configured — the studio header renders these as dots
 *  so misconfiguration is visible up-front, not one stage-failure at a time. */
export async function GET() {
  const env = resolveEnv(findRepoRoot());
  const ffmpeg = await new Promise<boolean>((resolve) => {
    exec("ffmpeg -version", (err) => resolve(!err));
  });
  return Response.json({
    fish: await fishStatus(),
    whisper: await whisperStatus(),
    codex: await codexStatus(),
    claude: await claudeStatus(),
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    automation: (process.env.PODFRAMES_API_TOKEN?.length ?? 0) >= 32,
    worker: workerOnline(findRepoRoot()),
    heygen: await heygenStatus("subscription"),
    fal: !!env.falApiKey,
    replicate: !!env.replicateApiKey,
    ffmpeg,
  });
}
