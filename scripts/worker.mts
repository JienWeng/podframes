import {
  automationEvent,
  automationJobs,
  claimAutomation,
  ensureEnvLoaded,
  generateProject,
  Project,
  workerHeartbeat,
} from "../packages/core/src/index.ts";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const rootArgument = process.argv.indexOf("--root");
const root =
  rootArgument >= 0
    ? resolve(process.argv[rootArgument + 1])
    : resolve(import.meta.dirname, "..");
const once = process.argv.includes("--once");
ensureEnvLoaded(root);
let stopping = false;
let controller: AbortController | undefined;
process.on("SIGINT", () => {
  stopping = true;
  controller?.abort();
});
process.on("SIGTERM", () => {
  stopping = true;
  controller?.abort();
});
console.log("Podframes Mac worker ready. Jobs run one at a time.");
while (!stopping) {
  workerHeartbeat(root);
  const job = claimAutomation(root);
  if (!job) {
    if (once) break;
    await sleep(1000);
    continue;
  }
  controller = new AbortController();
  const activeController = controller;
  let persistenceFailure = false;
  const monitor = setInterval(() => {
    try {
      workerHeartbeat(root);
      if (automationJobs(root).find((item) => item.id === job.id)?.cancel)
        activeController.abort();
    } catch {
      persistenceFailure = true;
      activeController.abort();
    }
  }, 1000);
  try {
    const project = await Project.load(root, job.slug);
    if (!project) throw new Error("Project no longer exists.");
    const finished = await generateProject(project, {
      root,
      ...job.options,
      console: true,
      signal: activeController.signal,
      onEvent(event) {
        try {
          automationEvent(root, job.id, { type: "event", event });
        } catch {
          persistenceFailure = true;
          activeController.abort();
        }
      },
    });
    if (persistenceFailure)
      throw new Error(
        "Job persistence failed. Review provider jobs before retrying.",
      );
    const s = finished.state;
    automationEvent(root, job.id, {
      type: "done",
      done: {
        type: "done",
        slug: job.slug,
        title: s.script?.title ?? null,
        hook: s.script?.hook ?? null,
        turns: s.script?.turns ?? null,
        audioUrl: s.speech
          ? `/api/media/${job.slug}/${s.speech.audioPath}`
          : null,
        durationSec: s.output?.durationSec ?? s.speech?.durationSec ?? null,
        videoUrl: s.output
          ? `/api/media/${job.slug}/${s.output.videoPath}`
          : null,
        output: s.output ?? null,
        stages: Object.fromEntries(
          Object.entries(s.stages).map(([name, stage]) => [
            name,
            stage?.status ?? "pending",
          ]),
        ),
      },
    });
  } catch (error) {
    automationEvent(root, job.id, {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearInterval(monitor);
    controller = undefined;
  }
  if (once) break;
}
