import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Project, CodexClient, clearStages, brollImagePrompt, brollImagePath, brollImageGeometry, withProjectLock } from "@podframes/core";
import { findRepoRoot, safeSlug } from "@/lib/root";
import { isRunActiveAnywhere } from "@/lib/runs";
import { projectSummary } from "@/lib/dto";
import { brollUploadExtension } from "@/lib/broll-upload";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Regenerate ONE b-roll cue's image (optionally with a new prompt), matching the
 *  batch studio look via `brollImagePrompt`. Invalidates compose+render only. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; cueId: string }> },
) {
  const { slug, cueId } = await params;
  const safe = safeSlug(slug);
  const root = findRepoRoot();

  if (isRunActiveAnywhere(safe)) {
    return new Response("A generation run is in progress — try again when it finishes.", { status: 409 });
  }

  return withProjectLock(safe, async () => {
    if (isRunActiveAnywhere(safe)) return new Response("A generation run is queued or active. Wait for it to finish.", { status: 409 });
    // Project.load never touches config/options — the persisted state is the truth.
    const project = await Project.load(root, safe);
    if (!project) return new Response("not found", { status: 404 });
    const s = project.state;

    const cue = s.broll?.cues.find((c) => c.id === cueId);
    if (!cue) return new Response("cue not found", { status: 404 });
    if (cue.type !== "broll") return new Response("cue is not a b-roll cue", { status: 400 });

    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return new Response("photo is required", { status: 400 });
      if (file.size > 10 * 1024 * 1024) return new Response("Photo must be up to 10 MB.", { status: 400 });
      const bytes = new Uint8Array(await file.arrayBuffer());
      let extension: string;
      try { extension = brollUploadExtension(bytes); }
      catch (error) { return new Response((error as Error).message, { status: 400 }); }
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
      const rel = `broll/upload-${hash}.${extension}`;
      await mkdir(project.abs("broll"), { recursive: true });
      await writeFile(project.abs(rel), bytes);
      cue.imagePath = rel;
      await clearStages(project, ["compose", "render"]);
      await project.save();
      return Response.json({ ...projectSummary(s), cue, imageUrl: `/api/media/${safe}/${rel}` });
    }

    const body = (await req.json().catch(() => ({}))) as { imagePrompt?: string };
    if (typeof body.imagePrompt === "string" && body.imagePrompt.trim()) cue.imagePrompt = body.imagePrompt.trim();
    if (!cue.imagePrompt) return new Response("cue has no imagePrompt", { status: 400 });

    const codex = new CodexClient();

    // Content-addressed name (same scheme as the batch stage): a prompt change
    // regenerates under a new name; re-rolling the SAME prompt replaces the file.
    // Geometry follows the treatment (square card vs cinematic full-frame),
    // exactly like the batch stage, so a regen never mismatches the composition.
    const geometry = brollImageGeometry(s.options.visualTreatment, s.config.aspectRatio);
    const prior = cue.imagePath;
    const rel = brollImagePath(cue, geometry.aspectRatio);
    const outPath = project.abs(rel);
    await codex.generateImageToFile({
      model: s.options.brollImageModel,
      prompt: brollImagePrompt(cue.imagePrompt),
      aspectRatio: geometry.aspectRatio,
      imageSize: geometry.imageSize,
      outputPath: outPath,
    });
    cue.imagePath = rel;
    if (prior && prior !== rel && prior.startsWith("broll/") && !prior.startsWith("broll/upload-")) await rm(project.abs(prior), { force: true });

    await clearStages(project, ["compose", "render"]);
    await project.save();

    return Response.json({
      ...projectSummary(s),
      cue,
      imageUrl: `/api/media/${safe}/${cue.imagePath}?v=${Date.now()}`,
    });
  });
}
