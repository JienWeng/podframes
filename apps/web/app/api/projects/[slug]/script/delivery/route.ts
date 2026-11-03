import { Project, WritingClient, ensureEnvLoaded, directScriptDelivery, loadScriptExamples, withProjectLock } from "@podframes/core";
import { findRepoRoot, safeSlug } from "@/lib/root";
import { isRunActiveAnywhere } from "@/lib/runs";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Return a wording-preserving proposal; saving/re-voicing stays in the script editor. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = safeSlug((await params).slug);
  return withProjectLock(slug, async () => {
    if (isRunActiveAnywhere(slug)) return new Response("Wait for the current generation to finish.", { status: 409 });
    const project = await Project.load(findRepoRoot(), slug);
    if (!project?.state.script) return new Response("Write or import a script first.", { status: 400 });
    try {
      ensureEnvLoaded(findRepoRoot());
      const examples = await loadScriptExamples(project.root, project.state.config.language ?? "en");
      const script = await directScriptDelivery(new WritingClient({ signal: req.signal }), project.state.script, project.state.config.hosts, project.state.options.scriptModel, examples);
      return Response.json({ script });
    } catch (error) { return new Response(error instanceof Error ? error.message : String(error), { status: 502 }); }
  });
}
