# Podcast automation: first episode and recurring runs

Use a local writing/research agent to save a speaker-labelled Markdown script, then call Podframes on the same Mac. Podframes runs speech, character animation, B-roll, captions, and MP4 rendering. Keep a saved project as the show template for consistent characters and voices.

No schedule or folder watcher is installed by these steps. The CLI processes one episode and exits.

## Make your first episode in the interface

1. Open `http://localhost:3000/studio`. If the app is stopped, run `pnpm dev:web` from the repository root.
2. Open your selected [Jason/May template](http://localhost:3000/studio?slug=what-makes-a-good-cold-open-episode&step=1) to check the faces. To make a separate episode in the interface, click **‹ all**, find that project's card, then **Use as template**.
3. The new episode opens in **Cast & voice**. Check the copied portraits and Fish voices, choose the spoken language, then click **Continue to Script →**. Clicking either portrait lets you change that individual face.
4. In **Script**, set **Video provider → HeyGen** and **HeyGen billing → Subscription** to use the saved HeyGen subscription login.
5. Open **Paste or import a script**. Load [`examples/automation/episode.md`](../examples/automation/episode.md), or paste your own dialogue using the format below.
6. Check the parsed title, speakers, and lines. **Save script only** lets you review/edit before spending credits.
7. Click **Import & generate full video**. Keep the Mac and app running. Progress appears in Studio; on success it opens **Export**.
8. Watch the result, then download the MP4 from **Export**. If an image needs replacing, use **B-roll & captions → Upload photo**, then **Re-render**.

The source project is kept intact. A template without both saved portraits cannot be used until its faces are generated or uploaded.

## Script format

Plain `.txt` is the simplest format; `.md` uses the same dialogue with an optional title heading. Markdown is convenient when another writing tool already produces it.

```text
# Episode title

HOST_A: [curious] 你有没有发现，有些播客像在轮流念稿？

HOST_B: 有。下一句先回应上一句，听起来才像聊天。

HOST_A: 那我们今天就从这一点开始。

HOST_B: 好，先听对方说了什么，再决定自己怎么接。
```

- Use `HOST_A` / `HOST_B`, `A` / `B`, or the exact cast names, such as `Jason` / `May`.
- Start each new turn with a speaker and a colon. Chinese `：` also works.
- Continuation lines belong to the preceding speaker. Blank lines do not start a new turn.
- An optional `# Title` before the dialogue becomes the episode title and topic. Bold Markdown speaker labels also work.
- Keep Fish delivery cues such as `[curious]`, `[calm]`, or `[serious]` inside the dialogue. They affect delivery and are excluded from captions.
- Use 2–200 turns and under 50,000 characters. Keep turns short enough for your Fish plan's per-call limit; the service checks its current byte limit and balance before speech generation.
- Put research notes, instructions, and source lists outside the dialogue file. They are not import metadata and may otherwise be rejected or included in speech.

Imports preserve your wording. They do not rewrite to a target duration, add emotion tags automatically, or fact-check claims. For current news, the writing/research agent must verify reporting before saving the script. Studio's topic-based **rewrite with source checks** is a separate drafting path and replaces the imported wording.

For delivery revisions, open the imported episode in Studio and click **Auto-direct delivery**. It reads both hosts and the conversation, replaces/adds short free-form voice directions where useful, and rejects changes to spoken words or facts. Review the tags and re-voice afterward. Prefer specific restrained cues such as `[matter-of-fact, slightly slower on the number]` to tagging arbitrary lines `[sarcastic]` or `[laughing]`. The per-line custom-delivery field also accepts your own directions. Suggestions do not generate speech; re-voicing uses Fish credits.

## What the show template reuses

| Item | New episode behavior |
| --- | --- |
| Character portraits | Copies the exact saved image files, including generated faces, clothing, and studio background. |
| Voices and character descriptions | Inherits the hosts and their Fish voice settings. |
| Presentation | Inherits framing, resolution, language, provider, caption style, and edit settings unless CLI flags override them. |
| Saved B-roll images | Copies a reusable image library. The planner can choose a relevant image and gives it new timing for the new dialogue. |
| Old script and article links | Not carried over into the new interface-created episode. CLI imports supply their own script; old reference links are cleared by default. |
| Speech and talking clips | Generated for the new dialogue. Old audio and lip-sync clips are not copied. |

Copied images are independent of the source project. Later edits to the template do not replace those image files in an existing episode. The portrait is the character reference; new talking clips can vary in movement and expression.

The automation template is `what-makes-a-good-cold-open-episode`, the project you selected. Both Jason/May portraits were checked, and it uses Mandarin with HeyGen Subscription. Add or generate B-roll in the template if you want a reusable image library. Individual image cues also support **Upload photo** for PNG/JPEG/WebP files up to 10 MB.

## One-time local setup

Use the Mac that has your saved CLI logins. A remote server cannot use this Mac's local sessions.

```sh
cd /Users/jienweng/Code/Projects/podframes
pnpm podframes doctor
```

The setup needs Node, pnpm, ffmpeg/ffprobe, Codex with image generation, Fish website MCP access, local Whisper with a model, and the selected video provider. See the root [README setup](../README.md#setup) for installation.

If a login has expired, restore only the affected session:

```sh
codex login
codex mcp login fish-audio
heygen auth login --oauth
heygen auth status
```

Fish speech uses website credits. HeyGen **Subscription** uses its saved OAuth login; **API** uses `HEYGEN_API_KEY` and API billing. Choose the intended billing mode explicitly. A missing P-Video API key does not block a run explicitly selecting HeyGen.

## Run an episode from another tool

### Standalone script, without a chat agent

The included Node runner uses your selected template, `what-makes-a-good-cold-open-episode`. It inherits that template's language, provider, voices, character images, and visual settings.

For a topic-generated episode with live research, the scripting reference library, and automatic context-aware delivery cues:

```sh
node scripts/generate-podcast.mjs \
  --topic "为什么有些双人播客听起来像在念稿？" \
  podcast-episode-006 \
  --duration 90
```

`--duration` is an estimated drafting target of 15–600 seconds. Topic generation uses the template's `autoEmotionTags` setting; keep **Context-aware delivery cues** enabled in the template to include them. Adding `--check` to topic mode runs research and drafting with Codex but stops before Fish speech, HeyGen clips, or rendering. It uses ChatGPT subscription allowance.

For a finished external dialogue file:

```sh
cd /Users/jienweng/Code/Projects/podframes

# Validate/import only, without generation credits:
node scripts/generate-podcast.mjs examples/automation/episode.md podcast-episode-004 --check

# Run the full pipeline:
node scripts/generate-podcast.mjs examples/automation/episode.md podcast-episode-004
```

Replace the Markdown path with your own dialogue file and use a unique episode slug. The final MP4 is `projects/podcast-episode-004/output.mp4`. Re-run the same command after an interruption; the runner does not add `--force` or automatic retries. Failures return a nonzero process exit code, so another script or scheduler can detect them. To use a different show, change the `template` constant near the top of `scripts/generate-podcast.mjs`.

File mode preserves the dialogue and its supplied tags; it does not automatically run the delivery-only pass. `--duration` is rejected in file mode because it cannot shorten existing dialogue. Saved logins and credits are still required for the selected services.

### Make the scripting feel less generated

The editable [script library](../examples/script-library/README.md) contains original fictional demonstrations and curated short excerpts from your three Instagram transcripts, with notes on reactions, disagreement, clarification, returning from banter to a serious story, and restrained delivery. Raw source text is kept in `references/instagram/`; audio and real speaker attribution remain unverified. Topic writing and Studio's **Auto-direct delivery** receive matching-language excerpts on every request. Examples guide interaction and rhythm, not the episode's facts; live source checks remain required for topic generation.

To teach the show's taste, replace or edit the excerpts with short examples from your own approved dialogue. Use `zh-` filenames for Mandarin, include what you like about the exchange, and vary the examples so every episode does not learn the same joke or opening. Up to four matching files are read alphabetically, each under 6,000 characters. English excerpts are used as a fallback. This is prompt-based reference material, not permanent model training.

### Direct CLI

Run from the repository root. First validate/import the supplied sample without calling generation services:

```sh
pnpm podframes generate \
  --template what-makes-a-good-cold-open-episode \
  --script examples/automation/episode.md \
  --slug podcast-episode-002 \
  --provider heygen \
  --heygen-auth subscription \
  --language zh \
  --only script
```

This creates the new project and copies its template images, but does not generate speech, images, talking clips, or video. Check it in Studio if desired.

To generate the video, run the same command without `--only script`:

```sh
pnpm podframes generate \
  --template what-makes-a-good-cold-open-episode \
  --script examples/automation/episode.md \
  --slug podcast-episode-002 \
  --provider heygen \
  --heygen-auth subscription \
  --language zh
```

The output is:

```text
projects/podcast-episode-002/output.mp4
```

The template slug is its project folder name, not the displayed episode title. `what-makes-a-good-cold-open-episode` is the selected Jason/May template. Give every new episode a different `--slug`; keep the same slug when resuming that episode. The template and new episode must have different slugs.

For a new topic instead of an external script, replace `--script ...` with `--topic "Your topic"`. That path researches sources and drafts the dialogue before running the remaining stages. `--duration 90` requests an approximate drafting length; it does not shorten an imported script.

## Instructions for a writing/research agent

Adapt the topic, filename, language, and episode slug in this instruction:

> Create a conversational Mandarin two-host podcast script about [topic]. Read the short style references in `examples/script-library/` to learn the show's interaction and delivery style, without copying their fictional facts or jokes. For news, check current primary sources, distinguish event dates from publication dates, and retain the source notes separately. Save only the title and HOST_A/HOST_B dialogue to `episodes/episode-003.md`, creating the folder if needed. Vary turn lengths, respond to specific details, preserve speaker identity, and use short context-aware Fish directions without a tag quota. Use the saved show template `what-makes-a-good-cold-open-episode`. Run `pnpm podframes generate --template what-makes-a-good-cold-open-episode --script episodes/episode-003.md --slug podcast-episode-003 --provider heygen --heygen-auth subscription --language zh` from `/Users/jienweng/Code/Projects/podframes`. Wait for the command to finish. Return the MP4 path and report any failed stage; do not publish it automatically or use `--force` as a retry.

The calling tool must have local command execution on this Mac and permission to use the selected services' credits. Run episodes one at a time to start. No webhook, scheduler, or automatic publishing is required for this workflow.

## Resume, edit, and troubleshoot

- **Interrupted run:** rerun the same command with the same script and episode slug. Completed stages and persisted service jobs are reused where available.
- **Script changes:** changed imported dialogue invalidates downstream speech/video. Finish reviewing the text before a full run.
- **Avoid `--force` for ordinary retries:** it clears selected artifacts and can cause fresh paid generation.
- **Fish HTTP 402:** developer API balance and website credits are separate. This workflow uses the Fish website MCP login, not `FISH_API_KEY`.
- **Fish text/credit limit:** split overly long turns into shorter labelled turns, or wait for sufficient website credit. Do not change voices or billing modes silently.
- **Codex capacity:** a safe fallback is attempted before speech generation starts. An uncertain generation is not automatically repeated; follow the error's history/reconciliation guidance.
- **HeyGen unknown creation outcome:** preserve the episode folder and follow the reported job/reconciliation instructions. Do not force-create replacement clips just because polling failed.
- **Missing template image:** restore/upload the image in the source project or choose another complete template. The app fails instead of silently generating replacement characters.
- **Visual revisions:** change B-roll/caption styling in Studio and re-render. Existing speech and talking clips can be reused when those inputs are unchanged.

Validation completed for script import, template copying, voice/portrait preservation, relevant library-image reuse with new timing, and CLI import-only runs. These checks do not prove a new paid end-to-end render will succeed against the providers' current capacity and credits.

## Cast and series libraries

Open **Cast** in the studio sidebar to add a reusable character with a portrait, Fish voice ID, S2.1 Pro or Drama 3 model, personality, appearance notes, and delivery style. A saved character can start a new video. In an existing video's **Cast & voice** step, each host has **Save this cast member** and a saved-cast picker. Saving copies the current portrait and settings into the library. Applying a saved member replaces that host's character while keeping the dialogue role and screen side. Existing generated media requires regeneration after applying a different member.

Open **Series** in the sidebar and choose **New series**. Give the show a title, description, and a saved video with both portraits as its template. The series stores an independent snapshot of the cast, voices, speech models, styling, video options, and reusable images. **New episode** creates a separate editable video linked to that series. Episodes appear under the show and in **Your videos**. Existing videos remain standalone until used as the source of a new series template.

Library records and copied assets live under the repository's ignored `library/` directory. Keep this directory with `projects/` in local backups. Editing an episode or deleting the original template video does not update the stored series snapshot. To change a show's starting configuration, create a new series from the revised video. The libraries currently support adding and reuse.

## Claude Code, model APIs, and external callers

The Script settings now offer Codex, Claude Code, OpenAI API, and Anthropic API writing. Choose a model and save the settings before drafting. API keys live in the server environment. Images and Fish website-credit speech use the existing Codex connection.

External tools can use the token-protected `/api/v1/` endpoints to create series episodes, configure a writer, generate, follow progress, and download media. See [API.md](API.md) for setup, request examples, billing boundaries, and restart behavior. The versioned API is available in the current local server; the separate cloud service and persistent scheduler described in DEPLOYMENT.md are still planned.

## Worker process

Start `pnpm worker` in a separate terminal before using Studio or the HTTP automation API. Keep it running while jobs are queued. Full pipeline jobs and progress persist in `.automation/state.sqlite`, independently of the web-server lifetime. The CLI generation command still runs directly. Authentication, request keys, operation limits, and interrupted-job recovery are documented in [API.md](API.md).
