"use client";

import { useWizard } from "./context";

export const inputClass =
  "w-full min-w-0 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-60";

/** The title + one-line intent for a step. */
export function StepHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-[28px] font-bold tracking-tight leading-tight">{title}</h2>
      {hint && <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}

/** Bottom action row: Back on the left (auto from step), the step's primary action(s) on the right. */
export function StepFooter({ children }: { children: React.ReactNode }) {
  const { step, go, locked, busy } = useWizard();
  return (
    <div className="step-footer mt-8 flex items-center justify-between gap-3 border-t border-[var(--color-hairline)] pt-5">
      {step > 1 ? (
        <button onClick={() => go(step - 1)} disabled={locked || busy} className="btn btn-ghost px-3 text-sm disabled:opacity-50 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">← Back</button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
