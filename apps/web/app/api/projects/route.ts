import { existsSync } from "node:fs";
import { join } from "node:path";
import { Project, slugify, applyShowTemplate, withProjectLock } from "@podframes/core";
import type { ConversationConfig } from "@podframes/core";
import { listProjectSummaries } from "@/lib/projects";
import { findRepoRoot, projectsDir } from "@/lib/root";
import { projectDetail } from "@/lib/dto";
import { syncRosterAvatarUploads } from "@/lib/avatar-assets";
import { isRunActiveAnywhere } from "@/lib/runs";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ projects: await listProjectSummaries() });
}

/** A free slug derived from the topic — never collides with an existing project. */
function uniqueSlug(topic: string): string {
  const base = slugify(topic);
  let slug = base;
  for (let n = 2; existsSync(join(projectsDir(), slug, "project.json")); n++) slug = `${base}-${n}`;
  return slug;
}

/**
 * Create an empty project (no stages run) so per-host face actions in Step 1 have a project
 * to write to before the topic/script exist. The slug is unique so it never hijacks an
 * existing project; a later topic edit keeps this slug (PATCH never re-slugs).
 */
export async function POST(req: Request) {
  let body: { config?: ConversationConfig; template?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }
  const root = findRepoRoot();
  if (body?.template !== undefined) {
    if (typeof body.template !== "string" || !/^[a-z0-9][a-z0-9-]*$/i.test(body.template)) return new Response("invalid template slug", { status: 400 });
    const sourceSlug = body.template;
    return withProjectLock(sourceSlug, async () => {
      if (isRunActiveAnywhere(sourceSlug)) return new Response("Wait for this project's current generation to finish before using it as a template.", { status: 409 });
      const source = await Project.load(root, sourceSlug);
      if (!source) return new Response("template not found", { status: 404 });
      const config: ConversationConfig = { ...structuredClone(source.state.config), topic: "New episode", sourceUrls: [], options: structuredClone(source.state.options) };
      const project = await Project.create(config, root, uniqueSlug(`${sourceSlug}-episode`));
      try { await applyShowTemplate(project, source); }
      catch (error) {
        await Project.delete(root, project.slug);
        return new Response(error instanceof Error ? error.message : String(error), { status: 400 });
      }
      return Response.json(projectDetail(project.state));
    });
  }
  if (!body?.config?.topic) return new Response("config.topic is required", { status: 400 });
  const project = await Project.create(body.config, root, uniqueSlug(body.config.topic));
  if (await syncRosterAvatarUploads(project)) await project.save();
  return Response.json(projectDetail(project.state));
}
