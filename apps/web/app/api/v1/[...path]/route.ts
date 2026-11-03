import { ensureEnvLoaded } from "@podframes/core";
import { automationAuthorization } from "@/lib/api-auth";
import { findRepoRoot } from "@/lib/root";
import { idempotentRequest } from "@/lib/idempotency";
import * as projects from "@/app/api/projects/route";
import * as project from "@/app/api/projects/[slug]/route";
import * as runs from "@/app/api/projects/[slug]/run/route";
import * as generate from "@/app/api/generate/route";
import * as library from "@/app/api/library/route";
import * as portrait from "@/app/api/library/cast/[id]/portrait/route";
import * as health from "@/app/api/health/route";
import * as media from "@/app/api/media/[...path]/route";
import * as cast from "@/app/api/projects/[slug]/cast/route";
import * as delivery from "@/app/api/projects/[slug]/script/delivery/route";
import * as voicePreview from "@/app/api/voice-preview/route";
import * as writingModels from "@/app/api/writing-models/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Explicit route list keeps internal endpoints outside the external API contract.
const routes: Array<{
  pattern: RegExp;
  module: Record<string, unknown>;
  media?: boolean;
}> = [
  { pattern: /^projects$/, module: projects },
  { pattern: /^projects\/(?<slug>[a-z0-9][a-z0-9-]*)$/i, module: project },
  { pattern: /^projects\/(?<slug>[a-z0-9][a-z0-9-]*)\/run$/i, module: runs },
  { pattern: /^projects\/(?<slug>[a-z0-9][a-z0-9-]*)\/cast$/i, module: cast },
  {
    pattern: /^projects\/(?<slug>[a-z0-9][a-z0-9-]*)\/script\/delivery$/i,
    module: delivery,
  },
  { pattern: /^generate$/, module: generate },
  { pattern: /^library$/, module: library },
  {
    pattern: /^library\/cast\/(?<id>[a-f0-9-]{36})\/portrait$/,
    module: portrait,
  },
  { pattern: /^health$/, module: health },
  { pattern: /^voice-preview$/, module: voicePreview },
  { pattern: /^writing-models$/, module: writingModels },
  { pattern: /^media\/.+$/, module: media, media: true },
];

type Handler = (
  request: Request,
  context: { params: Promise<Record<string, string | string[]>> },
) => Promise<Response>;
async function dispatch(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  ensureEnvLoaded(findRepoRoot());
  const denied = automationAuthorization(
    request,
    process.env.PODFRAMES_API_TOKEN,
  );
  if (denied) return denied;
  const path = (await context.params).path;
  for (const route of routes) {
    const match = route.pattern.exec(path.join("/"));
    if (!match) continue;
    const handler = route.module[request.method];
    if (typeof handler !== "function")
      return new Response("Method not allowed", { status: 405 });
    const params = route.media ? { path: path.slice(1) } : (match.groups ?? {});
    try {
      return await idempotentRequest(findRepoRoot(), request, () =>
        (handler as Handler)(request, {
          params: Promise.resolve(params),
        }),
      );
    } catch {
      return new Response(
        "API operation failed. Check server logs and the project's saved stage state before retrying generation.",
        { status: 500 },
      );
    }
  }
  return new Response("API endpoint not found", { status: 404 });
}
export {
  dispatch as GET,
  dispatch as POST,
  dispatch as PATCH,
  dispatch as DELETE,
};
