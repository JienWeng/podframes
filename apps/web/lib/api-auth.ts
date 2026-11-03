import { createHash, timingSafeEqual } from "node:crypto";

export function automationAuthorization(
  request: Request,
  token: string | undefined,
): Response | null {
  if (!token || token.length < 32)
    return new Response(
      "Set PODFRAMES_API_TOKEN to a random token of at least 32 characters on the server.",
      { status: 503 },
    );
  const supplied =
    request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1] ?? "";
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(hash(token), hash(supplied)))
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  return null;
}
