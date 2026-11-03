import { createHash } from "node:crypto";
import { durableUpdate } from "@podframes/core";

interface Receipt {
  fingerprint: string;
  status?: number;
  body?: string;
  contentType?: string;
}
type Receipts = Record<string, Receipt>;
/** A pending receipt deliberately blocks retries after an uncertain outcome. */
export async function idempotentRequest(
  root: string,
  request: Request,
  action: () => Promise<Response>,
): Promise<Response> {
  if (request.method !== "POST") return action();
  const key = request.headers.get("Idempotency-Key");
  if (!key || !/^[\w.-]{16,128}$/.test(key))
    return new Response(
      "Supply an Idempotency-Key of 16–128 letters, digits, dots, underscores or hyphens for POST requests.",
      { status: 400 },
    );
  const fingerprint = createHash("sha256")
    .update(`${request.method}\n${new URL(request.url).pathname}\n`)
    .update(new Uint8Array(await request.clone().arrayBuffer()))
    .digest("hex");
  const hashedKey = createHash("sha256").update(key).digest("hex");
  const previous = durableUpdate(
    root,
    "requests",
    (): Receipts => ({}),
    (receipts) => {
      if (receipts[hashedKey]) return receipts[hashedKey];
      receipts[hashedKey] = { fingerprint };
      return null;
    },
  );
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      return new Response(
        "This Idempotency-Key was already used with different request content.",
        { status: 409 },
      );
    if (previous.status === undefined)
      return new Response(
        "This request is pending or its outcome is uncertain. Inspect project/provider state before using a new request key.",
        { status: 409 },
      );
    return new Response(
      new Uint8Array(Buffer.from(previous.body ?? "", "base64")),
      {
        status: previous.status,
        headers: {
          "Content-Type": previous.contentType ?? "text/plain",
          "Idempotency-Replayed": "true",
          "Cache-Control": "no-store",
        },
      },
    );
  }
  const response = await action();
  const body = Buffer.from(await response.clone().arrayBuffer()).toString(
    "base64",
  );
  durableUpdate(
    root,
    "requests",
    (): Receipts => ({}),
    (receipts) => {
      receipts[hashedKey] = {
        fingerprint,
        status: response.status,
        body,
        contentType: response.headers.get("Content-Type") ?? undefined,
      };
    },
  );
  return response;
}
