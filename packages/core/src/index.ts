/**
 * @podframes/core — topic → animated AI podcast video.
 *
 * Pipeline: script (local Codex) → speech (Fish Audio + word timestamps) →
 * stills/base avatars → video (P-Video Avatar, LTX, or HeyGen) → b-roll (Codex) →
 * compose (HyperFrames HTML) → render (MP4).
 */

export { generate, generateProject, missingKeys, STAGES, STAGE_NAMES } from "./pipeline";
export type { GenerateOptions } from "./pipeline";

export { Project } from "./project";
export { slugify, slugForTopic, contentHash } from "./util/fs";
export { validateConfig, validateOptions } from "./validate";
export {
  DEFAULT_OPTIONS,
  DEFAULT_HOSTS,
  MODELS,
  mergeOptions,
  resolveEnv,
  ensureEnvLoaded,
} from "./config";
export type { ResolvedEnv } from "./config";

// Pure constants shared with the browser — also importable directly (without
// the node-only pipeline) via "@podframes/core/shared".
export {
  SCHEMA_VERSION,
  BRAND,
  PROVIDER_COLORS,
  PROVIDER_COLOR_FALLBACK,
  providerColor,
  CAPTION_STYLE_PRESETS,
  VISUAL_TREATMENTS,
  visualTreatmentPreset,
  TREATMENT_INTRO,
  optionInvalidations,
  CANVAS,
  VIDEO_PROVIDERS,
} from "./shared";
export type { VideoProviderId } from "./shared";

export { providerOf } from "./types";
export type {
  AspectRatio,
  VisualTreatment,
  CaptionStyle,
  ProviderId,
  Host,
  ConversationConfig,
  PipelineOptions,
  Script,
  ScriptTurn,
  Performance,
  WordTs,
  TurnRegion,
  SpeechArtifact,
  AvatarImagesArtifact,
  HostAvatarImage,
  ClipAsset,
  ClipLibrary,
  Cue,
  CueType,
  BrollPlan,
  CompositionArtifact,
  OutputArtifact,
  StageName,
  StageRecord,
  ProjectState,
  PipelineEvent,
  ClipProgress,
  ProgressHandler,
} from "./types";

export { buildCaptionGroups } from "./compose/captions";
export type { CaptionGroup } from "./compose/captions";

// Editing helpers (web studio: invalidate stages after an edit)
export { clearStages, clearTurnClips, clearSpeechTurns, STAGE_ARTIFACTS, INVALIDATION } from "./editing";

// Per-project write coordination (prevents concurrent edits/runs from corrupting project.json)
export { withProjectLock, isProjectBusy, isRunActive, runLockFile } from "./util/lock";
export { brollImagePrompt, brollImagePath, brollImageGeometry } from "./stages/broll";
export { castHost, avatarPrompt } from "./stages/stills";
export { applyShowTemplate } from "./show-template";
export { directScriptDelivery } from "./delivery";
export { loadScriptExamples } from "./script-library";

// Performance direction (inline audio tags + ElevenLabs stability)
export { compilePerformance, isAudioTagWord } from "./performance";

// Clients (for advanced / direct usage)
export { heygenStatus, assertHeygenAuth } from "./clients/heygen";
export { CodexClient, codexStatus } from "./clients/codex";
export { whisperStatus } from "./clients/whisper";
export { synthesizeOne, synthesizeTurn, fishStatus } from "./clients/fish";

export { WritingClient, writingModel, claudeStatus, assertWritingReady } from "./clients/writing";
export type { GenerationClient } from "./clients/writing";
export { automationJobs, enqueueAutomation, claimAutomation, automationEvent, cancelAutomation, workerHeartbeat, workerOnline } from "./automation";
export type { AutomationJob, AutomationEvent } from "./automation";
export { durableRead, durableUpdate } from "./util/durable";
