# Hosted studio with a Mac generation worker

The local implementation now has whole-app owner authentication, a versioned automation API with durable request receipts, a SQLite queue, persisted job events, generation-operation limits, and a separate Mac worker started with `pnpm worker`. The worker and web process currently share one local filesystem. Codex, Claude Code, OpenAI API, and Anthropic API writers are selectable. See [API.md](API.md).

The cloud architecture below remains a deployment proposal. Outbound cloud-to-Mac job transport, cloud asset synchronization, individual customer accounts, schedules, and a hosted automation hub still need implementation. The local worker separation alone does not enable the Railway layout below.

## Hosting choice

Use Railway for the Next.js web studio, a small automation API service, PostgreSQL, and private object storage. This keeps the online services in one hosting account. Use a generated Railway domain for the first private deployment, then attach a custom domain when selected. Railway supports Next.js, PostgreSQL, and S3-compatible buckets.

Official setup references

- https://railway.com/guides/nextjs
- https://docs.railway.com/databases/postgresql
- https://docs.railway.com/data-storage

## Responsibilities

| Component | Location | Owns |
| --- | --- | --- |
| Web studio | Railway | Library, editor, automation hub, signed-in user session, progress and downloads |
| Automation API | Railway | Authorized project operations, schedules, job queue, worker registration, durable events and artifact manifests |
| PostgreSQL | Railway private network | Project metadata, template versions, jobs, schedules, worker heartbeats, review state |
| Private object storage | Railway | Uploaded portraits, template images, generated audio, clips and finished exports |
| Generation worker | This Mac | Codex CLI, Fish MCP, HeyGen CLI, Whisper, ffmpeg, HyperFrames and local working files |

The API is a separate service from the frontend. It imports shared project contracts and validates requests. The Mac worker reuses the existing core pipeline. The browser talks to the online API through its authenticated web session. The worker polls the online API over outbound HTTPS with its own revocable credential.

The Mac retains its local Codex, Fish and HeyGen login state. The cloud API issues scoped job instructions and short-lived artifact upload/download URLs. It never receives copies of subscription sessions. The Mac needs to remain awake and connected for generation. The web app remains available while the worker is offline, and jobs remain queued.

## Job lifecycle

1. A signed-in creator chooses a saved template, topic or imported script, language, target duration, voice model for each host, video provider and billing mode.
2. The API saves an immutable input snapshot, including the exact template/portrait versions and script references. A client request key prevents duplicate submissions.
3. The worker atomically claims one eligible job. A lease and heartbeat identify ownership, and each state update carries the claim token.
4. The worker downloads required assets into its local project folder, then runs the existing pipeline. Progress events and provider job IDs are persisted before acknowledgement.
5. Completed artifacts are uploaded to private storage and their manifests committed before the job becomes complete.
6. The hub offers review and downloads. Schedules create jobs from saved configurations and hold completed videos for review.

Queued jobs survive app and API deployments. A lost worker lease during a paid stage enters a needs-review state. An interrupted job must reconcile saved provider job IDs and local stage state before an explicit resume. Retrying upload or status reporting must reuse the same artifacts and job identifiers. Cancellation is cooperative, and an active provider request may finish after cancellation is requested.

## Automation hub

The first hub should provide worker online/offline status, new-job creation from a template, queued/running/completed/failed/needs-review jobs, per-stage progress, review/download links, cancellation, and explicit resume. Recurring schedules include a timezone and a unique schedule-occurrence key, preventing duplicate episodes after scheduler restarts. Saved settings include each host's `fish/s2.1-pro` or `fish/drama-3` model.

## Configuration to prepare

These variable names describe the proposed deployment contract. They are not implemented application settings yet.

| Location | Proposed settings |
| --- | --- |
| Web studio | `AUTOMATION_API_URL`, server-to-server credential, login/session configuration |
| Automation API | `DATABASE_URL`, allowed studio origin, artifact bucket endpoint/name/credentials, session-verification settings, worker-token hashes |
| Mac worker | `AUTOMATION_API_URL`, revocable worker credential, worker ID, local working directory |

Store cloud settings in Railway service variables. Store the worker credential locally with restricted file permissions. Keep subscription authentication on the Mac through the existing CLI login commands. Run the worker as a macOS launch agent with a single active instance and restart-on-failure behavior. Machine restart and login expiration must appear as worker-offline or action-required states in the hub.

## Rollout sequence

1. Implement and locally exercise API/worker separation with fake generation and durable jobs.
2. Move project reads, writes, uploads and media serving away from frontend local disk, including character generation, delivery direction and voice previews.
3. Add signed-in access, worker authentication, storage synchronization and the automation hub. Verify light and dark themes and narrow layouts.
4. Create the Railway project and its services, database and bucket. Configure variables and database migrations. Run the API's scheduler as one elected process, protected by database locking.
5. Authenticate the Mac worker and connect it to the staging API. Import selected existing templates and check exact portrait and voice preservation.
6. Prove an import-only run, worker-offline queueing, deployment during a job, lease loss, duplicate submission, and artifact upload retry.
7. Run one explicitly authorized paid video, review its artifacts, then enable recurring schedules and attach a domain.

## Completion criteria

The online studio can create, edit and download an episode while generation runs in a separate Mac process. Restarting the web frontend does not terminate generation. Queued jobs survive API restarts. The hub reports the Mac offline accurately. Saved voice models reach both previews and full synthesis. Interrupted paid calls require reconciliation before resubmission.
