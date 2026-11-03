"use client";

import { useEffect, useRef, useState } from "react";
import { providerColor, providerOfModel } from "@/lib/providers";
import { languageLabel, isPublicSourceUrl, EMOTION_TAGS, withEmotionCue, VIDEO_PROVIDERS, type VideoProviderId } from "@podframes/core/shared";
import { useDraft } from "@/components/studio/useDraft";
import type { ScriptTurn } from "@/components/studio/api";
import { directDelivery } from "@/components/studio/api";
import { useWizard } from "./context";
import { StepHeader, StepFooter, inputClass } from "./ui";
import { WriterSettings } from "./WriterSettings";
import { hostFace } from "./cast";
import { ScriptImport } from "./ScriptImport";

const DEFAULT_STYLE = "natural, conversational, and lightly playful";

export function Step2Script() {
  const ctx = useWizard();
  const { project, topic, setTopic, style, setStyle, language, aspect, locked, running, busy } = ctx;
  const script = project?.script ?? null;
  const turns = script?.turns ?? [];
  const hasSpeech = project?.stages.speech === "done";
  const [importOpen, setImportOpen] = useState(false);
  const [directing, setDirecting] = useState(false);
  const [deliveryNotice, setDeliveryNotice] = useState("");

  // Editable copy of the turns, re-seeded ONLY when the script is (re)generated — scriptVersion
  // bumps on a rewrite but not on an edit-save, so autosave never clobbers what you're typing.
  const [draft, setDraft] = useDraft<ScriptTurn[]>(turns, project?.scriptVersion ?? "none");
  // Compare trimmed (the server trims) so trailing whitespace doesn't loop the autosave.
  const edited = JSON.stringify(draft.map((t) => t.text.trim())) !== JSON.stringify(turns.map((t) => t.text));
  // Non-empty, actually-changed, and not mid-run (a background save during a generate would 409).
  const canSave = edited && !!script && !locked && !importOpen && !directing && draft.every((t) => t.text.trim());
  const disabled = locked || busy || directing;
  const sourceUrls = ctx.sourceLinks.split(/\s+/).filter(Boolean);
  const settingsValid = Number.isFinite(ctx.targetDurationSec) && ctx.targetDurationSec >= 15 && ctx.targetDurationSec <= 600 && sourceUrls.length <= 5 && sourceUrls.every(isPublicSourceUrl);
  const configPatch = {
    topic: topic.trim(), styleNote: style.trim() || DEFAULT_STYLE, aspectRatio: aspect, language,
    targetDurationSec: ctx.targetDurationSec, autoEmotionTags: ctx.autoEmotionTags, sourceUrls, maxWordsPerTurn: 28,
  };

  // Debounced SILENT autosave: persist edits ~700ms after you stop typing. Silent = never flips the
  // global busy flag, so the textarea you're typing in is never disabled/blurred mid-edit.
  useEffect(() => {
    if (!canSave || !script) return;
    const id = setTimeout(() => { void ctx.patch({ script: { ...script, turns: draft } }, { silent: true }); }, 700);
    return () => clearTimeout(id);
  }, [draft, canSave, script, ctx]);

  // Flush any pending edit when leaving the step, so navigating away never drops it.
  const flush = useRef<() => void>(() => {});
  useEffect(() => {
    flush.current = () => { if (canSave && script) void ctx.patch({ script: { ...script, turns: draft } }, { silent: true }); };
  });
  useEffect(() => () => flush.current(), []);

  const configChanged =
    !!project &&
    (topic.trim() !== project.config.topic ||
      (style.trim() || DEFAULT_STYLE) !== (project.config.styleNote?.trim() || DEFAULT_STYLE) ||
      language !== (project.config.language ?? "en") ||
      ctx.targetDurationSec !== project.config.targetDurationSec ||
      ctx.autoEmotionTags !== project.config.autoEmotionTags ||
      JSON.stringify(sourceUrls) !== JSON.stringify(project.config.sourceUrls ?? []) ||
      project.config.maxWordsPerTurn !== 28 ||
      aspect !== project.config.aspectRatio);

  // First write: persist any Step-2 topic/style/aspect edits (the project may have
  // been lazily created back on Step 1 with the placeholder topic), then run.
  async function create() {
    if (!settingsValid) return;
    if (configChanged && !(await ctx.patch({ config: configPatch }))) return;
    await ctx.generate({ to: "speech" });
  }

  // Rewrite from the topic. ALWAYS invalidate the whole downstream chain the way an edit does
  // (PATCH applies the INVALIDATION map) so a fresh script + voices can never leave stale
  // video / b-roll / output marked done behind it.
  async function rewrite() {
    if (!settingsValid) return;
    if (!project?.script) return create();
    if (configChanged && !(await ctx.patch({ config: configPatch }))) return;
    if (!(await ctx.patch({ script: project.script }))) return;
    await ctx.generate({ only: ["script", "speech"], force: true });
  }

  // Re-synthesize voices for the current script (e.g. after a Step-1 voice change cleared the audio).
  async function revoice() {
    await ctx.generate({ to: "speech" });
  }

  // Re-voice with the user's manual text edits (clears speech + downstream, then re-synthesizes).
  async function applyEdits() {
    if (!script) return;
    if (!(await ctx.patch({ script: { ...script, turns: draft } }))) return;
    await ctx.generate({ to: "speech" });
  }

  async function fullVideo() {
    if (!script && configChanged && !(await ctx.patch({ config: configPatch }))) return;
    if (script && edited && !(await ctx.patch({ script: { ...script, turns: draft } }))) return;
    await ctx.generate({ to: "render" });
  }

  async function autoDirect() {
    if (!ctx.slug || !script) return;
    setDirecting(true);
    setDeliveryNotice("");
    try {
      if (edited && !(await ctx.patch({ script: { ...script, turns: draft } }))) return;
      const result = await directDelivery(ctx.slug);
      setDraft(result.script.turns);
      setDeliveryNotice("Delivery cues updated. Review them, then re-voice to hear the result. Voice generation uses Fish credits.");
    } catch (error) { setDeliveryNotice(error instanceof Error ? error.message : String(error)); }
    finally { setDirecting(false); }
  }

  // Remove a whole turn. The per-turn diff is positional, so every line AFTER the
  // deleted one shifts and gets re-voiced — free on a fresh script, but paid audio
  // deserves a confirm. (A conversation needs at least two lines.)
  async function removeTurn(i: number) {
    if (draft.length <= 2) return;
    if (
      hasSpeech &&
      !(await ctx.confirm({
        title: "Delete this line?",
        body: "Removing a line changes the turn order and invalidates generated audio for the affected script range.",
        details: [
          "This line's audio and clip will be removed.",
          ...(draft.length - 1 - i > 0
            ? [`${draft.length - 1 - i} following line${draft.length - 1 - i === 1 ? "" : "s"} will re-voice on the next Re-voice edits run.`]
            : []),
        ],
        confirmLabel: "Delete line",
        tone: "danger",
      }))
    ) {
      return;
    }
    setDraft((d) => d.filter((_, j) => j !== i));
  }

  return (
    <div>
      <StepHeader title="Script" hint="A topic becomes a tight two-host dialogue. Tweak any line, then re-voice it." />
      <p className="mb-3 text-xs text-[var(--color-text-muted)]">
        Language: {languageLabel(language)} · <button onClick={() => ctx.go(1)} className="text-[var(--color-accent)] hover:underline">change in Cast &amp; voice</button>
        {script && language !== (project?.config.language ?? "en") && " · Rewrite to apply the new language."}
      </p>

      <details open={!script} className="episode-settings mb-5 border border-[var(--color-hairline)] p-4">
        <summary className="mb-3 cursor-pointer text-sm font-semibold">Episode brief &amp; generation settings</summary>
        <WriterSettings />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--color-text-secondary)]">
          Video provider
          <select value={project?.options.videoProvider ?? "replicate-p-video"} disabled={disabled || !!project?.clips?.length} onChange={(event) => void ctx.patch({ options: { videoProvider: event.target.value as VideoProviderId } })} className={`${inputClass} mt-1`}>
            {VIDEO_PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
        </label>
        {project?.options.videoProvider === "heygen" && <label className="text-xs text-[var(--color-text-secondary)]">
          HeyGen billing
          <select value={project.options.heygenAuth ?? "subscription"} disabled={disabled} onChange={(event) => void ctx.patch({ options: { heygenAuth: event.target.value as "subscription" | "api" } })} className={`${inputClass} mt-1`}>
            <option value="subscription">Subscription</option><option value="api">API</option>
          </select>
        </label>}
      </div>
      {!!project?.clips?.length && <p className="mb-3 text-xs text-[var(--color-text-muted)]">To change the provider for existing clips, use the Videos step.</p>}
      <ScriptImport disabled={disabled} onOpenChange={setImportOpen} onImported={(imported) => setDraft(imported.turns)} />

      <label className="mono mb-1.5 block text-[10px] tracking-[0.08em] text-[var(--color-text-muted)]">TOPIC</label>
      <textarea value={topic} disabled={disabled} onChange={(e) => setTopic(e.target.value)} rows={2} placeholder="What should the hosts talk about?" className={`${inputClass} resize-none`} />

      <div className="mt-3">
        <label className="mono mb-1.5 block text-[10px] tracking-[0.08em] text-[var(--color-text-muted)]">STYLE</label>
        <input value={style} disabled={disabled} onChange={(e) => setStyle(e.target.value)} placeholder={DEFAULT_STYLE} className={inputClass} />
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label className="text-xs text-[var(--color-text-secondary)]">
          Target length (seconds)
          <input type="number" min={15} max={600} step={15} value={ctx.targetDurationSec} onChange={(e) => ctx.setTargetDurationSec(Number(e.target.value))} disabled={disabled} className={`${inputClass} mt-1 w-28`} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-[var(--color-text-secondary)]">
          <input type="checkbox" checked={ctx.autoEmotionTags} onChange={(e) => ctx.setAutoEmotionTags(e.target.checked)} disabled={disabled} />
          Context-aware delivery cues
        </label>
      </div>
      <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Approximate length; voice speed and pauses affect the result. Settings apply when you write or rewrite.</p>
      <label htmlFor="source-links" className="mono mt-3 mb-1.5 block text-[10px] tracking-[0.08em] text-[var(--color-text-muted)]">REFERENCE LINKS (OPTIONAL)</label>
      <textarea id="source-links" value={ctx.sourceLinks} onChange={(e) => ctx.setSourceLinks(e.target.value)} disabled={disabled} rows={2} placeholder="Paste up to five article or official announcement links, one per line. Live sources are checked before drafting." className={inputClass} />
      {!settingsValid && <p className="mt-1 text-xs text-[var(--color-danger)]">Choose 15–600 seconds and at most five public HTTPS links.</p>}
      {script && (
        <div className="mt-3 border border-[var(--color-hairline)] p-2 text-xs text-[var(--color-text-muted)]">
          {script.sources?.length ? (
            <details>
              <summary className="cursor-pointer">Sources checked {script.researchedAt?.slice(0, 10)} · {script.sources.length} links</summary>
              <ul className="mt-2 space-y-1">
                {script.sources.filter((source) => isPublicSourceUrl(source.url)).map((source, index) => (
                  <li key={`${source.url}-${index}`}><a href={source.url} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">{source.title}</a>{source.publishedAt && ` · ${source.publishedAt}`}</li>
                ))}
              </ul>
            </details>
          ) : "No verified sources attached. Rewrite with source checks to research this topic."}
          {project?.speech && <p className="mt-1">Current audio: {Math.round(project.speech.durationSec)} seconds.</p>}
        </div>
      )}

      </details>

      {!script ? (
        <StepFooter>
          <button onClick={fullVideo} disabled={disabled || !topic.trim() || !settingsValid || importOpen} className="btn btn-ghost px-5 py-2.5 text-sm disabled:opacity-50">Generate full video</button>
          <button onClick={create} disabled={disabled || !topic.trim() || !settingsValid} className="btn btn-primary px-5 py-2.5 text-sm disabled:opacity-50">
            {running ? "Writing…" : "Generate script & voices"}
          </button>
        </StepFooter>
      ) : (
        <>
          <div className="mt-5 mb-2 flex items-center justify-between">
            <div className="mono text-[10px] tracking-[0.08em] text-[var(--color-text-muted)]">
              {turns.length} TURNS{script.title ? ` · ${script.title}` : ""}
              {edited && <span className="ml-1 text-[var(--color-warn)]">· unsaved…</span>}
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              <button onClick={autoDirect} disabled={disabled || importOpen || draft.some((turn) => !turn.text.trim())} className="mono text-[11px] text-[var(--color-accent)] disabled:opacity-40">{directing ? "Directing…" : "Auto-direct delivery"}</button>
              <button onClick={rewrite} disabled={disabled || !settingsValid} className="mono text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40">↻ rewrite with source checks</button>
            </div>
          </div>
          {deliveryNotice && <p role="status" className="mb-3 text-xs text-[var(--color-text-secondary)]">{deliveryNotice}</p>}

          <div className="divide-y divide-[var(--color-hairline)]">
            {draft.map((t, i) => {
              const host = project!.config.hosts.find((h) => h.id === t.hostId) ?? project!.config.hosts[0];
              const color = providerColor(providerOfModel(host.model));
              const channel = ctx.cast.find((channel) => channel.id === t.hostId);
              const face = channel ? hostFace(project, ctx.slug, channel) : undefined;
              const cue = t.text.trimStart().match(/^\[([^\]]+)\]/)?.[1] ?? "";
              return (
                <div key={i} className="script-turn group">
                  <div className="turn-host flex shrink-0 flex-col gap-2 pt-0.5">
                    {face ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={face} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
                    <span className="turn-name">{host.name}</span>
                    <select
                      aria-label={`Delivery for ${host.name}, line ${i + 1}`}
                      value={cue}
                      disabled={disabled}
                      onChange={(e) => setDraft((lines) => lines.map((line, j) => j === i ? { ...line, text: withEmotionCue(line.text, e.target.value) } : line))}
                      className="mt-1 w-24 border border-[var(--color-hairline)] bg-[var(--color-surface)] p-1 text-[10px]"
                    >
                      <option value="">Host default</option>
                      {cue && !EMOTION_TAGS.some((tag) => tag === cue) && <option value={cue}>Custom cue</option>}
                      {EMOTION_TAGS.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                    </select>
                    <input aria-label={`Custom delivery for ${host.name}, line ${i + 1}`} title={cue || "Write a short, specific voice direction"} value={cue} placeholder="e.g. quietly doubtful" maxLength={120} disabled={disabled} onChange={(event) => setDraft((lines) => lines.map((line, j) => j === i ? { ...line, text: withEmotionCue(line.text, event.target.value.replace(/[[\]]/g, "")) } : line))} className="w-24 border border-[var(--color-hairline)] bg-[var(--color-surface)] p-1 text-[10px]" />
                  </div>
                  <textarea
                    value={t.text}
                    disabled={disabled}
                    onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                    rows={2}
                    className="min-h-0 w-full resize-none border-0 bg-transparent text-base leading-relaxed outline-none focus:bg-[var(--color-surface-2)] disabled:opacity-60"
                  />
                  <button
                    onClick={() => void removeTurn(i)}
                    disabled={disabled || draft.length <= 2}
                    title={draft.length <= 2 ? "A conversation needs at least two lines" : "Delete this line"}
                    aria-label={`Delete turn ${i + 1}`}
                    className="mono h-fit shrink-0 px-1 text-[11px] text-[var(--color-text-muted)] opacity-0 hover:text-[var(--color-danger)] focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-0"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          <StepFooter>
            <button onClick={fullVideo} disabled={disabled || importOpen || draft.some((turn) => !turn.text.trim())} className="btn btn-ghost px-5 py-2 text-sm disabled:opacity-50">{running ? "Generating…" : "Generate full video"}</button>
            {edited ? (
              <button onClick={applyEdits} disabled={disabled} className="btn btn-primary px-5 py-2 text-sm disabled:opacity-50">{running ? "Updating voices…" : "Update voices"}</button>
            ) : !hasSpeech ? (
              <button onClick={revoice} disabled={disabled} className="btn btn-primary px-5 py-2 text-sm disabled:opacity-50">{running ? "Generating voices…" : "Generate voices"}</button>
            ) : (
              <button onClick={() => ctx.go(3)} disabled={disabled} className="btn btn-primary px-5 py-2 text-sm disabled:opacity-50">Continue to Videos →</button>
            )}
          </StepFooter>
        </>
      )}
    </div>
  );
}
