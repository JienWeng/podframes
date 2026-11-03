/** Quick-pick host presets. Portraits are static assets at /roster/<key>.png. */
export interface RosterPreset {
  key: string;
  name: string;
  provider: string;
  voice?: string;
  appearance: string;
}

export const ROSTER: RosterPreset[] = [
  {
    key: "ada",
    name: "Ada",
    provider: "fish",
    voice: "ca3007f96ae7499ab87d27ea3599956a",
    appearance:
      "East Asian woman in her early 30s, sleek straight black shoulder-length hair, light warm skin, olive blazer over a white tee, friendly expressive face",
  },
  {
    key: "ren",
    name: "Ren",
    provider: "fish",
    appearance:
      "East Asian man in his early 30s, modern undercut hairstyle, light skin, black bomber jacket, cool and composed",
  },
  {
    key: "sol",
    name: "Sol",
    provider: "fish",
    appearance:
      "Latino man in his mid-30s, short dark wavy hair, trimmed beard, warm olive skin, denim shirt, relaxed grin",
  },
  {
    key: "theo",
    name: "Theo",
    provider: "fish",
    voice: "9a9cf47702da476aa4629e2506d4a857",
    appearance:
      "white man in his late 30s, light stubble, glasses, fair skin, charcoal henley, animated demeanor",
  },
  {
    key: "maya",
    name: "Maya",
    provider: "fish",
    appearance:
      "Black woman in her early 30s, voluminous natural curls, warm brown skin, mustard turtleneck, expressive",
  },
  {
    key: "nia",
    name: "Nia",
    provider: "fish",
    appearance:
      "South Asian woman in her late 20s, long dark wavy hair, brown skin, emerald green blouse, thoughtful",
  },
];

export const rosterThumb = (key: string) => `/roster/${key}.png`;
