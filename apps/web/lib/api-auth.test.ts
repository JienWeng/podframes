import assert from "node:assert/strict";
import { test } from "node:test";
import { automationAuthorization } from "./api-auth";

test("automation API fails closed and requires an exact bearer token", () => {
  const token = "a-long-random-token-32-characters-minimum";
  const request = (authorization?: string) =>
    new Request("http://localhost/api/v1/projects", {
      headers: authorization ? { authorization } : {},
    });
  assert.equal(automationAuthorization(request(), undefined)?.status, 503);
  assert.equal(automationAuthorization(request(), "short")?.status, 503);
  assert.equal(automationAuthorization(request(), token)?.status, 401);
  assert.equal(
    automationAuthorization(request(`Bearer ${token}wrong`), token)?.status,
    401,
  );
  assert.equal(
    automationAuthorization(request(`Bearer ${token}`), token),
    null,
  );
});

test("versioned API authenticates before dispatch and preserves project/media behavior", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { DEFAULT_HOSTS } = await import("@podframes/core");
  const root = await mkdtemp(join(tmpdir(), "podframes-api-"));
  const cwd = process.cwd();
  const prior = process.env.PODFRAMES_API_TOKEN;
  t.after(async () => {
    process.chdir(cwd);
    if (prior === undefined) delete process.env.PODFRAMES_API_TOKEN; else process.env.PODFRAMES_API_TOKEN = prior;
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []");
  process.chdir(root);
  process.env.PODFRAMES_API_TOKEN = "test-automation-token-at-least-32-characters";
  const { GET, POST } = await import("../app/api/v1/[...path]/route");
  const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
  const unauthorized = await POST(new Request("http://localhost/api/v1/projects", { method: "POST", body: "{}" }), context(["projects"]));
  assert.equal(unauthorized.status, 401);
  const headers = { Authorization: `Bearer ${process.env.PODFRAMES_API_TOKEN}`, "Content-Type": "application/json", "Idempotency-Key": "test-create-project-0001" };
  const response = await POST(new Request("http://localhost/api/v1/projects", { method: "POST", headers, body: JSON.stringify({ config: { topic: "API test", hosts: DEFAULT_HOSTS } }) }), context(["projects"]));
  assert.equal(response.status, 200);
  const project = await response.json();
  const listed = await GET(new Request("http://localhost/api/v1/projects", { headers }), context(["projects"]));
  assert.equal((await listed.json()).projects[0].slug, project.slug);
  await writeFile(join(root, "projects", project.slug, "sample.mp4"), new Uint8Array([1, 2, 3, 4]));
  const media = await GET(new Request("http://localhost/api/v1/media", { headers: { ...headers, Range: "bytes=1-2" } }), context(["media", project.slug, "sample.mp4"]));
  assert.equal(media.status, 206);
  assert.deepEqual([...new Uint8Array(await media.arrayBuffer())], [2, 3]);
  assert.equal((await GET(new Request("http://localhost/api/v1/unknown", { headers }), context(["unknown"]))).status, 404);
});
