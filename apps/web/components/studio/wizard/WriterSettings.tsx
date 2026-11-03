"use client";

import { useEffect, useState } from "react";
import { useDraft } from "@/components/studio/useDraft";
import { useWizard } from "./context";
import { inputClass } from "./ui";

const providers = [
  {
    id: "codex",
    label: "Codex · ChatGPT subscription",
    hint: "Uses the local Codex login. Default model follows PODFRAMES_CODEX_MODEL.",
    defaultModel: "codex-local",
  },
  {
    id: "claude-code",
    label: "Claude Code · Claude subscription",
    hint: "Uses the local Claude subscription login. Run claude auth login if disconnected.",
    defaultModel: "claude-code/sonnet",
  },
  {
    id: "openai",
    label: "OpenAI API · API billing",
    hint: "Set OPENAI_API_KEY in the server's .env. Choose a model that supports structured output and web search.",
    defaultModel: "openai/",
  },
  {
    id: "anthropic",
    label: "Anthropic API · API billing",
    hint: "Set ANTHROPIC_API_KEY in the server's .env. Choose a model that supports structured output, web search, and web fetch.",
    defaultModel: "anthropic/",
  },
];

export function WriterSettings() {
  const ctx = useWizard();
  const current = ctx.project?.options.scriptModel ?? "codex-local";
  const [draft, setDraft] = useDraft(current, current);
  const [health, setHealth] = useState<Record<string, boolean> | null>(null);
  const [notice, setNotice] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const providerId = draft.includes("/") ? draft.split("/")[0] : "codex";
  const provider =
    providers.find((provider) => provider.id === providerId) ?? providers[0];
  const model = draft.includes("/")
    ? draft.slice(draft.indexOf("/") + 1)
    : draft;
  const valid =
    providerId === "codex"
      ? !!model.trim()
      : /^[a-z0-9][\w.:-]{0,127}$/i.test(model);
  const disabled = ctx.locked || ctx.busy;
  const connected =
    health?.[providerId === "claude-code" ? "claude" : providerId];

  useEffect(() => {
    let active = true;
    fetch("/api/health")
      .then((response) => (response.ok ? response.json() : null))
      .then((health) => {
        if (active) setHealth(health);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    if (await ctx.patch({ options: { scriptModel: draft, cueModel: draft } }))
      setNotice(
        "Writing settings saved. Used for the next draft, delivery pass, and supporting-visual plan.",
      );
  }
  async function checkConnection() {
    setChecking(true);
    setModels([]);
    try {
      const response = await fetch(
        `/api/writing-models?provider=${encodeURIComponent(providerId)}`,
      );
      const result = await response.json();
      setModels(result.models ?? []);
      setNotice(result.message);
    } catch {
      setNotice("Connection check unavailable. Try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <section
      className="mb-5 space-y-3 border-b border-[var(--color-hairline)] pb-5"
      aria-label="Writing provider settings"
    >
      <h3 className="text-sm font-semibold">Writing &amp; research</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium">
          Provider
          <select
            value={provider.id}
            disabled={disabled}
            onChange={(event) => {
              setDraft(
                providers.find(
                  (provider) => provider.id === event.target.value,
                )!.defaultModel,
              );
              setNotice("");
              setModels([]);
            }}
            className={`${inputClass} mt-1`}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium">
          Model
          <input
            list="writing-model-catalog"
            value={model}
            maxLength={128}
            disabled={disabled}
            placeholder={
              providerId === "claude-code" ? "sonnet" : "Enter the model ID"
            }
            onChange={(event) => {
              setDraft(
                providerId === "codex"
                  ? event.target.value === "codex-local"
                    ? "codex-local"
                    : `codex/${event.target.value}`
                  : `${providerId}/${event.target.value}`,
              );
              setNotice("");
            }}
            className={`${inputClass} mt-1`}
          />
          <datalist id="writing-model-catalog">
            {models.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </label>
      </div>
      <button
        type="button"
        disabled={disabled || checking}
        onClick={checkConnection}
        className="text-xs font-semibold underline underline-offset-4 disabled:opacity-50"
      >
        {checking ? "Checking connection…" : "Check connection & load models"}
      </button>
      <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
        {provider.hint}
      </p>
      {health && (
        <p
          className={`text-xs ${connected ? "text-[var(--color-success)]" : "text-[var(--color-warn)]"}`}
        >
          {connected
            ? providerId === "openai" || providerId === "anthropic"
              ? "API key configured. Model access is checked when writing."
              : "Subscription login connected."
            : "Connection needs setup on the server."}
        </p>
      )}
      <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
        Image generation and Fish website-credit speech use the local Codex
        connection.
      </p>
      <button
        onClick={() => void save()}
        disabled={disabled || !valid || draft === current}
        className="btn btn-ghost px-4 py-2 text-xs disabled:opacity-50"
      >
        Save writing settings
      </button>
      {notice && (
        <p role="status" className="text-xs text-[var(--color-text-secondary)]">
          {notice}
        </p>
      )}
    </section>
  );
}
