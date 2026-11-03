import { getRun, cancelRun } from "@/lib/runs";
import { safeSlug } from "@/lib/root";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Poll persisted events, so streams reconnect across web-server restarts. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const safe = safeSlug((await params).slug);
  const initialRun = getRun(safe);
  if (!initialRun)
    return new Response("No run for this project", { status: 404 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastSeq = -1;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        req.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          /* Disconnected client. */
        }
      };
      const poll = () => {
        if (closed) return;
        try {
          const run = getRun(safe, initialRun.id);
          if (!run) return close();
          for (const event of run.events) {
            if (event.seq <= lastSeq) continue;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
            lastSeq = event.seq;
          }
          if (run.status !== "running") close();
        } catch {
          close();
        }
      };
      const timer = setInterval(poll, 1000);
      req.signal.addEventListener("abort", close);
      if (req.signal.aborted) close();
      else poll();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!cancelRun(safeSlug((await params).slug)))
    return new Response("No active run", { status: 404 });
  return Response.json({ ok: true, cancelling: true }, { status: 202 });
}
