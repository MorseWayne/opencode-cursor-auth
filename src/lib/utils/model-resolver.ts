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
  supportsStreaming?: boolean;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  /** Model family for grouping (e.g., "gpt", "claude", "gemini") */
  family?: string;
  /** Whether this is a reasoning/thinking model */
  isReasoningModel?: boolean;
}

const MODEL_ALIASES: Record<string, string> = {
  // GPT-4 family
  "gpt4": "gpt-4o",
  "gpt-4": "gpt-4o",
  "gpt4o": "gpt-4o",
  "gpt-4-turbo": "gpt-4o",
  "gpt-4o-latest": "gpt-4o",
  "4o": "gpt-4o",
  "4o-mini": "gpt-4o-mini",
  
  // GPT-5 family (future-proofing)
  "gpt5": "gpt-5",
  "gpt-5-turbo": "gpt-5",
  "5": "gpt-5",
  
  // Claude family
  "claude": "claude-sonnet-4",
  "claude-3": "claude-3.5-sonnet",
  "claude-4": "claude-sonnet-4",
  "claude-sonnet": "claude-sonnet-4",
  "claude-opus": "claude-opus-4",
  "claude-3.5": "claude-3.5-sonnet",
  "claude-3.5-sonnet-latest": "claude-3.5-sonnet",
  "sonnet": "claude-sonnet-4",
  "sonnet-4": "claude-sonnet-4",
  "sonnet-3.5": "claude-3.5-sonnet",
  "opus": "claude-opus-4",
  "opus-4": "claude-opus-4",
  "opus-3": "claude-3-opus",
  "haiku": "claude-3-haiku",
  "haiku-3": "claude-3-haiku",
  
  // OpenAI reasoning models
  "o1": "o1",
  "o1-mini": "o1-mini",
  "o1-preview": "o1-preview",
  "o3": "o3",
  "o3-mini": "o3-mini",
  "o4-mini": "o4-mini",
  
  // Gemini family
  "gemini": "gemini-2.5-pro",
  "gemini-pro": "gemini-2.5-pro",
  "gemini-flash": "gemini-2.0-flash",
  "gemini-1.5": "gemini-1.5-pro",
  "gemini-2.0": "gemini-2.0-flash",
  "gemini-2.5": "gemini-2.5-pro",
  "flash": "gemini-2.0-flash",
  "flash-2": "gemini-2.0-flash",
  
  // DeepSeek family
  "deepseek": "deepseek-v3",
  "deepseek-chat": "deepseek-v3",
  "deepseek-coder": "deepseek-coder",
  "deepseek-r1": "deepseek-r1",
  "r1": "deepseek-r1",
  
  // Mistral family
  "mistral": "mistral-large",
  "mistral-large": "mistral-large",
  "mixtral": "mixtral-8x22b",
  "codestral": "codestral",
  
  // Meta Llama family
  "llama": "llama-3.3-70b",
  "llama-3": "llama-3.3-70b",
  "llama-3.3": "llama-3.3-70b",
  "llama-70b": "llama-3.3-70b",
  
  // Grok family
  "grok": "grok-2",
  "grok-2": "grok-2",
  "grok-3": "grok-3",
  
  // Defaults
  "default": "gpt-4o",
  "auto": "gpt-4o",
};

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  // --- GPT-4 Family ---
  "gpt-4o": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 128000,
    maxOutputTokens: 16384,
    family: "gpt",
    isReasoningModel: false,
  },
  "gpt-4o-mini": {
    reasoningEffort: "low",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 128000,
    maxOutputTokens: 16384,
    family: "gpt",
    isReasoningModel: false,
  },
  
  // --- GPT-5 Family (future-proofing) ---
  "gpt-5": {
    reasoningEffort: "xhigh",
    reasoningSummary: "detailed",
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 256000,
    maxOutputTokens: 32768,
    family: "gpt",
    isReasoningModel: false,
  },
  
  // --- OpenAI Reasoning Models ---
  "o1": {
    reasoningEffort: "high",
    reasoningSummary: "detailed",
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: true,
    maxContextTokens: 128000,
    maxOutputTokens: 32768,
    family: "o-series",
    isReasoningModel: true,
  },
  "o1-mini": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: true,
    maxContextTokens: 128000,
    maxOutputTokens: 65536,
    family: "o-series",
    isReasoningModel: true,
  },
  "o1-preview": {
    reasoningEffort: "high",
    reasoningSummary: "detailed",
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: true,
    maxContextTokens: 128000,
    maxOutputTokens: 32768,
    family: "o-series",
    isReasoningModel: true,
  },
  "o3": {
    reasoningEffort: "xhigh",
    reasoningSummary: "detailed",
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 200000,
    maxOutputTokens: 100000,
    family: "o-series",
    isReasoningModel: true,
  },
  "o3-mini": {
    reasoningEffort: "high",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    maxContextTokens: 200000,
    maxOutputTokens: 65536,
    family: "o-series",
    isReasoningModel: true,
  },
  "o4-mini": {
    reasoningEffort: "high",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 200000,
    maxOutputTokens: 100000,
    family: "o-series",
    isReasoningModel: true,
  },
  
  // --- Claude 3.5 Family ---
  "claude-3.5-sonnet": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 200000,
    maxOutputTokens: 8192,
    family: "claude",
    isReasoningModel: false,
  },
  "claude-3-opus": {
    reasoningEffort: "high",
    reasoningSummary: "detailed",
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 200000,
    maxOutputTokens: 4096,
    family: "claude",
    isReasoningModel: false,
  },
  "claude-3-haiku": {
    reasoningEffort: "low",
    reasoningSummary: "concise",
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 200000,
    maxOutputTokens: 4096,
    family: "claude",
    isReasoningModel: false,
  },
  
  // --- Claude 4 Family ---
  "claude-sonnet-4": {
    reasoningEffort: "high",
    reasoningSummary: "detailed",
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 200000,
    maxOutputTokens: 16384,
    family: "claude",
    isReasoningModel: false,
  },
  "claude-opus-4": {
    reasoningEffort: "xhigh",
    reasoningSummary: "detailed",
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 200000,
    maxOutputTokens: 32768,
    family: "claude",
    isReasoningModel: false,
  },
  
  // --- Gemini Family ---
  "gemini-1.5-pro": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 1000000,
    maxOutputTokens: 8192,
    family: "gemini",
    isReasoningModel: false,
  },
  "gemini-1.5-flash": {
    reasoningEffort: "low",
    reasoningSummary: "concise",
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 1000000,
    maxOutputTokens: 8192,
    family: "gemini",
    isReasoningModel: false,
  },
  "gemini-2.0-flash": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 1000000,
    maxOutputTokens: 8192,
    family: "gemini",
    isReasoningModel: false,
  },
  "gemini-2.5-pro": {
    reasoningEffort: "high",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 2000000,
    maxOutputTokens: 65536,
    family: "gemini",
    isReasoningModel: true,
  },
  
  // --- DeepSeek Family ---
  "deepseek-v3": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    maxContextTokens: 64000,
    maxOutputTokens: 8192,
    family: "deepseek",
    isReasoningModel: false,
  },
  "deepseek-coder": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    maxContextTokens: 64000,
    maxOutputTokens: 8192,
    family: "deepseek",
    isReasoningModel: false,
  },
  "deepseek-r1": {
    reasoningEffort: "xhigh",
    reasoningSummary: "detailed",
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    maxContextTokens: 64000,
    maxOutputTokens: 65536,
    family: "deepseek",
    isReasoningModel: true,
  },
  
  // --- Mistral Family ---
  "mistral-large": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    maxContextTokens: 128000,
    maxOutputTokens: 8192,
    family: "mistral",
    isReasoningModel: false,
  },
  "mixtral-8x22b": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    maxContextTokens: 64000,
    maxOutputTokens: 8192,
    family: "mistral",
    isReasoningModel: false,
  },
  "codestral": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    maxContextTokens: 32000,
    maxOutputTokens: 8192,
    family: "mistral",
    isReasoningModel: false,
  },
  
  // --- Meta Llama Family ---
  "llama-3.3-70b": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    maxContextTokens: 128000,
    maxOutputTokens: 8192,
    family: "llama",
    isReasoningModel: false,
  },
  
  // --- Grok Family ---
  "grok-2": {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 128000,
    maxOutputTokens: 8192,
    family: "grok",
    isReasoningModel: false,
  },
  "grok-3": {
    reasoningEffort: "high",
    reasoningSummary: "detailed",
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 200000,
    maxOutputTokens: 16384,
    family: "grok",
    isReasoningModel: true,
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

export function getMaxOutputTokens(model: string): number {
  const config = getModelConfig(model);
  return config.maxOutputTokens ?? 8192;
}

export function supportsStreaming(model: string): boolean {
  const config = getModelConfig(model);
  return config.supportsStreaming ?? true;
}

export function isReasoningModel(model: string): boolean {
  const config = getModelConfig(model);
  return config.isReasoningModel ?? false;
}

export function getModelFamily(model: string): string {
  const config = getModelConfig(model);
  return config.family ?? "unknown";
}

/**
 * Get all available model aliases
 */
export function getModelAliases(): Record<string, string> {
  return { ...MODEL_ALIASES };
}

/**
 * Get all model configurations
 */
export function getAllModelConfigs(): Record<string, ModelConfig> {
  return { ...MODEL_CONFIGS };
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
