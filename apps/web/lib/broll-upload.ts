/** Raster uploads only: never serve user-provided SVG/HTML as an image asset. */
export function brollUploadExtension(bytes: Uint8Array): "png" | "jpg" | "webp" {
  if (bytes.length < 12 || bytes.length > 10 * 1024 * 1024) throw new Error("Choose a PNG, JPEG, or WebP photo up to 10 MB.");
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  const text = new TextDecoder("ascii");
  if (text.decode(bytes.slice(0, 4)) === "RIFF" && text.decode(bytes.slice(8, 12)) === "WEBP") return "webp";
  throw new Error("Choose a PNG, JPEG, or WebP photo.");
}
