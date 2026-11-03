import { randomUUID } from "node:crypto";
import { durableRead, durableUpdate, processAlive } from "./util/durable";
import type { GenerateOptions } from "./pipeline";
import type { PipelineEvent } from "./types";

export interface AutomationEvent {
  seq: number;
  type: "start" | "event" | "done" | "error";
  at: string;
  event?: PipelineEvent;
  message?: string;
  done?: unknown;
}
export interface AutomationJob {
  id: string;
  slug: string;
  status: "queued" | "running" | "done" | "error" | "interrupted";
  startedAt: string;
  options: Pick<
    GenerateOptions,
    "from" | "to" | "only" | "force" | "onlyTurns"
  >;
  events: AutomationEvent[];
  seq: number;
  pid?: number;
  cancel?: boolean;
  reviewRequired?: boolean;
}
type Queue = { jobs: AutomationJob[] };
const empty = (): Queue => ({ jobs: [] });
function emit(job: AutomationJob, event: Omit<AutomationEvent, "seq" | "at">) {
  job.events.push({ ...event, seq: job.seq++, at: new Date().toISOString() });
  if (job.events.length > 600) job.events.splice(0, job.events.length - 600);
}
function recover(queue: Queue) {
  for (const job of queue.jobs) {
    if (job.status === "running" && job.pid && !processAlive(job.pid)) {
      job.status = "interrupted";
      emit(job, {
        type: "error",
        message:
          "Worker stopped during generation. Check provider jobs and credits before explicitly acknowledging a retry. A remote request may have completed.",
      });
    }
  }
}
export function automationJobs(root: string): AutomationJob[] {
  return durableRead(root, "queue", empty).jobs;
}
export function enqueueAutomation(
  root: string,
  slug: string,
  options: AutomationJob["options"],
  acknowledgeInterrupted = false,
): AutomationJob {
  return durableUpdate(root, "queue", empty, (queue) => {
    recover(queue);
    const previous = queue.jobs.findLast((job) => job.slug === slug);
    if (previous && ["queued", "running"].includes(previous.status))
      throw new Error("A run is already queued or running for this project.");
    if (
      (previous?.status === "interrupted" || previous?.reviewRequired) &&
      !acknowledgeInterrupted
    )
      throw new Error(
        "Interrupted generation needs review. Check provider jobs and credits, then retry with acknowledgeInterrupted=true.",
      );
    const job: AutomationJob = {
      id: randomUUID(),
      slug,
      options,
      status: "queued",
      startedAt: new Date().toISOString(),
      events: [],
      seq: 0,
    };
    emit(job, { type: "start", message: "Queued for the Mac worker." });
    queue.jobs.push(job);
    return job;
  });
}
export function claimAutomation(root: string): AutomationJob | null {
  return durableUpdate(root, "queue", empty, (queue) => {
    recover(queue);
    if (queue.jobs.some((job) => job.status === "running")) return null;
    const job = queue.jobs.find((job) => job.status === "queued");
    if (!job) return null;
    job.status = "running";
    job.pid = process.pid;
    return job;
  });
}
export function automationEvent(
  root: string,
  id: string,
  event: Omit<AutomationEvent, "seq" | "at">,
): void {
  durableUpdate(root, "queue", empty, (queue) => {
    const job = queue.jobs.find((job) => job.id === id);
    if (!job || job.status !== "running" || job.pid !== process.pid)
      throw new Error("Worker no longer owns this job.");
    emit(job, event);
    if (event.type === "done") job.status = "done";
    if (event.type === "error") {
      job.status = "error";
      job.reviewRequired = true;
    }
  });
}
export function cancelAutomation(root: string, slug: string): boolean {
  return durableUpdate(root, "queue", empty, (queue) => {
    const job = queue.jobs.findLast((job) => job.slug === slug);
    if (!job || !["queued", "running"].includes(job.status)) return false;
    job.cancel = true;
    if (job.status === "queued") {
      job.status = "error";
      emit(job, { type: "error", message: "Cancelled before generation." });
    }
    return true;
  });
}
export function workerHeartbeat(root: string): void {
  durableUpdate(
    root,
    "worker",
    () => ({ at: "" }),
    (worker) => {
      worker.at = new Date().toISOString();
    },
  );
}
export function workerOnline(root: string): boolean {
  const worker = durableRead(root, "worker", () => ({ at: "" }));
  return Date.now() - Date.parse(worker.at) < 15_000;
}
