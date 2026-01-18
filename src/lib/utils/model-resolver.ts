/**
 * Model Resolver and Normalizer
 *
 * Provides intelligent model name resolution with:
 * - Explicit model mapping for known models
 * - Pattern-based fallback matching
 * - Provider prefix handling (e.g., "openai/gpt-4o" -> "gpt-4o")
 * - Reasoning configuration per model
 */

import type { CursorModelInfo } from "../api/cursor-models";

export interface ReasoningConfig {
  effort: "none" | "low" | "medium" | "high" | "xhigh";
  summary: "auto" | "concise" | "detailed";
}

export interface ModelConfig {
  reasoningEffort?: ReasoningConfig["effort"];
  reasoningSummary?: ReasoningConfig["summary"];
  textVerbosity?: "low" | "medium" | "high";
  supportsTools?: boolean;
  supportsVision?: boolean;
  maxContextTokens?: number;
}

const MODEL_ALIASES: Record<string, string> = {
  "gpt4": "gpt-4o",
  "gpt-4": "gpt-4o",
  "gpt4o": "gpt-4o",
  "gpt-4-turbo": "gpt-4o",
  "claude": "claude-3.5-sonnet",
  "claude-3": "claude-3.5-sonnet",
  "claude-sonnet": "claude-3.5-sonnet",
  "claude-opus": "claude-3-opus",
  "sonnet": "claude-3.5-sonnet",
  "opus": "claude-3-opus",
  "haiku": "claude-3-haiku",
  "gemini": "gemini-1.5-pro",
  "gemini-pro": "gemini-1.5-pro",
  "gemini-flash": "gemini-1.5-flash",
  "o1": "o1",
  "o1-mini": "o1-mini",
  "o1-preview": "o1-preview",
  "o3": "o3",
  "o3-mini": "o3-mini",
  "deepseek": "deepseek-v3",
  "deepseek-chat": "deepseek-v3",
  "deepseek-coder": "deepseek-coder",
  "default": "gpt-4o",
  "auto": "gpt-4o",
};

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  "gpt-4o": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: true,
    maxContextTokens: 128000,
  },
  "gpt-4o-mini": {
    reasoningEffort: "low",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: true,
    maxContextTokens: 128000,
  },
  "o1": {
    reasoningEffort: "high",
    reasoningSummary: "detailed",
    supportsTools: false,
    supportsVision: false,
    maxContextTokens: 128000,
  },
  "o1-mini": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: false,
    supportsVision: false,
    maxContextTokens: 128000,
  },
  "o1-preview": {
    reasoningEffort: "high",
    reasoningSummary: "detailed",
    supportsTools: false,
    supportsVision: false,
    maxContextTokens: 128000,
  },
  "o3": {
    reasoningEffort: "xhigh",
    reasoningSummary: "detailed",
    supportsTools: true,
    supportsVision: true,
    maxContextTokens: 200000,
  },
  "o3-mini": {
    reasoningEffort: "high",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: false,
    maxContextTokens: 200000,
  },
  "claude-3.5-sonnet": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: true,
    maxContextTokens: 200000,
  },
  "claude-3-opus": {
    reasoningEffort: "high",
    reasoningSummary: "detailed",
    supportsTools: true,
    supportsVision: true,
    maxContextTokens: 200000,
  },
  "claude-3-haiku": {
    reasoningEffort: "low",
    reasoningSummary: "concise",
    supportsTools: true,
    supportsVision: true,
    maxContextTokens: 200000,
  },
  "gemini-1.5-pro": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: true,
    maxContextTokens: 1000000,
  },
  "gemini-1.5-flash": {
    reasoningEffort: "low",
    reasoningSummary: "concise",
    supportsTools: true,
    supportsVision: true,
    maxContextTokens: 1000000,
  },
  "gemini-2.0-flash": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: true,
    maxContextTokens: 1000000,
  },
  "deepseek-v3": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: false,
    maxContextTokens: 64000,
  },
  "deepseek-coder": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: false,
    maxContextTokens: 64000,
  },
};

export function stripProviderPrefix(model: string): string {
  if (model.includes("/")) {
    return model.split("/").pop() ?? model;
  }
  return model;
}

export function normalizeModelName(model: string | undefined): string {
  if (!model) return "gpt-4o";

  const stripped = stripProviderPrefix(model);
  const lower = stripped.toLowerCase();

  if (MODEL_ALIASES[lower]) {
    return MODEL_ALIASES[lower];
  }

  if (MODEL_ALIASES[stripped]) {
    return MODEL_ALIASES[stripped];
  }

  return stripped;
}

export function resolveModel(
  requestedModel: string,
  availableModels: CursorModelInfo[]
): string {
  const normalized = normalizeModelName(requestedModel);

  const directMatch = availableModels.find(
    (m) => m.modelId === normalized || m.displayModelId === normalized
  );
  if (directMatch) {
    return directMatch.modelId;
  }

  const aliasMatch = availableModels.find((m) =>
    m.aliases.includes(normalized)
  );
  if (aliasMatch) {
    return aliasMatch.modelId;
  }

  const partialMatch = availableModels.find(
    (m) =>
      m.modelId.includes(normalized) ||
      (m.displayModelId && m.displayModelId.includes(normalized))
  );
  if (partialMatch) {
    return partialMatch.modelId;
  }

  return normalized;
}

export function getModelConfig(model: string): ModelConfig {
  const normalized = normalizeModelName(model);
  return MODEL_CONFIGS[normalized] ?? {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: false,
    maxContextTokens: 128000,
  };
}

export function getReasoningConfig(
  model: string,
  overrides?: Partial<ReasoningConfig>
): ReasoningConfig {
  const config = getModelConfig(model);
  return {
    effort: overrides?.effort ?? config.reasoningEffort ?? "medium",
    summary: overrides?.summary ?? config.reasoningSummary ?? "auto",
  };
}

export function supportsToolCalling(model: string): boolean {
  const config = getModelConfig(model);
  return config.supportsTools ?? true;
}

export function supportsVision(model: string): boolean {
  const config = getModelConfig(model);
  return config.supportsVision ?? false;
}

export function getMaxContextTokens(model: string): number {
  const config = getModelConfig(model);
  return config.maxContextTokens ?? 128000;
}

export function getModelOwner(modelName: string): string {
  const lower = modelName.toLowerCase();
  if (lower.includes("gpt") || lower.includes("o1") || lower.includes("o3")) {
    return "openai";
  }
  if (lower.includes("claude")) {
    return "anthropic";
  }
  if (lower.includes("gemini")) {
    return "google";
  }
  if (lower.includes("deepseek")) {
    return "deepseek";
  }
  if (lower.includes("mistral") || lower.includes("mixtral")) {
    return "mistral";
  }
  if (lower.includes("llama")) {
    return "meta";
  }
  return "cursor";
}
