import { whisperStatus } from "./clients/whisper";
import { assertHeygenAuth } from "./clients/heygen";
import { fishStatus, validateFishSpeech } from "./clients/fish";
import { codexStatus } from "./clients/codex";
import { WritingClient, assertWritingReady } from "./clients/writing";
import { resolveEnv } from "./config";
import { clearStages } from "./editing";
import { optionInvalidations } from "./shared";
import { Project } from "./project";
import { validateConfig } from "./validate";
import { validateManualScript } from "./script-import";
import { applyShowTemplate } from "./show-template";
import { Reporter } from "./util/events";
import { ensureBinary } from "./util/proc";
import { slugForTopic, slugify } from "./util/fs";
import { beginRun, endRun, runLockFile, withProjectLock } from "./util/lock";
import { runScript } from "./stages/script";
import { runSpeech } from "./stages/speech";
import { runStills } from "./stages/stills";
import { runVideo } from "./stages/video";
import { runBroll } from "./stages/broll";
import { runCompose } from "./stages/compose";
import { runRender } from "./stages/render";
import type { StageContext } from "./stages/context";
import type { ConversationConfig, ProgressHandler, StageName, Script } from "./types";
import type { ResolvedEnv } from "./config";

type Needs = "codex" | "speech" | "none";

interface StageDef {
  name: StageName;
  run: (ctx: StageContext) => Promise<void>;
  needs: Needs;
}

export const STAGES: StageDef[] = [
  { name: "script", run: runScript, needs: "codex" },
  { name: "speech", run: runSpeech, needs: "speech" },
  { name: "stills", run: runStills, needs: "codex" },
  { name: "video", run: runVideo, needs: "codex" },
  { name: "broll", run: runBroll, needs: "codex" },
  { name: "compose", run: runCompose, needs: "none" },
  { name: "render", run: runRender, needs: "none" },
];

export const STAGE_NAMES = STAGES.map((s) => s.name);

export interface GenerateOptions {
  /** Imported dialogue: bypass drafting and run the remaining stages. */
  script?: Script;
  /** Seed a new episode with an existing project's portraits and image library. */
  template?: string;
  /** Repo root — where `projects/` lives and `.env.local` is read from. */
  root?: string;
  /** Override the auto-derived project slug. */
  slug?: string;
  /** Run from this stage onward (inclusive). */
  from?: StageName;
  /** Stop after this stage (inclusive). */
  to?: StageName;
  /** Run only these stages. */
  only?: StageName[];
  /** Force re-run: clears each selected stage's artifacts, then regenerates. */
  force?: boolean;
  onEvent?: ProgressHandler;
  /** Log to console (default true). */
  console?: boolean;
  /** Cooperative cancellation: checked between stages and inside worker pools. */
  signal?: AbortSignal;
  /** Animate only these turn indices in the video stage (see StageContext.onlyTurns). */
  onlyTurns?: number[];
}

function assertStageName(name: string, flag: string): asserts name is StageName {
  if (!STAGE_NAMES.includes(name as StageName)) {
    throw new Error(`unknown stage "${name}" for ${flag} (valid: ${STAGE_NAMES.join(" → ")})`);
  }
}

function selectStages(opts: GenerateOptions): StageDef[] {
  if (opts.only?.length) {
    for (const n of opts.only) assertStageName(n, "--only");
    const set = new Set(opts.only);
    return STAGES.filter((s) => set.has(s.name));
  }
  if (opts.from) assertStageName(opts.from, "--from");
  if (opts.to) assertStageName(opts.to, "--to");
  const fromIdx = opts.from ? STAGE_NAMES.indexOf(opts.from) : 0;
  const toIdx = opts.to ? STAGE_NAMES.indexOf(opts.to) : STAGES.length - 1;
  return STAGES.slice(fromIdx, toIdx + 1);
}

/**
 * Run the podframes pipeline for a config: create-or-resume the project, then
 * run the selected stages. Resumable: each stage skips itself if its artifact
 * already exists (unless `force`). Emits {@link PipelineEvent}s for the web UI.
 */
