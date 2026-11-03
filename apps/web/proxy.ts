import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { ensureEnvLoaded } from "@podframes/core";
import { NextResponse, type NextRequest } from "next/server";
import { automationAuthorization } from "./lib/api-auth";
import { findRepoRoot } from "./lib/root";
import { generationAdmission } from "./lib/usage-limits";

ensureEnvLoaded(findRepoRoot());

function loopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    (isIP(hostname) === 4 && hostname.startsWith("127."))
  );
}

/** Local mode is safe only when Next itself is bound to a loopback interface. */
function localRequest(request: NextRequest): boolean {
  const url = new URL(request.url);
  const host = request.headers.get("host")?.toLowerCase();
  if (!host || !loopback(url.hostname)) return false;
  let authority: URL;
  try {
    authority = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (authority.host !== host || !loopback(authority.hostname)) return false;
  const headers = request.headers;
  if (headers.has("forwarded") || headers.has("x-real-ip")) return false;
  const allowed = new Set([
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-forwarded-port",
  ]);
  for (const name of headers.keys()) {
    if (name.startsWith("x-forwarded-") && !allowed.has(name)) return false;
  }
  const forwardedFor = headers.get("x-forwarded-for");
  const forwardedHost = headers.get("x-forwarded-host");
  const forwardedProto = headers.get("x-forwarded-proto");
  const forwardedPort = headers.get("x-forwarded-port");
  if (!forwardedFor && !forwardedHost && !forwardedProto && !forwardedPort)
    return true;
  // Next adds this tuple even for direct requests. Never accept a proxy chain or remote peer.
  const peer =
    forwardedFor === "::ffff:127.0.0.1" ? "127.0.0.1" : (forwardedFor ?? "");
  return (
    loopback(peer) &&
    forwardedHost?.toLowerCase() === host &&
    forwardedProto === url.protocol.slice(0, -1) &&
    forwardedPort ===
      (authority.port || (url.protocol === "https:" ? "443" : "80"))
  );
}

function authorizedResponse(request: NextRequest): NextResponse {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const url = new URL(request.url);
    let sameOrigin = !origin;
    if (origin) {
      try {
        const source = new URL(origin);
        sameOrigin =
          source.origin === origin &&
          source.protocol === url.protocol &&
          source.host === (request.headers.get("host") ?? url.host);
      } catch {
        sameOrigin = false;
      }
    }
    if (request.headers.get("sec-fetch-site") === "cross-site" || !sameOrigin) {
      return new NextResponse("Cross-origin mutation denied", {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }
  }
  try {
    const denied = generationAdmission(findRepoRoot(), request);
    if (denied)
      return new NextResponse(denied.body, {
        status: denied.status,
        headers: denied.headers,
      });
  } catch {
    return new NextResponse(
      "Generation admission unavailable. No generation was started.",
      { status: 503 },
    );
  }
  return NextResponse.next();
}

export function proxy(request: NextRequest): NextResponse {
  const token = process.env.PODFRAMES_API_TOKEN;
  if (
    !token &&
    process.env.PODFRAMES_LOCAL_ONLY === "true" &&
    localRequest(request)
  )
    return authorizedResponse(request);
  if (!token || token.length < 32) {
    return new NextResponse(
      "Set PODFRAMES_API_TOKEN to a random token of at least 32 characters on the server.",
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  if (automationAuthorization(request, token) === null)
    return authorizedResponse(request);
  const basic = request.headers
    .get("authorization")
    ?.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/i)?.[1];
  if (basic) {
    const expected = createHash("sha256").update(`podframes:${token}`).digest();
    const supplied = createHash("sha256")
      .update(Buffer.from(basic, "base64"))
      .digest();
    if (timingSafeEqual(expected, supplied)) return authorizedResponse(request);
  }
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Podframes", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}
