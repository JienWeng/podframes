# Podframes

Turn a topic into a two-host podcast video: local Codex writes the script and generates images, Fish Audio supplies voices using website credits, local Whisper supplies word timestamps, and HyperFrames renders the finished MP4.

The existing Podframes studio flow and visual design stay intact. Choose **P-Video Avatar**, **LTX-2.3**, or **HeyGen** for per-turn lip-sync.

## Setup

Requires Node 22+, pnpm, ffmpeg/ffprobe, the local Codex CLI, and whisper.cpp with a multilingual model.

```sh
pnpm install
codex login
codex mcp add fish-audio --url https://api.fish.audio/mcp
codex mcp login fish-audio
```

Sign in to Codex with your ChatGPT account and to Fish Audio in the browser. Fish speech uses your **website credits**, including the free-plan allowance. `FISH_API_KEY` and developer API credit are not used.

For measured caption timing, install local Whisper (macOS):

```sh
brew install whisper-cpp
mkdir -p ~/.cache/podframes
curl -fL https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -o ~/.cache/podframes/ggml-base.bin
```

Other platforms can build [whisper.cpp](https://github.com/ggml-org/whisper.cpp). Set `WHISPER_MODEL` if your model is stored elsewhere.

Choose a video provider. API credentials can go in the project root’s `.env.local` or `.env`:

- `REPLICATE_API_KEY`: P-Video Avatar, the default.
- `FAL_API_KEY`: LTX-2.3.
- HeyGen subscription login or `HEYGEN_API_KEY`: HeyGen.

```sh
pnpm podframes doctor
pnpm dev:web
# Open http://localhost:3000/studio
```

Run this app locally on the machine with the Codex and HeyGen sessions. A remotely hosted server cannot access your computer's local sessions.

## Pipeline

For the complete first-episode walkthrough, recurring automation commands, script format, character/image reuse, and failure recovery, see the [podcast automation guide](docs/AUTOMATION.md).

In Studio’s **Script** step, use **Generate full video** for a topic, or **Paste or import a script → Import & generate full video** for external dialogue. Both run through speech, avatars, lip-sync, B-roll, captions, and the final MP4 without stepping through each screen. The selected provider must already be authenticated; generation uses its credits. Completed stages are reused when you resume.

Plain `.txt` is the simplest interchange format; `.md` accepts the same speaker-labelled dialogue, an optional `# Title`, and bold speaker labels. Use your cast names or `HOST_A` / `HOST_B`. Continuation lines belong to the preceding speaker. Fish delivery tags remain intact. Imports preserve wording and do not automatically fact-check claims.

```text
# Episode title
HOST_A: [curious] What happened?
HOST_B: Let’s walk through the evidence.
```

For local automation, save that text as `episode.md` and run from the repository root:

```sh
pnpm podframes generate --script episode.md --slug my-episode --provider heygen --heygen-auth subscription --language zh --aspect 9:16
```

Use your script’s language and desired provider. The final file is `projects/my-episode/output.mp4`. Re-run the same command to resume completed work; changing the imported dialogue invalidates downstream audio/video. `--only script` imports and validates without calling generation services.

For recurring episodes, use `--template <existing-project-slug>`. It inherits the show's hosts, Fish voices, language, framing, video provider, and edit settings. Saved host portraits are copied exactly into the new episode, including generated characters. Existing B-roll images become a reusable library; the planner can select relevant images with fresh timing. Old dialogue, audio, and lip-sync clips are not copied. Source images are copied into independent files, so changing/deleting the template does not change the episode. The template must have both saved host portraits and its referenced image files. Use a different slug for every new episode.

In the interface, open **Studio → Your videos → Use as template** on the source project's card. The new episode opens in **Cast & voice** with the copied faces and voices. Review them, proceed to **Script**, paste/import the new dialogue, and choose **Import & generate full video**. To choose a different individual face, click its portrait in **Cast & voice**. The source project is kept intact, and old episode reference links are not carried over.

This sample uses your existing show and the included Mandarin script:

```sh
pnpm podframes generate --template what-makes-a-good-cold-open-episode --script examples/automation/episode.md --slug podcast-episode-002 --provider heygen --heygen-auth subscription --language zh
```

An external research/writing agent can save a new Markdown file and run that command locally, using a new episode slug each time. The result is `projects/podcast-episode-002/output.mp4`. The command runs one episode and exits; it does not install a schedule or folder watcher.

1. **Script:** a fresh local `codex exec` task returns structured two-host dialogue.
2. **Speech:** Fish Audio MCP synthesizes each turn using website credits. Local Whisper transcribes that exact audio for measured word timestamps. ffmpeg assembles the master audio and inter-turn pauses.
3. **Avatars:** keep a roster face, upload a photo, or choose **Generate portrait** in the face picker. Generated portraits use Codex's built-in image tool.
4. **Animation:** P-Video, LTX, or HeyGen animates each portrait against the turn's actual audio.
5. **B-roll:** Codex chooses timed supporting visuals, stat cards, quotes, and lower-thirds. Use **Upload photo** on an image cue for real photography or screenshots (PNG/JPEG/WebP, up to 10 MB), or **Generate AI** for a candid documentary-style illustration. Uploads retain the cue's timing and camera motion; re-rendering reuses them. Re-suggesting replaces the cue list, including uploaded photos. This stage does not generate video footage.
6. **Compose/render:** HyperFrames assembles the clips, audio, captions, and supporting visuals into MP4.

Codex uses your existing ChatGPT login, with an isolated temporary workspace per request. API-key environment variables are removed from its subprocess environment. There is no automatic fallback to paid OpenAI API generation. Built-in image availability and subscription limits apply; unsupported sessions fail clearly.

## Language

Choose **Language** in **Cast & voice** before generating. English is the default; the picker includes Malay, Mandarin Chinese, Tamil, Indonesian, Japanese, Korean, Spanish, French, German, Hindi, Arabic, Thai, and Vietnamese. The selection is saved with the studio draft and used for new script dialogue, default voice-preview text, Fish speech, Whisper decoding, and b-roll labels. An existing script keeps its text until you click **rewrite**. Voice accent and delivery still depend on the chosen Fish voice.

## Drafting, sources, length, and delivery

The editable [scripting reference library](examples/script-library/README.md) supplies original conversational examples to topic drafting and **Auto-direct delivery**. It teaches rhythm, reactions, corrections, and restrained delivery through short reference excerpts; it does not train the model or replace current source checks. Edit the `zh-` examples for Mandarin. New requests read the current files automatically.

The Script step checks live web sources before writing. It uses the current UTC date to distinguish recent updates from historical incidents, opens relevant reporting, and saves source links and publication dates with the draft. Paste up to five public HTTPS reference links to steer the research. Expand **Sources checked** to review the evidence. Completed live-search and page-retrieval events are required, and each cited URL must match a page actually opened. A response that skips research or cites an unopened link is rejected. Redirects to generic indexes or login pages are not treated as evidence for an article headline.

Set **Target length (seconds)** from 15 to 600 seconds. This controls an approximate speech budget and turn count, rather than promising an exact final duration. Current audio length appears after synthesis.

**Context-aware delivery cues** directs new dialogue using the whole exchange, each host's persona/default style, and the intent of individual lines. It uses short free-form Fish directions for pace, emphasis, and restrained reactions, including inline changes when useful. There is no fixed tag quota or required list of emotions, and each turn gets at most two cues. An explicit leading per-line cue overrides the host's default style.

For an existing or imported script, click **Auto-direct delivery** in the Script step. This makes a Codex delivery-only proposal: spoken words, punctuation, numbers, speaker assignments, turn order, and source metadata are preserved. A result that changes the dialogue is rejected. Review the cues in the editor, adjust the new custom-delivery input if needed, then re-voice to hear them. The editor saves cue changes like other text edits; affected audio/video becomes stale, while new Fish generation starts only when requested. Direction suggestions alone do not synthesize speech. Audio quality still needs a listening check with the chosen voice.

Codex uses `gpt-6.1-sol` by default. If it reports capacity before any speech-generation tool starts, the app tries `gpt-6-sol` once. It does not automatically repeat an uncertain Fish generation. Set `PODFRAMES_CODEX_MODEL` in the root `.env` or `.env.local` to use another model available to your Codex subscription, then restart the app.

## Fish Audio voices

The studio includes public reference voices from [Fish's quickstart](https://docs.fish.audio/developer-guide/getting-started/quickstart). Paste a different Fish voice reference ID in the cast editor to use your own voice. The default model is `fish/s2.1-pro`.

Voice previews and full turns use the official [Fish MCP connection](https://docs.fish.audio/overview/mcp), authenticated through Codex OAuth. Each request checks website credit and text limits. The free plan currently limits a speech call to 500 UTF-8 bytes; Chinese characters usually use three bytes each. Advanced developer API tuning options are not supported in website-credit mode.

Fish MCP transcription returns plain text without timestamps, so captions and segment timing are measured locally with Whisper. Missing or malformed timestamps fail the turn instead of fabricating timing. Generated audio URLs are cached per turn before download and alignment, so retries can reuse speech already bought. Uncertain MCP generation failures are not automatically retried, to avoid duplicate charges.

The local speech subprocess exposes only Fish credit balance and speech generation tools. It approves the requested speech tool within that subprocess; it does not grant other Fish tools access or change global tool-approval preferences.

## HeyGen subscription or API

Install the [official HeyGen CLI](https://github.com/heygen-com/heygen-cli#install), then choose a billing source:

```sh
# Subscription credits: complete browser login yourself.
heygen auth login --oauth
heygen auth status

# Or API credits: add HEYGEN_API_KEY to .env.local.
```

In the studio's **Generate videos** step, select **HeyGen**, then **Subscription** or **API credits**. API mode requires `HEYGEN_API_KEY`. Subscription mode removes the API key from the child environment and requires the CLI's stored OAuth credential. The app never changes your stored login. The CLI stores only one credential type; OAuth login replaces a stored API credential, and vice versa.

Each image and audio segment is uploaded through `heygen asset create`. Remote video IDs are saved beside the clip, so interrupted generation resumes the same job. Explicit clip regeneration creates a fresh request. If a creation request has an unknown outcome for over 24 hours, the app requires reconciliation with `heygen video list` rather than risking a duplicate purchase.

## CLI

```sh
pnpm podframes generate --topic "Why is the sky blue?" --turns 10
pnpm podframes generate --topic "AI agents" --only script,speech
pnpm podframes generate --topic "Coffee" --provider fal-ltx
pnpm podframes generate --topic "Coffee" --provider heygen --heygen-auth subscription
pnpm podframes generate --topic "Coffee" --provider heygen --heygen-auth api
pnpm podframes --help
```

Projects remain under `projects/<slug>/`. Existing completed media is retained. For older Speechbase projects, choose Fish Audio and valid Fish reference IDs for both hosts before regenerating speech; old provider voice IDs are not interchangeable.

## Development

```sh
pnpm typecheck
pnpm --filter @podframes/core test
pnpm build:web
```

Provider tests use mocked HTTP or local CLI fixtures and do not spend provider credits.

Apache-2.0. Based on [Jellypod's Podframes](https://github.com/Jellypod-Inc/podframes).
