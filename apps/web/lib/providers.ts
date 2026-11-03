import { PROVIDER_COLORS, PROVIDER_COLOR_FALLBACK } from "@podframes/core/shared";

/** TTS providers, with their patch-bay channel colors. */
export interface ProviderMeta {
  id: string;
  label: string;
  color: string;
  /** Pickable models for the studio (a curated subset; custom reference IDs are supported). */
  models?: { id: string; label: string; voices: { id: string; label: string }[] }[];
}

const FISH_VOICES = [
  { id: "ca3007f96ae7499ab87d27ea3599956a", label: "E-Girl" },
  { id: "9a9cf47702da476aa4629e2506d4a857", label: "Energetic Male" },
  { id: "7333de76d727400a9669108c3f439328", label: "0118OD - AC010 V2 200FS3" },
  { id: "2ab2e9d8c2564f8da20d9643e1e41763", label: "阿胜老板Malaysia" },
];

export const PROVIDERS: ProviderMeta[] = [{
  id: "fish",
  label: "Fish Audio",
  color: PROVIDER_COLORS.fish!,
  models: [{
    id: "fish/s2.1-pro",
    label: "S2.1 Pro",
    voices: FISH_VOICES,
  }, {
    id: "fish/drama-3",
    label: "Drama 3",
    voices: FISH_VOICES,
  }],
}];

export const PICKABLE_PROVIDERS = PROVIDERS.filter((p) => p.models?.length);

export function providerById(id: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function providerColor(id: string): string {
  return providerById(id)?.color ?? PROVIDER_COLOR_FALLBACK;
}

export function providerOfModel(model: string): string {
  const i = model.indexOf("/");
  return i > 0 ? model.slice(0, i) : "unknown";
}
