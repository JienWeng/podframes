"use client";

import { useEffect, useState } from "react";
import type { SavedCast } from "@/lib/library";
import { useWizard } from "./context";
import { castFromHosts, castToHosts, type CastChannel } from "./cast";
import { inputClass } from "./ui";

export function CastLibraryControls({
  channel,
  disabled,
}: {
  channel: CastChannel;
  disabled: boolean;
}) {
  const ctx = useWizard();
  const [entries, setEntries] = useState<SavedCast[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const reload = () => {
      void fetch("/api/library", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Could not load the cast library.");
          const library = await response.json();
          if (active) setEntries(library.cast);
        })
        .catch(() => {
          if (active)
            setMessage("Cast library could not load. Reload to try again.");
        });
    };
    reload();
    window.addEventListener("podframes-cast-library-updated", reload);
    return () => {
      active = false;
      window.removeEventListener("podframes-cast-library-updated", reload);
    };
  }, []);

  async function apply() {
    const generated = [
      "speech",
      "stills",
      "video",
      "broll",
      "compose",
      "render",
    ].filter((stage) => ctx.project?.stages[stage] === "done");
    if (
      generated.length &&
      !(await ctx.confirm({
        title: "Use this cast member?",
        body: "This replaces the host's portrait, voice, speech model, personality, and delivery settings.",
        details: [
          "Generated audio, clips, and supporting visuals will need regeneration. New generation uses your provider credits.",
        ],
        confirmLabel: "Use cast member",
        tone: "warn",
      }))
    )
      return;
    await change(false);
  }

  async function change(save: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const slug = await ctx.ensureProject();
      if (!slug) throw new Error("Could not create the video.");
      if (!(await ctx.patch({ hosts: castToHosts(ctx.cast) })))
        throw new Error("Could not save the current cast settings.");
      const response = await fetch(
        save
          ? "/api/library"
          : `/api/projects/${encodeURIComponent(slug)}/cast`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            save
              ? { kind: "cast", slug, hostId: channel.id }
              : { hostId: channel.id, castId: selected },
          ),
        },
      );
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      if (save) {
        setEntries((entries) => [result, ...entries]);
        setMessage(`${channel.name} saved to your Cast library.`);
        window.dispatchEvent(new Event("podframes-cast-library-updated"));
      } else {
        ctx.setCast(() => castFromHosts(result.hosts));
        await ctx.refresh();
        setMessage("Cast member applied.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Cast action failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t border-[var(--color-hairline)] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold">Cast library</span>
        <button
          onClick={() => void change(true)}
          disabled={disabled || busy}
          className="btn btn-ghost px-3 py-1 text-xs disabled:opacity-50"
        >
          {busy ? "Working…" : "Save this cast member"}
        </button>
      </div>
      {!!entries.length && (
        <div className="flex flex-wrap gap-2">
          <select
            aria-label={`Saved cast for ${channel.name}`}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            disabled={disabled || busy}
            className={`${inputClass} flex-1`}
          >
            <option value="">Choose a saved cast member</option>
            {entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} ·{" "}
                {entry.host.model === "fish/drama-3" ? "Drama 3" : "S2.1 Pro"}
              </option>
            ))}
          </select>
          <button
            onClick={() => void apply()}
            disabled={disabled || busy || !selected}
            className="btn btn-ghost px-4 py-2 text-sm disabled:opacity-50"
          >
            Use cast
          </button>
        </div>
      )}
      {message && (
        <p
          role="status"
          className="text-xs leading-relaxed text-[var(--color-text-secondary)]"
        >
          {message}
        </p>
      )}
    </div>
  );
}
