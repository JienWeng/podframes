# Writing connections and the Podframes automation API

## Writing providers

In Studio, open Script, then Episode brief & generation settings, then Writing & research. Choose a provider, enter the model ID, and save the writing settings. The selection applies to future drafting, delivery direction, and supporting-visual planning. Saved scripts are rewritten only through the existing rewrite action.

| Connection | Model setting | Authentication |
| --- | --- | --- |
| Codex local | `codex-local` or `codex/<model>` | Local ChatGPT login through `codex login` |
| Claude Code local | `claude-code/sonnet`, `claude-code/opus`, or another accessible Claude model | Local Claude subscription through `claude auth login` |
| OpenAI API | `openai/<model-id>` | `OPENAI_API_KEY` in the server environment |
| Anthropic API | `anthropic/<model-id>` | `ANTHROPIC_API_KEY` in the server environment |

API model IDs must be available to the configured account and support structured outputs and the required web tools. OpenAI research uses Responses API web search and page opens. Anthropic research uses Messages API web search and web fetch. The adapter rejects a researched script if its source URLs lack successful page retrieval evidence. Research and writing can incur model and search charges on API connections. Failed requests never switch to another provider or billing source automatically.

Claude Code runs in a temporary directory with customizations disabled, an explicit web-tool allowlist for research, and no shell or file tools. API credentials are removed from its child environment. Local mode requires Claude subscription authentication rather than API-key authentication. Claude CLI must support the flags documented in its current `--help`, including `--safe-mode`, `--json-schema`, and `--permission-mode dontAsk`.

Image generation and Fish website-credit speech continue through the existing Codex subscription connection. The full video pipeline therefore still needs Codex even when another writer is selected. The script-only stage can use Claude Code or an API writer independently of a Codex login. Claude Code itself does not provide the image-generation tool used by this pipeline.

Keys belong in the repository's ignored `.env` or `.env.local`, or in the hosting service's environment settings. Restart the server after changing keys. The UI reports whether each connection is configured. Its “Check connection & load models” action verifies the subscription login or live API model catalog without generating content. Model tool support and generation allowance still need a successful draft. API keys are excluded from project and template files.

CLI examples

```sh
pnpm podframes generate --topic "Your topic" --writer claude-code/sonnet --only script
pnpm podframes generate --topic "Your topic" --writer 'openai/<model-id>' --only script
pnpm podframes generate --topic "Your topic" --writer 'anthropic/<model-id>' --only script
```

`--cue-writer <provider/model>` optionally chooses a separate supporting-visual planner. The normal `--writer` flag sets both writing models. JSON configuration can set `options.scriptModel` and `options.cueModel` separately. Series and show templates retain these settings.

## Enable external API access

Set `PODFRAMES_API_TOKEN` on the server to a random value of at least 32 characters. A suitable value can be generated locally with `openssl rand -hex 32`. Keep it secret and supply it through an HTTP Authorization header. Restart the server after configuration.

The versioned API is disabled with HTTP 503 until a suitable token is configured. Missing or incorrect credentials return HTTP 401. Each caller with the token has access to the supported project, library, generation, and media operations.

```sh
curl -H "Authorization: Bearer $PODFRAMES_API_TOKEN" \
  http://localhost:3000/api/v1/library
```

The token protects the whole application, including Studio pages, original UI APIs, and media. Browser access uses the username `podframes` and the token as the password. API callers use Bearer authentication. Cross-site browser mutations are rejected. Use HTTPS for access beyond this Mac. This is one owner workspace. Separate deployments and storage are required for separate owners. Sharing the owner token shares all projects and billing access.

Without a token, requests fail closed with HTTP 503. `pnpm dev:web` explicitly enables loopback-only development and binds Next to `127.0.0.1`. Manual local production testing requires `PODFRAMES_LOCAL_ONLY=true` plus a loopback bind. Never enable local-only mode behind a public reverse proxy. A configured token always takes precedence.

Every POST to `/api/v1/` requires an `Idempotency-Key` with 16–128 letters, digits, dots, underscores or hyphens. Reuse the exact key and body when retrying the same operation. A completed request replays its saved response. Changed content returns 409. Pending or interrupted requests return 409 until the caller inspects the saved project/provider state. Only a deliberate new operation should get a new key. Receipts persist in `.automation/state.sqlite`.

## Endpoints

