import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { ShowcaseClips } from "@/components/ShowcaseClips";
import { ROSTER, rosterThumb } from "@/lib/roster";
import { SITE } from "@/lib/site";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <section className="landing-hero overflow-hidden">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-16 sm:px-10 lg:grid-cols-[1.1fr_1fr] lg:py-24">
            <div>
              <p className="mb-6 text-sm font-semibold text-[var(--color-accent)]">A studio for your next conversation</p>
              <h1 className="max-w-2xl text-5xl font-extrabold leading-[1.02] tracking-[-0.045em] sm:text-6xl xl:text-7xl">Big ideas.<br />Real conversation.<br /><span className="text-[var(--color-accent)]">Press play.</span></h1>
              <p className="mt-7 max-w-lg text-lg leading-relaxed text-[var(--color-text-secondary)]">Turn a topic or script into a two-host podcast video. Cast your characters, shape every line, and make it yours.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/studio" className="btn btn-primary px-6 py-3 text-base">Create an episode →</Link>
                <a href="#showcase" className="btn btn-ghost px-6 py-3 text-base">Watch the possibilities</a>
              </div>
              <p className="mt-6 text-sm text-[var(--color-text-muted)]">Your characters. Your voices. Your creative direction.</p>
            </div>
            <div className="panel overflow-hidden p-4 sm:p-6">
              <div className="mb-5 flex items-center justify-between"><span className="text-sm font-semibold">In the studio</span><span className="rounded-full bg-[var(--color-surface-2)] px-3 py-1 text-xs text-[var(--color-accent)]">Two hosts · endless stories</span></div>
              <div className="grid grid-cols-2 gap-3">
                {[ROSTER[1], ROSTER[0]].map((host) => <div key={host.key} className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-[var(--color-surface-2)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={rosterThumb(host.key)} alt={`${host.name}, a Podframes host`} className="h-full w-full object-cover" />
                  <span className="absolute bottom-3 left-3 rounded-full bg-[#15271fe8] px-3 py-1 text-sm font-semibold text-white">{host.name}</span>
                </div>)}
              </div>
              <div className="mt-4 rounded-xl bg-[var(--color-surface-2)] p-4">
                <p className="text-sm font-semibold">What makes a good cold open?</p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">A question that makes you want to hear the answer. Give your hosts something worth talking about.</p>
                <div className="mt-4 flex items-center gap-3 text-xs text-[var(--color-text-muted)]"><span className="text-[var(--color-accent)]">●</span> Cast <span>—</span> Script <span>—</span> Video <span>—</span> Export</div>
              </div>
            </div>
          </div>
        </section>

        <section id="showcase" className="mx-auto max-w-7xl px-6 py-20 sm:px-10">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-5">
            <div><p className="mb-3 text-sm font-semibold text-[var(--color-accent)]">Made in Podframes</p><h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Conversations you can watch.</h2></div>
            <Link href="/studio" className="text-sm font-semibold text-[var(--color-accent)]">Make your own →</Link>
          </div>
          <ShowcaseClips />
        </section>

        <section id="pipeline" className="border-y border-[var(--color-hairline)] bg-[var(--color-surface)]">
          <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 sm:px-10 lg:grid-cols-[1fr_1.4fr]">
            <div><p className="mb-3 text-sm font-semibold text-[var(--color-accent)]">From spark to screen</p><h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Direct the details.<br />Or let it flow.</h2><p className="mt-5 text-base leading-relaxed text-[var(--color-text-secondary)]">Generate a full episode, then refine the moments that matter. Your saved cast and style are ready for the next one.</p></div>
            <ol className="divide-y divide-[var(--color-hairline)]">
              {[
                ["Bring an idea", "Start with a topic, source links, or your own Markdown or text script. Set the language and target length."],
                ["Give it a voice", "Choose your characters and Fish Audio voices. Edit the dialogue and direct how each line feels."],
                ["Make it move", "Generate talking hosts, add supporting visuals, and refine script-based captions."],
                ["Ready for its audience", "Review the episode and export your video, audio, or captions."],
              ].map(([title, copy], i) => <li key={title} className="flex gap-5 py-6 first:pt-0"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-sm font-semibold text-[var(--color-accent)]">{i + 1}</span><div><h3 className="text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{copy}</p></div></li>)}
            </ol>
          </div>
        </section>

        <section id="providers" className="mx-auto max-w-7xl px-6 py-20 sm:px-10">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div className="grid grid-cols-3 gap-3">{ROSTER.slice(2, 5).map((host) => <div key={host.key} className="overflow-hidden rounded-2xl bg-[var(--color-surface-2)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={rosterThumb(host.key)} alt={host.name} className="aspect-[3/4] w-full object-cover" />
              <p className="px-4 py-3 text-sm font-semibold">{host.name}</p>
            </div>)}</div>
            <div className="lg:pl-8"><p className="mb-3 text-sm font-semibold text-[var(--color-accent)]">A cast with character</p><h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Find your voices.<br />Keep your chemistry.</h2><p className="mt-5 text-base leading-relaxed text-[var(--color-text-secondary)]">Pick a portrait, upload your own, or generate a new character. Save an episode as a template to bring the same hosts and styling into your next conversation.</p><Link href="/studio?new=1" className="btn btn-ghost mt-6 px-5 py-2">Meet your cast →</Link></div>
          </div>
        </section>

        <section id="quickstart" className="border-t border-[var(--color-hairline)]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-8 px-6 py-16 sm:px-10">
            <div><h2 className="text-2xl font-bold tracking-tight">Built for your workflow.</h2><p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--color-text-secondary)]">Local Codex, Fish Audio, HeyGen, P-Video, LTX, and HyperFrames. Use the studio or automate episodes through the CLI.</p></div>
            <a href={SITE.github} target="_blank" rel="noreferrer" className="btn btn-ghost px-5 py-3">Explore the open-source project ↗</a>
          </div>
        </section>
        <section className="bg-[var(--color-accent-fill)] px-6 py-20 text-center text-[var(--color-accent-fg)]">
          <h2 className="text-4xl font-extrabold tracking-tight sm:text-5xl">What are we talking about next?</h2>
          <Link href="/studio" className="btn mt-8 bg-[#17372b] px-7 py-3 text-base text-white hover:bg-[#244b3b]">Open your studio →</Link>
        </section>
      </main>
      <Footer />
    </>
  );
}
