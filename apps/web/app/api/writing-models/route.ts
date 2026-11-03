import {
  assertWritingReady,
  ensureEnvLoaded,
  writingModel,
} from "@podframes/core";
import { findRepoRoot } from "@/lib/root";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Checks credentials and the live catalog without generating billable content. */
export async function GET(request: Request) {
  ensureEnvLoaded(findRepoRoot());
  const params = new URL(request.url).searchParams;
  const provider = params.get("provider");
  if (
    !provider ||
    !["openai", "anthropic", "codex", "claude-code"].includes(provider)
  )
    return new Response("Invalid writing provider", { status: 400 });
  if (provider === "codex" || provider === "claude-code") {
    try {
      await assertWritingReady(
        provider === "codex" ? "codex-local" : "claude-code/sonnet",
      );
      return Response.json({
        models:
          provider === "claude-code"
            ? ["sonnet", "opus", "haiku"]
            : ["codex-local"],
        message:
          "Subscription login verified. Model availability and generation allowance are checked when drafting.",
      });
    } catch (error) {
      return Response.json(
        {
          models: [],
          message:
            error instanceof Error ? error.message : "Login check failed",
        },
        { status: 503 },
      );
    }
  }
  const key =
    provider === "openai"
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY;
  if (!key)
    return Response.json(
      {
        models: [],
        message: `Set ${provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} in the server environment.`,
      },
      { status: 503 },
    );
  try {
    const response = await fetch(
      provider === "openai"
        ? "https://api.openai.com/v1/models"
        : "https://api.anthropic.com/v1/models?limit=1000",
      {
        headers:
          provider === "openai"
            ? { Authorization: `Bearer ${key}` }
            : { "x-api-key": key, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!response.ok)
      return Response.json(
        {
          models: [],
          message: `Provider credential/catalog check failed (HTTP ${response.status}).`,
        },
        { status: 502 },
      );
    const body = await response.json();
    const models: string[] = Array.isArray(body.data)
      ? body.data
          .flatMap((item: { id?: unknown }) => {
            if (typeof item?.id !== "string") return [];
            try {
              writingModel(`${provider}/${item.id}`);
              return [item.id];
            } catch {
              return [];
            }
          })
          .sort()
      : [];
    return Response.json({
      models,
      message:
        "API credentials verified against the live model catalog. Choose a writing model with structured output and web tools. Generation allowance and tool support are checked when drafting.",
    });
  } catch {
    return Response.json(
      {
        models: [],
        message:
          "Provider catalog unavailable. Check network access and try again.",
      },
      { status: 502 },
    );
  }
}
