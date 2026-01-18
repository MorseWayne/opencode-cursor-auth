/**
 * Model Presets Unit Tests
 *
 * Tests for the enhanced model configuration and resolution:
 * - Model aliases
 * - Model capabilities
 * - Reasoning configuration
 */

import { describe, expect, test } from "bun:test";
import {
  normalizeModelName,
  resolveModel,
  getModelConfig,
  getReasoningConfig,
  supportsToolCalling,
  supportsVision,
  supportsStreaming,
  isReasoningModel,
  getMaxContextTokens,
  getMaxOutputTokens,
  getModelFamily,
  getModelOwner,
  getModelAliases,
  getAllModelConfigs,
} from "../../src/lib/utils/model-resolver";

describe("normalizeModelName", () => {
  test("returns default for undefined", () => {
    expect(normalizeModelName(undefined)).toBe("gpt-4o");
  });

  test("normalizes GPT aliases", () => {
    expect(normalizeModelName("gpt4")).toBe("gpt-4o");
    expect(normalizeModelName("gpt-4")).toBe("gpt-4o");
    expect(normalizeModelName("4o")).toBe("gpt-4o");
  });

  test("normalizes Claude aliases", () => {
    expect(normalizeModelName("claude")).toBe("claude-sonnet-4");
    expect(normalizeModelName("sonnet")).toBe("claude-sonnet-4");
    expect(normalizeModelName("sonnet-4")).toBe("claude-sonnet-4");
    expect(normalizeModelName("opus")).toBe("claude-opus-4");
  });

  test("normalizes Gemini aliases", () => {
    expect(normalizeModelName("gemini")).toBe("gemini-2.5-pro");
    expect(normalizeModelName("flash")).toBe("gemini-2.0-flash");
  });

  test("normalizes DeepSeek aliases", () => {
    expect(normalizeModelName("deepseek")).toBe("deepseek-v3");
    expect(normalizeModelName("r1")).toBe("deepseek-r1");
  });

  test("strips provider prefix", () => {
    expect(normalizeModelName("openai/gpt-4o")).toBe("gpt-4o");
    expect(normalizeModelName("anthropic/claude-3.5-sonnet")).toBe("claude-3.5-sonnet");
  });

  test("returns original if no alias found", () => {
    expect(normalizeModelName("custom-model")).toBe("custom-model");
  });
});

describe("getModelConfig", () => {
  test("returns config for known models", () => {
    const config = getModelConfig("gpt-4o");
    expect(config.supportsTools).toBe(true);
    expect(config.supportsVision).toBe(true);
    expect(config.maxContextTokens).toBe(128000);
  });

  test("returns config via alias", () => {
    const config = getModelConfig("sonnet");
    expect(config.supportsTools).toBe(true);
    expect(config.family).toBe("claude");
  });

  test("returns default config for unknown models", () => {
    const config = getModelConfig("unknown-model");
    expect(config.reasoningEffort).toBe("medium");
    expect(config.supportsTools).toBe(true);
  });
});

describe("getReasoningConfig", () => {
  test("returns model reasoning config", () => {
    const config = getReasoningConfig("o3");
    expect(config.effort).toBe("xhigh");
    expect(config.summary).toBe("detailed");
  });

  test("applies overrides", () => {
    const config = getReasoningConfig("gpt-4o", { effort: "high" });
    expect(config.effort).toBe("high");
    expect(config.summary).toBe("auto");
  });
});

describe("model capability checks", () => {
  test("supportsToolCalling", () => {
    expect(supportsToolCalling("gpt-4o")).toBe(true);
    expect(supportsToolCalling("o1")).toBe(false);
    expect(supportsToolCalling("o3")).toBe(true);
  });

  test("supportsVision", () => {
    expect(supportsVision("gpt-4o")).toBe(true);
    expect(supportsVision("deepseek-v3")).toBe(false);
    expect(supportsVision("claude-sonnet-4")).toBe(true);
  });

  test("supportsStreaming", () => {
    expect(supportsStreaming("gpt-4o")).toBe(true);
    expect(supportsStreaming("claude-3.5-sonnet")).toBe(true);
  });

  test("isReasoningModel", () => {
    expect(isReasoningModel("o1")).toBe(true);
    expect(isReasoningModel("o3")).toBe(true);
    expect(isReasoningModel("gpt-4o")).toBe(false);
    expect(isReasoningModel("deepseek-r1")).toBe(true);
    expect(isReasoningModel("gemini-2.5-pro")).toBe(true);
  });
});

describe("token limits", () => {
  test("getMaxContextTokens", () => {
    expect(getMaxContextTokens("gpt-4o")).toBe(128000);
    expect(getMaxContextTokens("gemini-1.5-pro")).toBe(1000000);
    expect(getMaxContextTokens("gemini-2.5-pro")).toBe(2000000);
  });

  test("getMaxOutputTokens", () => {
    expect(getMaxOutputTokens("gpt-4o")).toBe(16384);
    expect(getMaxOutputTokens("o3")).toBe(100000);
    expect(getMaxOutputTokens("claude-opus-4")).toBe(32768);
  });
});

describe("getModelFamily", () => {
  test("returns correct family", () => {
    expect(getModelFamily("gpt-4o")).toBe("gpt");
    expect(getModelFamily("o1")).toBe("o-series");
    expect(getModelFamily("claude-sonnet-4")).toBe("claude");
    expect(getModelFamily("gemini-2.0-flash")).toBe("gemini");
    expect(getModelFamily("deepseek-v3")).toBe("deepseek");
  });

  test("returns unknown for unrecognized models", () => {
    expect(getModelFamily("custom-model")).toBe("unknown");
  });
});

describe("getModelOwner", () => {
  test("identifies OpenAI models", () => {
    expect(getModelOwner("gpt-4o")).toBe("openai");
    expect(getModelOwner("o1-mini")).toBe("openai");
    expect(getModelOwner("o3")).toBe("openai");
  });

  test("identifies Anthropic models", () => {
    expect(getModelOwner("claude-3.5-sonnet")).toBe("anthropic");
    expect(getModelOwner("claude-opus-4")).toBe("anthropic");
  });

  test("identifies Google models", () => {
    expect(getModelOwner("gemini-2.0-flash")).toBe("google");
  });

  test("identifies DeepSeek models", () => {
    expect(getModelOwner("deepseek-v3")).toBe("deepseek");
  });

  test("identifies Mistral models", () => {
    expect(getModelOwner("mistral-large")).toBe("mistral");
    expect(getModelOwner("mixtral-8x22b")).toBe("mistral");
  });

  test("identifies Meta models", () => {
    expect(getModelOwner("llama-3.3-70b")).toBe("meta");
  });
});

describe("getModelAliases", () => {
  test("returns all aliases", () => {
    const aliases = getModelAliases();
    expect(aliases["gpt4"]).toBe("gpt-4o");
    expect(aliases["claude"]).toBe("claude-sonnet-4");
    expect(aliases["auto"]).toBe("gpt-4o");
  });
});

describe("getAllModelConfigs", () => {
  test("returns all model configs", () => {
    const configs = getAllModelConfigs();
    expect(configs["gpt-4o"]).toBeDefined();
    expect(configs["claude-sonnet-4"]).toBeDefined();
    expect(configs["gemini-2.5-pro"]).toBeDefined();
  });
});
