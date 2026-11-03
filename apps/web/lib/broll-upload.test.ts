import test from "node:test";
import assert from "node:assert/strict";
import { brollUploadExtension } from "./broll-upload";

test("B-roll uploads accept raster signatures and reject active content or oversized files", () => {
  assert.equal(brollUploadExtension(new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])), "png");
  assert.equal(brollUploadExtension(new Uint8Array([255,216,255,0,0,0,0,0,0,0,0,0])), "jpg");
  assert.equal(brollUploadExtension(new TextEncoder().encode("RIFF0000WEBP")), "webp");
  assert.throws(() => brollUploadExtension(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')));
  assert.throws(() => brollUploadExtension(new Uint8Array()));
  assert.throws(() => brollUploadExtension(new Uint8Array(10 * 1024 * 1024 + 1)));
});
