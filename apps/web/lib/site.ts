export const SITE = {
  name: "podframes",
  tagline: "Turn a topic into a podcast you can watch.",
  github: "https://github.com/Jellypod-Inc/podframes",
  fish: "https://fish.audio",
  fishDocs: "https://docs.fish.audio",
  hyperframes: "https://hyperframes.heygen.com",
} as const;

// One source of truth — "@podframes/core/shared" is browser-safe (pure constants).
export { CAPTION_STYLE_PRESETS as CAPTION_STYLES } from "@podframes/core/shared";

/** Quick-pick caption colors (the picker also accepts any custom hex). */
export const CAPTION_COLORS = ["#22D3EE", "#A78BFA", "#34D399", "#FBBF24", "#FB7185", "#F5F0E0", "#5B8CFF"] as const;

export interface PipelineStep {
  n: string;
  title: string;
  tech: string;
  blurb: string;
}

export const PIPELINE: PipelineStep[] = [
  {
    n: "01",
    title: "Write the script",
    tech: "Local Codex",
    blurb: "A topic becomes a tight two-host dialogue — alternating turns, real facts, a clean button.",
  },
  {
    n: "02",
    title: "Mix the voices",
    tech: "Fish Audio",
    blurb:
      "Each host has a Fish Audio voice. Website credits generate speech; local Whisper measures word timestamps.",
  },
  {
    n: "03",
    title: "Cast the hosts",
    tech: "Codex images",
    blurb: "Use one base avatar image per host, from the roster, an upload, or a neutral generated portrait.",
  },
  {
    n: "04",
    title: "Animate them",
    tech: "P-Video / LTX / HeyGen",
    blurb:
      "Each line becomes its own clip, lip-synced to that turn's real audio. Choose P-Video, LTX, or HeyGen.",
  },
  {
    n: "05",
    title: "Package it",
    tech: "Codex + image generation",
    blurb:
      "The timestamped transcript drives karaoke captions, b-roll, lower-thirds, and stat cards — on the beat.",
  },
  {
    n: "06",
    title: "Render the video",
    tech: "HyperFrames",
    blurb: "Everything composites into deterministic HTML and renders to a shareable MP4.",
  },
];
