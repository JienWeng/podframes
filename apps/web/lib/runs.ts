import {
  automationJobs,
  enqueueAutomation,
  cancelAutomation,
  isRunActive,
  runLockFile,
  Project,
  withProjectLock,
  STAGE_NAMES,
  ensureEnvLoaded,
  type PipelineEvent,
  type StageName,
} from "@podframes/core";
import { findRepoRoot } from "@/lib/root";

export interface RunEvent {
  seq: number;
  type: "start" | "event" | "done" | "error";
  event?: PipelineEvent;
  message?: string;
  done?: DonePayload;
  at: string;
}

export interface DonePayload {
  type: "done";
  slug: string;
  title: string | null;
  hook: string | null;
  turns: unknown;
  audioUrl: string | null;
  durationSec: number | null;
  videoUrl: string | null;
  output: unknown;
  stages: Record<string, string>;
}

export interface RunRecord {
  id: string;
  slug: string;
  status: "running" | "done" | "error";
  startedAt: string;
  events: RunEvent[];
  listeners: Set<(e: RunEvent) => void>;
  controller: AbortController;
  seq: number;
}

export function getRun(slug: string, id?: string): RunRecord | undefined {
  const job = automationJobs(findRepoRoot()).findLast(
    (job) => job.slug === slug && (!id || job.id === id),
  );
  if (!job) return undefined;
  return {
    id: job.id,
    slug,
    status:
      job.status === "queued" || job.status === "running"
        ? "running"
        : job.status === "done"
          ? "done"
          : "error",
    startedAt: job.startedAt,
    events: job.events as RunEvent[],
    seq: job.seq,
    listeners: new Set(),
    controller: new AbortController(),
  };
}
export const isRunActiveWeb = (slug: string): boolean =>
  getRun(slug)?.status === "running";
export const isRunActiveAnywhere = (slug: string): boolean =>
  isRunActiveWeb(slug) || isRunActive(slug, runLockFile(findRepoRoot(), slug));
export interface StartRunOptions {
  from?: StageName;
  to?: StageName;
  only?: StageName[];
  force?: boolean;
  onlyTurns?: number[];
  acknowledgeInterrupted?: boolean;
}
export interface StartResult {
  ok: boolean;
  status: number;
  message?: string;
}
export async function startRun(
  slug: string,
  opts: StartRunOptions,
): Promise<StartResult> {
  try {
    return await withProjectLock(
      slug,
      () => reserveRun(slug, opts),
      findRepoRoot(),
    );
  } catch (error) {
    return {
      ok: false,
      status: 503,
      message: error instanceof Error ? error.message : "Queue unavailable",
    };
  }
}
async function reserveRun(
  slug: string,
  opts: StartRunOptions,
): Promise<StartResult> {
  if (isRunActiveAnywhere(slug))
    return {
      ok: false,
      status: 409,
      message: "A run is already queued or running for this project.",
    };
  const root = findRepoRoot();
  ensureEnvLoaded(root);
  const project = await Project.load(root, slug);
  if (!project)
    return { ok: false, status: 404, message: "Project not found." };
  const maxDuration = Number(process.env.PODFRAMES_MAX_EPISODE_SECONDS ?? 180);
  if (!Number.isSafeInteger(maxDuration) || maxDuration < 1)
    return {
      ok: false,
      status: 503,
      message: "Configure PODFRAMES_MAX_EPISODE_SECONDS as a positive integer.",
    };
  if (
    (project.state.config.targetDurationSec ?? 60) > maxDuration ||
    (project.state.script?.turns.length ?? 0) > 120 ||
    (project.state.script?.turns.reduce((n, turn) => n + turn.text.length, 0) ??
      0) > 15000
  )
    return {
      ok: false,
      status: 400,
      message: `Episode exceeds the generation safety limits. Maximum target duration is ${maxDuration}s, 120 turns and 15,000 script characters.`,
    };
  const stages = [
    opts.from,
    opts.to,
    ...(Array.isArray(opts.only) ? opts.only : []),
  ].filter((stage) => stage !== undefined);
  if (
    stages.some((stage) => !STAGE_NAMES.includes(stage as StageName)) ||
    (opts.only !== undefined &&
      (!Array.isArray(opts.only) || !opts.only.length)) ||
    (opts.force !== undefined && typeof opts.force !== "boolean") ||
    (opts.acknowledgeInterrupted !== undefined &&
      typeof opts.acknowledgeInterrupted !== "boolean") ||
    (opts.onlyTurns !== undefined &&
      (!Array.isArray(opts.onlyTurns) ||
        opts.onlyTurns.some((n) => !Number.isSafeInteger(n) || n < 0)))
  )
    return { ok: false, status: 400, message: "Invalid generation options." };
  if (
    opts.from &&
    opts.to &&
    STAGE_NAMES.indexOf(opts.from) > STAGE_NAMES.indexOf(opts.to)
  )
    return {
      ok: false,
      status: 400,
      message: "The starting stage must precede the ending stage.",
    };
  try {
    const { acknowledgeInterrupted, ...options } = opts;
    enqueueAutomation(root, slug, options, acknowledgeInterrupted);
    return { ok: true, status: 202 };
  } catch (error) {
    return {
      ok: false,
      status: 409,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
export const cancelRun = (slug: string): boolean =>
  cancelAutomation(findRepoRoot(), slug);
