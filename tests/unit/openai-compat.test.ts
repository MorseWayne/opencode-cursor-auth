import { describe, expect, test } from "bun:test";
import { messagesToPrompt, messagesToPromptWithImages } from "../../src/lib/openai-compat/utils";
import type { OpenAIMessage } from "../../src/lib/openai-compat/types";

describe("messagesToPrompt", () => {
  test("handles string content", () => {
    const messages: OpenAIMessage[] = [
      { role: "user", content: "Hello" },
    ];
    const result = messagesToPrompt(messages);
    expect(result).toBe("User: Hello");
  });

  test("handles null content", () => {
    const messages: OpenAIMessage[] = [
      { role: "user", content: null },
    ];
    const result = messagesToPrompt(messages);
    expect(result).toBe("User: ");
  });

  test("handles array content with text parts (vision model)", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,..." } },
        ],
      },
    ];
    // When vision is supported, no image references are added
    const result = messagesToPrompt(messages, { supportsVision: true });
    expect(result).toBe("User: What is in this image?");
  });

  test("handles array content with text parts (non-vision model)", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,..." } },
        ],
      },
    ];
    // When vision is not supported, image references are added
    const result = messagesToPrompt(messages, { supportsVision: false });
    expect(result).toContain("User: What is in this image?");
    expect(result).toContain("Image 1:");
    expect(result).toContain("embedded image/png");
  });

  test("handles array content with multiple text parts (vision model)", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "First part" },
          { type: "image_url", image_url: { url: "data:image/png;base64,..." } },
          { type: "text", text: "Second part" },
        ],
      },
    ];
    const result = messagesToPrompt(messages, { supportsVision: true });
    expect(result).toBe("User: First part\nSecond part");
  });

  test("handles array content with only image (no text)", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/png;base64,..." } },
        ],
      },
    ];
    // Vision model: no image references added
    const result = messagesToPrompt(messages, { supportsVision: true });
    expect(result).toBe("User: ");
  });

  test("handles system message with array content", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "system",
        content: [
          { type: "text", text: "You are a helpful assistant." },
        ],
      },
      { role: "user", content: "Hi" },
    ];
    const result = messagesToPrompt(messages);
    expect(result).toContain("You are a helpful assistant.");
    expect(result).toContain("User: Hi");
  });

  test("handles assistant message with array content", () => {
    const messages: OpenAIMessage[] = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Hello! How can I help?" },
        ],
      },
    ];
    const result = messagesToPrompt(messages);
    expect(result).toContain("User: Hello");
    expect(result).toContain("Assistant: Hello! How can I help?");
  });

  test("handles tool message with array content", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "tool",
        tool_call_id: "call_123",
        content: [
          { type: "text", text: "Tool output here" },
        ],
      },
    ];
    const result = messagesToPrompt(messages);
    expect(result).toContain("[Tool result for call_123]: Tool output here");
  });
});