export async function generate(
  config: ConversationConfig,
  opts: GenerateOptions = {},
): Promise<Project> {
  validateConfig(config);
  if (opts.script) validateManualScript(opts.script, config.hosts);
  const root = opts.root ?? process.cwd();
  // Lock key MUST match the slug Project.open derives, so the pipeline and the
  // quick-edit routes coordinate on the exact same project. The on-disk lock
  // additionally refuses a run already live in ANOTHER process (CLI vs studio).
  const lockSlug = opts.slug ? slugify(opts.slug) : slugForTopic(config.topic);
  beginRun(lockSlug, runLockFile(root, lockSlug)); // refuses a second concurrent run for this project
  try {
    return await withProjectLock(lockSlug, async () => {
      // Option overrides on an EXISTING project invalidate downstream stages
      // exactly like the same edit made in the studio (optionInvalidations is
      // the shared map). Without this, `--treatment cinematic` on a finished
      // run persists the option, skips compose/render as "done", and silently
      // returns the old video. Compare BEFORE open() merges the overrides in.
      const prior = await Project.load(root, lockSlug).catch(() => null);
      if (opts.template && (!/^[a-z0-9][a-z0-9-]*$/i.test(opts.template) || opts.template === lockSlug)) throw new Error("Use an existing template slug and a different new episode slug.");
      if (opts.template && prior && prior.state.templateSource !== opts.template) throw new Error("This episode was not created from that template. Choose a new episode slug.");
      const template = opts.template && !prior ? await Project.load(root, opts.template) : null;
      if (opts.template && !prior && !template) throw new Error(`Template project not found: ${opts.template}`);
      const project = await Project.open(config, root, opts.slug);
      if (template) {
        try { await applyShowTemplate(project, template); }
        catch (error) { await Project.delete(root, project.slug); throw error; }
      }
      if (prior && config.options) {
        const stale = optionInvalidations(prior.state.options, config.options);
        if (stale.length) {
          await clearStages(project, stale);
          await project.save();
        }
      }
      return runPipeline(project, opts, root);
    }, root);
  } finally {
    endRun(lockSlug);
  }
}

/**
 * Run the selected stages on an ALREADY-LOADED project (see Project.load).
 * The persisted config/options are the source of truth — nothing is merged.
 * This is the entry the web routes use for re-runs and regeneration.
 */
export async function generateProject(project: Project, opts: GenerateOptions = {}): Promise<Project> {
  beginRun(project.slug, runLockFile(project.root, project.slug));
  try {
    return await withProjectLock(project.slug, () => runPipeline(project, opts, opts.root ?? project.root), project.root);
  } finally {
    endRun(project.slug);
  }
}

