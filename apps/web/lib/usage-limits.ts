import { createHash } from "node:crypto";
import { durableUpdate } from "@podframes/core";

export function generationAdmission(
  root: string,
  request: Request,
): Response | null {
  const path = new URL(request.url).pathname.replace(/^\/api\/v1\//, "/api/");
  if (
    request.method !== "POST" ||
    !(
      /^\/api\/(generate|voice-preview)$/.test(path) ||
      /^\/api\/projects\/[^/]+\/(cast|script\/delivery|video\/regenerate|broll\/[^/]+\/regenerate)$/.test(
        path,
      )
    )
  )
    return null;
  const limit = Number(process.env.PODFRAMES_DAILY_GENERATION_LIMIT ?? 30);
  if (!Number.isSafeInteger(limit) || limit < 1)
    return new Response(
      "Configure PODFRAMES_DAILY_GENERATION_LIMIT as a positive integer.",
      { status: 503 },
    );
  const date = new Date().toISOString().slice(0, 10);
  const key = new URL(request.url).pathname.startsWith("/api/v1/")
    ? request.headers.get("Idempotency-Key")
    : null;
  const fingerprint = key
    ? createHash("sha256").update(`${path}\n${key}`).digest("hex")
    : undefined;
  const allowed = durableUpdate(
    root,
    "usage",
    () => ({ date, count: 0, keys: [] as string[] }),
    (usage) => {
      if (usage.date !== date) {
        usage.date = date;
        usage.count = 0;
        usage.keys = [];
      }
      if (fingerprint && usage.keys.includes(fingerprint)) return true;
      if (usage.count >= limit) return false;
      usage.count++;
      if (fingerprint) usage.keys.push(fingerprint);
      return true;
    },
  );
  return allowed
    ? null
    : new Response(
        "Daily generation-operation limit reached. Raise PODFRAMES_DAILY_GENERATION_LIMIT explicitly or wait for the next UTC day.",
        { status: 429 },
      );
}
