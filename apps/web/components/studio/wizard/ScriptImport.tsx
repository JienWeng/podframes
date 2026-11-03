"use client";

import { useMemo, useRef, useState } from "react";
import { parsePastedScript } from "@podframes/core/script-import";
import type { Script } from "@podframes/core/shared";
import { useWizard } from "./context";
import { castToHosts } from "./cast";
import { inputClass } from "./ui";

export function ScriptImport({ disabled, onOpenChange, onImported }: {
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (script: Script) => void;
}) {
  const ctx = useWizard();
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState("");
  const [saving, setSaving] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  const hosts = ctx.project?.config.hosts ?? castToHosts(ctx.cast);
  const parsed = useMemo(() => {
    if (!text.trim()) return { script: null, error: "" };
    try { return { script: parsePastedScript(text, hosts, ctx.topic.trim() || "Imported script"), error: "" }; }
    catch (error) { return { script: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [text, hosts, ctx.topic]);

  async function save(generateVideo = false) {
    if (!parsed.script) return;
    setSaving(true);
    try {
      if (!(await ctx.patch({ script: parsed.script, config: { topic: parsed.script.topic, language: ctx.language, aspectRatio: ctx.aspect } }))) return;
      ctx.setTopic(parsed.script.topic);
      onImported(parsed.script);
      if (details.current) details.current.open = false;
      if (generateVideo) await ctx.generate({ to: "render" });
    } finally { setSaving(false); }
  }

  return (
    <details ref={details} onToggle={(event) => onOpenChange(event.currentTarget.open)} className="mb-4 border border-[var(--color-hairline)] p-3">
      <summary className="cursor-pointer text-sm font-medium">Paste or import a script</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-[var(--color-text-muted)]">Plain text is simplest. Markdown works too: optional # title, then one speaker per turn. Use {hosts.map((host) => host.name).join(" / ")} or HOST_A / HOST_B. Keep [emotion] tags in the dialogue.</p>
        <label className="block text-xs text-[var(--color-text-secondary)]">
          Load .txt or .md
          <input type="file" accept=".txt,.md,text/plain,text/markdown" disabled={disabled || saving} className="mt-1 block w-full text-xs" onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            setFileError("");
            try {
              if (!/\.(txt|md)$/i.test(file.name) || file.size > 200_000) throw new Error("Choose a .txt or .md file up to 200 KB (50,000 text characters).");
              setText(await file.text());
            } catch (error) { setFileError(error instanceof Error ? error.message : String(error)); }
          }} />
        </label>
        <textarea aria-label="Script to import" value={text} onChange={(event) => { setText(event.target.value); setFileError(""); }} disabled={disabled || saving} rows={8} maxLength={50_000} placeholder={"# Episode title\nHOST_A: [curious] What happened?\nHOST_B: Let’s walk through it."} className={`${inputClass} font-mono text-xs`} />
        {(fileError || parsed.error) && <p role="alert" className="text-xs text-[var(--color-danger)]">{fileError || parsed.error}</p>}
        {parsed.script && (
          <div className="max-h-56 overflow-auto border border-[var(--color-hairline)] p-2 text-xs">
            <p className="mb-2 font-medium">{parsed.script.title} · {parsed.script.turns.length} turns</p>
            {parsed.script.turns.map((turn) => <p key={turn.index} className="mb-2 whitespace-pre-wrap"><strong>{hosts.find((host) => host.id === turn.hostId)?.name}:</strong> {turn.text}</p>)}
          </div>
        )}
        <p className="text-xs text-[var(--color-text-muted)]">Your wording is preserved. Replacing a script clears affected audio and video. Imported claims are not automatically fact-checked. Choose “Save script only” to review before generating.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => save(true)} disabled={disabled || saving || !parsed.script || !!fileError} className="btn btn-primary px-4 py-2 text-sm disabled:opacity-50">{saving ? "Running…" : "Import & generate full video"}</button>
          <button onClick={() => save()} disabled={disabled || saving || !parsed.script || !!fileError} className="btn btn-ghost px-4 py-2 text-sm disabled:opacity-50">{ctx.project?.script ? "Replace script only" : "Save script only"}</button>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">Full video runs voices → avatars → lip-sync → B-roll → captions → MP4 with your current cast and provider. Uses the selected services’ credits; failed runs can resume.</p>
      </div>
    </details>
  );
}
