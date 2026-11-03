"use client";

import { StudioSidebar } from "./StudioSidebar";
import { useState } from "react";
import { deleteProject, createFromTemplate } from "@/components/studio/api";
import type { ProjectSummary } from "@/lib/dto";
import { clearStudioDraft } from "./draft-storage";

const STAGES = ["script", "speech", "stills", "video", "broll", "compose", "render"];

/** The projects library — open or delete each video; start a new one. */
export function ProjectsHome({ projects: initial }: { projects: ProjectSummary[] }) {
  const [projects, setProjects] = useState(initial);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

  async function createEpisode(slug: string) {
    setBusy(slug);
    setTemplateError(null);
    try {
      const episode = await createFromTemplate(slug);
      window.location.assign(`/studio?slug=${encodeURIComponent(episode.slug)}&step=1`);
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : String(error));
      setBusy(null);
    }
  }

  async function remove(slug: string) {
    setBusy(slug);
    setDeleteError(null);
    try {
      await deleteProject(slug);
      clearStudioDraft(slug);
      setProjects((ps) => ps.filter((p) => p.slug !== slug));
      setConfirm(null);
    } catch (e) {
      // Surface the reason (e.g. the 409 "run in progress" message) in the overlay.
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="studio-shell">
      <StudioSidebar library />
      <main className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-10">
      <div className="library-header flex flex-wrap items-center justify-between gap-5">
        <div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Your videos</h1>
          <span className="mt-3 block text-base text-[var(--color-text-muted)]">Make something worth talking about.</span>
        </div>
        <a href="/studio?new=1" className="btn btn-primary px-4 py-2 text-sm">+ New video</a>
      </div>
      {projects.length > 0 && <p className="mb-4 text-sm text-[var(--color-text-secondary)]">Use a video as a template to keep its characters, voices, and styling for a new episode.</p>}
      {templateError && <p role="alert" className="mb-4 text-sm text-[var(--color-danger)]">{templateError}</p>}

      {projects.length === 0 ? (
        <div className="border border-dashed border-[var(--color-hairline)] py-16 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">No videos yet.</p>
          <a href="/studio?new=1" className="btn btn-primary mt-4 px-4 py-2 text-sm">Start your first</a>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <div key={p.slug} className="project-card panel relative overflow-hidden transition-colors hover:border-[var(--color-text-muted)]">
              <a href={`/studio?slug=${p.slug}`} className="block">
                <div className="aspect-video bg-[var(--color-surface-2)]">
                  {p.hasOutput && p.videoUrl ? (
                    <video src={p.videoUrl} muted className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-[var(--color-text-muted)]">not rendered</div>
                  )}
                </div>
                <div className="p-5">
                  <div className="truncate pr-7 text-base font-semibold">{p.title || p.topic}</div>
                  <div className="mt-1 flex items-center gap-2">
                    {p.hosts.map((h, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-secondary)]">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: h.color }} />{h.name}
                      </span>
                    ))}
                    <span className="mono ml-auto text-[10px] text-[var(--color-text-muted)]">{p.durationSec ? `${p.durationSec.toFixed(0)}s` : "draft"}</span>
                  </div>
                  <div className="mt-2 flex gap-1">
                    {STAGES.map((s) => {
                      const st = p.stages[s];
                      return <span key={s} className="h-1.5 flex-1" style={{ background: st === "done" ? "var(--color-success)" : st === "error" ? "var(--color-danger)" : st === "running" ? "var(--color-accent)" : "var(--color-hairline)" }} title={s} />;
                    })}
                  </div>
                </div>
              </a>
              <div className="border-t border-[var(--color-hairline)] px-3 py-2">
                <button onClick={() => createEpisode(p.slug)} disabled={busy !== null || !p.templateReady} className="btn btn-ghost w-full py-1.5 text-xs disabled:opacity-40" title={p.templateReady ? "Copy characters, voices, style, and reusable imagery into a new episode" : "Save both host portraits in Cast & voice first"}>
                  {busy === p.slug && confirm !== p.slug ? "Creating episode…" : "Use as template"}
                </button>
                {!p.templateReady && <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Save both host portraits first.</p>}
              </div>

              <button
                onClick={() => setConfirm(p.slug)}
                className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-[var(--color-surface)] text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
                title="Delete video"
                aria-label={`Delete ${p.title || p.topic}`}
              >
                ×
              </button>

              {confirm === p.slug && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--color-surface)] p-4 text-center">
                  <p className="text-sm">Delete this video?<br /><span className="text-[12px] text-[var(--color-text-muted)]">Permanent — can&apos;t be undone.</span></p>
                  {deleteError && <p className="text-[11px] text-[var(--color-danger)]">{deleteError}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => { setConfirm(null); setDeleteError(null); }} disabled={busy === p.slug} className="btn btn-ghost px-3 py-1.5 text-xs">Cancel</button>
                    <button onClick={() => remove(p.slug)} disabled={busy === p.slug} className="rounded-none border border-[var(--color-danger)] px-3 py-1.5 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger-fill)] hover:text-[var(--color-danger-fg)] disabled:opacity-50">
                      {busy === p.slug ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      </main>
    </div>
  );
}