| Method | Path under `/api/v1` | Purpose |
| --- | --- | --- |
| GET | `/health` | Connection configuration, worker heartbeat and local tool status |
| GET | `/writing-models?provider=openai` | Verify credentials and load the live model catalog without generation |
| GET, POST | `/projects` | List videos or create from config/template |
| GET, PATCH, DELETE | `/projects/{slug}` | Read, edit, or delete one video |
| POST | `/generate` | Start the existing pipeline and return HTTP 202 |
| GET | `/projects/{slug}/run` | Server-sent progress events |
| DELETE | `/projects/{slug}/run` | Request cooperative cancellation |
| POST | `/projects/{slug}/cast` | Upload/generate a portrait or apply a saved cast member |
| POST | `/projects/{slug}/script/delivery` | Propose delivery cues |
| POST | `/voice-preview` | Generate a voice preview using provider credits |
| GET, POST | `/library` | Read Cast/Series, save a host, create a series, or start an episode |
| GET | `/library/cast/{id}/portrait` | Read a saved portrait |
| GET | `/media/{slug}/{path}` | Download project media, including byte-range requests |

Operations reuse the same validation, cross-process project locks, generation cache, and billing settings as Studio. The HTTP API remains in Next.js. Full pipeline generation is queued in SQLite and executed by the separate Mac worker. Start it from the repository root with `pnpm worker`. Node 22.13 or newer is required. Queued jobs and the most recent 600 events per job survive web-server restarts. One pipeline job runs at a time. The worker must share this local repository and filesystem with the web process. Cloud-to-Mac transport and asset synchronization remain in the deployment proposal.

A worker crash marks its active job interrupted on the next worker claim. Queued jobs remain available. No interrupted paid job is automatically retried. Check provider jobs and credits first, then submit an explicit new generation operation with `acknowledgeInterrupted: true`. Studio shows a confirmation for this action. Failed worker jobs also require this acknowledgement because a remote call may have completed before its error reached this Mac. Cancellation is cooperative and cannot reverse completed provider charges.

The whole-app request gate allows 30 generation-related POST operations per UTC day by default, including previews, delivery direction, and portrait/image actions. `PODFRAMES_DAILY_GENERATION_LIMIT` overrides this positive integer. Failed attempts and uploads through these routes also count. Replays with the same request key do not consume another operation. Pipeline admission defaults to a 180-second target-duration ceiling, 120 script turns, and 15,000 script characters. `PODFRAMES_MAX_EPISODE_SECONDS` overrides the duration ceiling. These are operation/input limits. Actual provider spend and elapsed output length depend on the selected services, so configure provider billing caps for a dollar limit. CLI generation is outside the HTTP request budget.

## Example automation flow

Use the same Authorization header on every request. Include a unique `Idempotency-Key` for each POST operation, and retain it for retries. The following JSON bodies show the sequence without executing generation.

1. Read `GET /api/v1/library` and choose a series ID.
2. Create an episode with `POST /api/v1/library` and retain its returned `slug`.

```json
{"kind":"episode","seriesId":"<saved-series-id>"}
```

3. Set topic, duration and writer using `PATCH /api/v1/projects/{slug}`.

```json
{
  "config": {"topic":"Your researched episode topic","targetDurationSec":60,"language":"zh"},
  "options": {"scriptModel":"claude-code/sonnet","cueModel":"claude-code/sonnet"}
}
```

4. Start research/drafting with `POST /api/v1/generate`.

```json
{"slug":"<returned-slug>","to":"script"}
```

5. Follow `GET /api/v1/projects/{slug}/run` using an SSE client. Read the finished script with `GET /api/v1/projects/{slug}` and review it.
6. Generate the full video with the same POST endpoint and `{"slug":"<returned-slug>","to":"render"}`. This uses Fish and the selected video provider's credits.
7. Download the output. Returned media links use Studio-relative `/api/media/...` URLs. For token-protected downloads, use the corresponding `/api/v1/media/...` URL and include the Authorization header. Saved-portrait URLs can be rebased to `/api/v1/library/cast/{id}/portrait` in the same way.

Project creation returns a fresh slug for every new idempotency key. Replaying a completed request key returns the original response. Save the slug before proceeding, and look up existing state after a connection failure before submitting another create request. A run already active for that slug returns HTTP 409. Completed media is reused on ordinary resumes. Explicit `force` requests and edits can invalidate generated artifacts and spend fresh credits. An uncertain remote generation outcome needs provider-job reconciliation before a retry.

## Model-catalog references

The connection check follows the provider model-list endpoints. [OpenAI model list](https://developers.openai.com/api/reference/resources/models/methods/list) and [Anthropic model list](https://platform.claude.com/docs/en/api/models/list).
