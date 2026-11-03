import { SITE } from "@/lib/site";
import { Wordmark } from "./Wordmark";

export function Footer() {
  return (
    <footer className="border-t border-[var(--color-hairline)] py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 sm:flex-row sm:items-center">
        <div>
          <Wordmark />
          <p className="mt-2 max-w-sm text-sm text-[var(--color-text-secondary)]">
            An open-source podcast studio with{" "}
            <a href={SITE.fish} className="text-[var(--color-accent)] hover:underline">
              Fish Audio
            </a>
            . Built with local Codex, P-Video, LTX, HeyGen and{" "}
            <a href={SITE.hyperframes} className="text-[var(--color-text)] hover:underline">
              HyperFrames
            </a>
            .
          </p>
        </div>
        <div className="flex items-center gap-5 text-sm text-[var(--color-text-secondary)]">
          <a href={SITE.github} className="hover:text-[var(--color-text)]">
            GitHub
          </a>
          <a href={SITE.fishDocs} className="hover:text-[var(--color-text)]">
            Docs
          </a>
          <span className="mono text-xs text-[var(--color-text-muted)]">Apache-2.0</span>
        </div>
      </div>
    </footer>
  );
}
