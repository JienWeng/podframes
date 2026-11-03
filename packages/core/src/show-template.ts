import { copyFile, mkdir, readFile, realpath } from "node:fs/promises";
import { extname, sep } from "node:path";
import { createHash } from "node:crypto";
import type { Project } from "./project";

/** Copy original assets, never links back to mutable files in another episode. */
export async function applyShowTemplate(target: Project, source: Project): Promise<void> {
  if (target.slug === source.slug) throw new Error("Template and new episode must have different slugs.");
  const sourceDir = await realpath(source.dir);
  const copyAsset = async (path: string): Promise<string> => {
    const file = await realpath(source.abs(path));
    if (!file.startsWith(sourceDir + sep)) throw new Error("Template image must be inside its project directory.");
    const bytes = await readFile(file);
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const extension = extname(file).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) throw new Error("Template images must be PNG, JPEG, or WebP.");
    const rel = `assets/template/${hash}${extension}`;
    await mkdir(target.abs("assets/template"), { recursive: true });
    await copyFile(file, target.abs(rel));
    return rel;
  };
  const uploads: Record<string, string> = {};
  for (const host of target.state.config.hosts) {
    const image = source.state.uploads?.[host.id] ?? source.state.stills?.hosts[host.id]?.imagePath;
    if (!image) throw new Error(`Template has no saved portrait for ${host.name}. Generate or upload its face first.`);
    uploads[host.id] = await copyAsset(image);
  }
  const candidates = [
    ...(source.state.brollLibrary ?? []),
    ...(source.state.broll?.cues ?? []).filter((cue) => cue.type === "broll" && cue.imagePath).map((cue) => ({
      title: cue.title ?? "", description: cue.imagePrompt ?? cue.title ?? "", imagePath: cue.imagePath!,
    })),
  ];
  const library: NonNullable<Project["state"]["brollLibrary"]> = [];
  for (const candidate of candidates) {
    const imagePath = await copyAsset(candidate.imagePath);
    if (!library.some((image) => image.imagePath === imagePath)) library.push({ id: `asset-${library.length + 1}`, title: candidate.title, description: candidate.description, imagePath });
  }
  target.state.uploads = uploads;
  target.state.brollLibrary = library;
  target.state.templateSource = source.slug;
  target.state.stills = { hosts: Object.fromEntries(Object.entries(uploads).map(([id, imagePath]) => [id, { imagePath }])) };
  target.markDone("stills", { template: source.slug });
  await target.save();
}
