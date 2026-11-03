import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/api/writing-models/route";

test("model catalog verifies credentials without generation or exposing provider errors", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-private-key";
  try {
    globalThis.fetch = async (input, options) => {
      assert.equal(String(input), "https://api.openai.com/v1/models");
      assert.equal(
        (options?.headers as Record<string, string>).Authorization,
        "Bearer test-only-private-key",
      );
      return Response.json({
        data: [{ id: "gpt-example" }, { id: "invalid/id" }],
      });
    };
    const response = await GET(
      new Request("http://localhost/api/writing-models?provider=openai"),
    );
    assert.deepEqual((await response.json()).models, ["gpt-example"]);
    globalThis.fetch = async () =>
      new Response("private provider error", { status: 401 });
    const denied = await GET(
      new Request("http://localhost/api/writing-models?provider=openai"),
    );
    assert.equal(denied.status, 502);
    assert.doesNotMatch(
      await denied.text(),
      /private provider error|test-only-private-key/,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
