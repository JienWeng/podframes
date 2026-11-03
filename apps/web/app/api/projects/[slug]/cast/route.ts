import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Project, CodexClient, avatarPrompt, clearStages, withProjectLock } from "@podframes/core";
import { findRepoRoot, safeSlug } from "@/lib/root";
import { isRunActiveAnywhere } from "@/lib/runs";
import { applySavedCast } from "@/lib/library";
import { projectSummary } from "@/lib/dto";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Per-host face control.
 *   multipart/form-data { hostId, file } → upload a reference photo as the host's base.
 *   JSON { hostId, appearance } → generate a base portrait through local Codex.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const safe = safeSlug(slug);
  const root = findRepoRoot();

  if (isRunActiveAnywhere(safe)) {
    return new Response("A generation run is in progress — try again when it finishes.", { status: 409 });
  }

  return withProjectLock(safe, async () => {
    if (isRunActiveAnywhere(safe)) return new Response("A generation run is queued or active. Wait for it to finish.", { status: 409 });
    if (isRunActiveAnywhere(safe)) return new Response("Wait for generation to finish.", { status: 409 });
    // Project.load never touches config/options — the persisted state is the truth.
    const project = await Project.load(root, safe);
    if (!project) return new Response("not found", { status: 404 });
    const s = project.state;
    const ctype = req.headers.get("content-type") ?? "";

    if (ctype.includes("application/json")) {
      const body = await req.json().catch(() => null);
      const host = s.config.hosts.find((h) => h.id === body?.hostId);
      if (!host) return new Response("unknown host", { status: 400 });
      if (typeof body.castId === "string") {
        try { await applySavedCast(project, body.castId, host.id); }
        catch (error) { return new Response(error instanceof Error ? error.message : "Could not apply saved cast.", { status: 400 }); }
        return Response.json({ ...projectSummary(s), hostId: host.id, hosts: s.config.hosts, uploads: s.uploads });
      }
      if (typeof body.appearance !== "string" || !body.appearance.trim() || body.appearance.length > 2000) {
        return new Response("appearance must be 1–2000 characters", { status: 400 });
      }
      const appearance = body.appearance.trim();
      const rel = join("stills", `${host.id}-generated-${Date.now()}.png`);
      try {
        await new CodexClient({ signal: req.signal }).generateImageToFile({
          model: s.options.imageModel,
          prompt: avatarPrompt({ ...host, appearance }, s.config.aspectRatio ?? "16:9"),
          aspectRatio: s.config.aspectRatio ?? "16:9",
          imageSize: s.options.videoResolution === "1080p" ? "2K" : "1K",
          outputPath: project.abs(rel),
        });
      } catch (error) {
        return new Response(error instanceof Error ? error.message : String(error), { status: 502 });
      }
      const prior = s.uploads?.[host.id];
      s.uploads = { ...(s.uploads ?? {}), [host.id]: rel };
      host.appearance = appearance;
      delete host.avatarKey;
      await clearStages(project, ["stills", "video", "compose", "render"]);
      await project.save();
      if (prior && prior !== rel) await rm(project.abs(prior), { force: true });
      return Response.json({ ...projectSummary(s), hostId: host.id, uploads: s.uploads });
    }

    // ── Upload: just save the base + point the host at it. No image generation. ──
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const hostId = String(form.get("hostId") ?? "");
      const file = form.get("file");
      if (!(file instanceof File)) return new Response("file is required", { status: 400 });
      if (!s.config.hosts.some((h) => h.id === hostId)) return new Response("unknown host", { status: 400 });

      const rel = join("stills", `${hostId}-base.png`);
      const abs = project.abs(rel);
      await mkdir(dirname(abs), { recursive: true });
      const prior = s.uploads?.[hostId];
      if (prior && prior !== rel) await rm(project.abs(prior), { force: true });
      await writeFile(abs, Buffer.from(await file.arrayBuffer()));
      s.uploads = { ...(s.uploads ?? {}), [hostId]: rel };
      const host = s.config.hosts.find((h) => h.id === hostId);
      if (host) delete host.avatarKey;

      // New base → rebuild stills state, re-animate, recompose.
      await clearStages(project, ["stills", "video", "compose", "render"]);
      await project.save();
      return Response.json({ ...projectSummary(s), hostId, uploads: s.uploads ?? null });
    }

    return new Response("unsupported face action", { status: 415 });
  });
}
