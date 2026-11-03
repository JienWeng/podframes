import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Small, editable reference excerpts loaded fresh for each drafting/delivery pass. */
export async function loadScriptExamples(root: string, language = "en"): Promise<string> {
  const directory = join(root, "examples", "script-library");
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name).sort();
  const locale = language.toLowerCase().split(/[-_]/)[0];
  const local = files.filter((file) => file.startsWith(`${locale}-`));
  const selected = (local.length ? local : files.filter((file) => file.startsWith("en-"))).slice(0, 4);
  if (!selected.length) return "";
  const examples = await Promise.all(selected.map(async (file) => {
    const text = await readFile(join(directory, file), "utf8");
    if (text.length > 6000) throw new Error(`Writing example ${file} is too long; keep each excerpt under 6,000 characters.`);
    return `### ${file}\n${text}`;
  }));
  return [
    "SCRIPT LIBRARY: fictional demonstrations and attributed style-reference excerpts for rhythm, conversational interaction, and delivery only. These are not sources or evidence. Never copy their facts, wording, numbers, names, scenarios, or tags into the episode. Learn the interaction pattern and adapt it to the researched topic, hosts, and selected language. Unverified speaker attribution and transcript-only observations do not establish actual vocal emotion. Bad examples are explicitly marked as patterns to avoid.",
    ...examples,
  ].join("\n\n");
}
