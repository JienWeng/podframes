import type { Host, Script } from "./types";

const MAX_TEXT = 50_000;

export function validateManualScript(value: unknown, hosts: Pick<Host, "id">[]): asserts value is Script {
  if (!value || typeof value !== "object") throw new Error("Script must be an object.");
  const script = value as Script;
  if (![script.title, script.topic, script.hook].every((text) => typeof text === "string")) throw new Error("Script title, topic, and hook must be text.");
  if (!Array.isArray(script.turns) || script.turns.length < 2 || script.turns.length > 200) throw new Error("Use 2–200 dialogue turns.");
  if (!script.turns.every((turn) => turn && hosts.some((host) => host.id === turn.hostId) && typeof turn.text === "string" && turn.text.trim())) throw new Error("Every turn needs a known speaker and non-empty dialogue.");
  if (script.turns.reduce((length, turn) => length + turn.text.length, 0) + script.title.length + script.topic.length + script.hook.length > MAX_TEXT) throw new Error("Script must be under 50,000 characters.");
}

/** A small text format, not a Markdown renderer: no prose is sent to a model. */
export function parsePastedScript(input: string, hosts: Pick<Host, "id" | "name" | "speaker">[], topic = "Imported script"): Script {
  if (input.length > MAX_TEXT) throw new Error("Script must be under 50,000 characters.");
  if (hosts.length !== 2) throw new Error("Choose two cast members first.");
  const speakers = new Map<string, typeof hosts[number] | null>();
  for (const host of hosts) {
    const name = host.name.trim().toLocaleLowerCase();
    speakers.set(name, speakers.has(name) ? null : host);
  }
  hosts.forEach((host, index) => {
    speakers.set(index === 0 ? "host_a" : "host_b", host);
    speakers.set(index === 0 ? "a" : "b", host);
  });
  const script: Script = { topic, title: topic, hook: "", turns: [] };
  const lines = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line || /^```(?:txt|text|md|markdown)?$/i.test(line)) continue;
    if (!script.turns.length && /^#\s+/.test(line)) {
      script.title = line.replace(/^#\s+/, "").trim();
      script.topic = script.title;
      continue;
    }
    const labelled = line.replace(/^[-*]\s+/, "").replace(/\*\*/g, "").match(/^([^:：]{1,80})[:：]\s*(.*)$/);
    if (labelled) {
      const host = speakers.get(labelled[1]!.trim().toLocaleLowerCase());
      if (!host) throw new Error(`Line ${index + 1}: unknown or ambiguous speaker “${labelled[1]!.trim()}”. Use HOST_A or HOST_B.`);
      script.turns.push({ index: script.turns.length, hostId: host.id, speaker: host.speaker, text: labelled[2]! });
    } else {
      const turn = script.turns.at(-1);
      if (!turn) throw new Error(`Line ${index + 1}: start dialogue with a speaker name and a colon.`);
      turn.text += `${turn.text ? "\n" : ""}${line}`;
    }
  }
  validateManualScript(script, hosts);
  return script;
}