async function runPipeline(project: Project, opts: GenerateOptions, root: string): Promise<Project> {
  const reporter = new Reporter({ console: opts.console ?? true });
  if (opts.onEvent) reporter.on(opts.onEvent);
  const pipe = reporter.stage("pipeline");

  const env = resolveEnv(root);
  const selected = selectStages(opts).filter((stage) => !opts.script || stage.name !== "script");
  if (opts.script) {
    validateManualScript(opts.script, project.state.config.hosts);
    const previous = project.state.script;
    const content = (script: Script) => script.turns.map((turn) => [turn.hostId, turn.text, turn.performance]);
    if (!previous || JSON.stringify(content(previous)) !== JSON.stringify(content(opts.script))) {
      await clearStages(project, ["speech", "video", "broll", "compose", "render"]);
    } else if (previous.title !== opts.script.title || previous.hook !== opts.script.hook) {
      await clearStages(project, ["compose", "render"]);
    }
    project.state.script = structuredClone(opts.script);
    project.markDone("script");
    await project.save();
  }

  // Which selected stages will actually execute (done + artifact-present skip).
  const willRun = selected.filter(
    (s) => opts.force || !(project.stageDone(s.name) && stageArtifactPresent(project, s.name)),
  );

  // ── Preflight: fail BEFORE any spend ──
  // ffmpeg/ffprobe for the media stages, and every API key the executing stages
  // need. A missing FAL key must not surface only after script+speech+stills
  // were already paid for.
  const NEEDS_FFMPEG: ReadonlySet<StageName> = new Set(["speech", "video", "compose", "render"]);
  if (willRun.some((s) => NEEDS_FFMPEG.has(s.name))) {
    await ensureBinary("ffmpeg", "Install ffmpeg (macOS: `brew install ffmpeg`) and retry.");
    await ensureBinary("ffprobe", "ffprobe ships with ffmpeg (macOS: `brew install ffmpeg`).");
  }
  const missing = missingKeys(willRun.map((s) => s.name), project, env);
  if (missing.length) {
    throw new Error(
      `missing API key${missing.length > 1 ? "s" : ""} for the selected stages — add to .env.local:\n` +
        missing.map((m) => `  ${m.envVar}  (${m.reason})`).join("\n"),
    );
  }

  if (willRun.some((s) => s.name === "speech")) {
    if (!(await fishStatus())) throw new Error("Fish website login required: run `codex mcp add fish-audio --url https://api.fish.audio/mcp` then `codex mcp login fish-audio`.");
    if (!(await whisperStatus())) throw new Error("Local Whisper is required for captions: install whisper.cpp and its model (see README).");
    for (const host of project.state.config.hosts) {
      validateFishSpeech({ ...host, text: "preflight" });
    }
  }

  if (willRun.some((s) => s.name === "script")) await assertWritingReady(project.state.options.scriptModel);
  if (willRun.some((s) => s.name === "broll")) await assertWritingReady(project.state.options.cueModel);
  if (willRun.some((s) => ["speech", "stills", "broll"].includes(s.name)) && !(await codexStatus())) {
    throw new Error("Codex ChatGPT login required: install Codex CLI, then run `codex login`.");
  }
  if (willRun.some((s) => s.name === "video") && project.state.options.videoProvider === "heygen") {
    await assertHeygenAuth(project.state.options.heygenAuth ?? "subscription", env.heygenApiKey);
  }
  const codex = new WritingClient({ signal: opts.signal });
  const ctx: StageContext = { project, codex, env, reporter, signal: opts.signal, onlyTurns: opts.onlyTurns };

  pipe.info(
    `project "${project.slug}" · stages: ${selected.map((s) => s.name).join(" → ")}`,
    { dir: project.dir },
  );

  for (const stage of selected) {
    if (opts.signal?.aborted) throw new Error("run cancelled");
    if (!opts.force && project.stageDone(stage.name) && stageArtifactPresent(project, stage.name)) {
      pipe.info(`skip ${stage.name} (done)`);
      continue;
    }
    if (opts.force) {
      // Make force mean what the help says: the per-file caches (clips, stills,
      // cue images) would otherwise silently reuse everything.
      await clearStages(project, [stage.name]);
    }
    pipe.info(`▶ ${stage.name}`);
    project.markRunning(stage.name);
    await project.save();
    try {
      await stage.run(ctx);
    } catch (err) {
      project.markError(stage.name, err);
      // The error-path save must never mask the stage error itself (a concurrent
      // edit or fs failure here would otherwise replace it and strand "running").
      await project.save().catch((saveErr: unknown) => {
        pipe.warn(
          `could not persist error state: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`,
        );
      });
      reporter.stage(stage.name).error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  if (project.state.output) {
    pipe.success(`done → ${project.rel(project.abs(project.state.output.videoPath))}`);
  } else {
    pipe.success("done");
  }
  return project;
}

interface MissingKey {
  envVar: string;
  reason: string;
}

/** Every API key the given stages need under the project's options, that isn't set. */
export function missingKeys(
  stages: StageName[],
  project: Project,
  env: ResolvedEnv,
): MissingKey[] {
  const { options } = project.state;
  const out: MissingKey[] = [];
  if (stages.includes("video") && options.videoProvider === "heygen" && options.heygenAuth === "api" && !env.heygenApiKey) {
    out.push({ envVar: "HEYGEN_API_KEY", reason: "HeyGen API billing mode" });
  }
  if (stages.includes("video") && options.videoProvider === "fal-ltx" && !env.falApiKey) {
    out.push({ envVar: "FAL_API_KEY", reason: "the fal-ltx lip-sync video provider" });
  }
  if (stages.includes("video") && options.videoProvider === "replicate-p-video" && !env.replicateApiKey) {
    out.push({ envVar: "REPLICATE_API_KEY", reason: "the default replicate-p-video provider" });
  }
  return out;
}

function stageArtifactPresent(project: Project, name: StageName): boolean {
  const s = project.state;
  switch (name) {
    case "script":
      return !!s.script;
    case "speech":
      return !!s.speech;
    case "stills":
      return !!s.stills;
    case "video":
      return !!s.clips;
    case "broll":
      return !!s.broll;
    case "compose":
      return !!s.composition;
    case "render":
      return !!s.output;
  }
}
