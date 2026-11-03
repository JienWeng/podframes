import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const token = "a-random-owner-token-at-least-32-characters";

function environment(
  t: TestContext,
  configuredToken?: string,
  localOnly?: string,
) {
  const previous = {
    token: process.env.PODFRAMES_API_TOKEN,
    localOnly: process.env.PODFRAMES_LOCAL_ONLY,
  };
  t.after(() => {
    if (previous.token === undefined) delete process.env.PODFRAMES_API_TOKEN;
    else process.env.PODFRAMES_API_TOKEN = previous.token;
    if (previous.localOnly === undefined)
      delete process.env.PODFRAMES_LOCAL_ONLY;
    else process.env.PODFRAMES_LOCAL_ONLY = previous.localOnly;
  });
  if (configuredToken === undefined) delete process.env.PODFRAMES_API_TOKEN;
  else process.env.PODFRAMES_API_TOKEN = configuredToken;
  if (localOnly === undefined) delete process.env.PODFRAMES_LOCAL_ONLY;
  else process.env.PODFRAMES_LOCAL_ONLY = localOnly;
}

function request(
  path = "/studio",
  headers: Record<string, string> = {},
  origin = "http://localhost:3000",
  method = "GET",
) {
  return new NextRequest(`${origin}${path}`, {
    method,
    headers: { host: new URL(origin).host, ...headers },
  });
}

test("unconfigured app fails closed, including localhost", (t) => {
  environment(t);
  assert.equal(proxy(request()).status, 503);
  assert.equal(
    proxy(request("/", {}, "https://podframes.example.com")).status,
    503,
  );
});

test("configured token protects pages, APIs and static media", (t) => {
  environment(t, token);
  for (const path of [
    "/",
    "/studio",
    "/api/projects",
    "/api/media/private/file.mp4",
    "/_next/static/app.js",
  ]) {
    const response = proxy(request(path));
    assert.equal(response.status, 401);
    assert.equal(
      response.headers.get("WWW-Authenticate"),
      'Basic realm="Podframes", charset="UTF-8"',
    );
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(
      proxy(request(path, { authorization: `Bearer ${token}` })).headers.get(
        "x-middleware-next",
      ),
      "1",
    );
  }
});

test("owner Basic login requires exact username and token", (t) => {
  environment(t, token);
  const basic = (value: string) =>
    `Basic ${Buffer.from(value).toString("base64")}`;
  assert.equal(
    proxy(
      request("/studio", { authorization: basic(`podframes:${token}`) }),
    ).headers.get("x-middleware-next"),
    "1",
  );
  for (const authorization of [
    basic(`other:${token}`),
    basic(`podframes:${token}wrong`),
    basic("podframes:"),
    "Basic invalid%",
    `Bearer ${token}wrong`,
  ]) {
    assert.equal(proxy(request("/studio", { authorization })).status, 401);
  }
});

test("short token fails closed even with local mode enabled", (t) => {
  environment(t, "short", "true");
  assert.equal(proxy(request()).status, 503);
});

test("local-only opt-in accepts loopback hosts and Next's loopback forwarded tuple", (t) => {
  environment(t, undefined, "true");
  for (const origin of [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ]) {
    assert.equal(
      proxy(request("/studio", {}, origin)).headers.get("x-middleware-next"),
      "1",
    );
  }
  for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    const headers = {
      "x-forwarded-for": peer,
      "x-forwarded-host": "localhost:3000",
      "x-forwarded-port": "3000",
      "x-forwarded-proto": "http",
    };
    assert.equal(
      proxy(request("/studio", headers)).headers.get("x-middleware-next"),
      "1",
    );
  }
});

test("local-only opt-in rejects remote hosts, forwarding chains and inconsistent authority", (t) => {
  environment(t, undefined, "true");
  const rejectedHeaders: Record<string, string>[] = [
    { host: "podframes.example.com" },
    { host: "localhost:3000@podframes.example.com" },
    { host: "localhost:3000/path" },
    { forwarded: "for=127.0.0.1" },
    { "x-real-ip": "127.0.0.1" },
    {
      "x-forwarded-for": "127.0.0.1, 203.0.113.2",
      "x-forwarded-host": "localhost:3000",
      "x-forwarded-port": "3000",
      "x-forwarded-proto": "http",
    },
    {
      "x-forwarded-for": "203.0.113.2",
      "x-forwarded-host": "localhost:3000",
      "x-forwarded-port": "3000",
      "x-forwarded-proto": "http",
    },
    {
      "x-forwarded-for": "127.0.0.1",
      "x-forwarded-host": "podframes.example.com",
      "x-forwarded-port": "3000",
      "x-forwarded-proto": "http",
    },
    {
      "x-forwarded-for": "127.0.0.1",
      "x-forwarded-host": "localhost:3000",
      "x-forwarded-port": "443",
      "x-forwarded-proto": "http",
    },
    { "x-forwarded-prefix": "/" },
  ];
  for (const headers of rejectedHeaders)
    assert.equal(proxy(request("/studio", headers)).status, 503);
  assert.equal(
    proxy(
      request(
        "/studio",
        { host: "localhost:3000" },
        "http://podframes.example.com:3000",
      ),
    ).status,
    503,
  );
});

test("local-only opt-in cannot bypass configured owner authentication", (t) => {
  environment(t, token, "true");
  assert.equal(proxy(request()).status, 401);
});

test("authenticated browser and bearer mutations reject cross-site and mismatched origins", (t) => {
  environment(t, token);
  for (const authorization of [
    `Bearer ${token}`,
    `Basic ${Buffer.from(`podframes:${token}`).toString("base64")}`,
  ]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(
        proxy(
          request(
            "/api/projects",
            {
              authorization,
              origin: "http://localhost:3000",
              "sec-fetch-site": "same-origin",
            },
            undefined,
            method,
          ),
        ).headers.get("x-middleware-next"),
        "1",
      );
      assert.equal(
        proxy(
          request("/api/projects", { authorization }, undefined, method),
        ).headers.get("x-middleware-next"),
        "1",
      );
      const rejectedOrigins: Record<string, string>[] = [
        { authorization, origin: "https://attacker.example.com" },
        { authorization, origin: "https://localhost:3000" },
        { authorization, origin: "null" },
        {
          authorization,
          origin: "http://localhost:3000",
          "sec-fetch-site": "cross-site",
        },
      ];
      for (const headers of rejectedOrigins)
        assert.equal(
          proxy(request("/api/projects", headers, undefined, method)).status,
          403,
        );
    }
  }
});

test("local-only mutations also require same-origin browser requests", (t) => {
  environment(t, undefined, "true");
  assert.equal(
    proxy(
      request(
        "/api/projects",
        { origin: "https://attacker.example.com" },
        undefined,
        "POST",
      ),
    ).status,
    403,
  );
  assert.equal(
    proxy(
      request(
        "/api/projects",
        { "sec-fetch-site": "cross-site" },
        undefined,
        "DELETE",
      ),
    ).status,
    403,
  );
  assert.equal(
    proxy(
      request(
        "/api/projects",
        { origin: "http://localhost:3000" },
        undefined,
        "POST",
      ),
    ).headers.get("x-middleware-next"),
    "1",
  );
});
