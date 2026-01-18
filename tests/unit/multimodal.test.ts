/**
 * Multimodal Content Processing Unit Tests
 *
 * Tests for multimodal content handling in the OpenAI compatibility layer:
 * - Image content detection and extraction
 * - Text content extraction from mixed content
 * - Prompt generation with multimodal support
 */

import { describe, expect, test } from "bun:test";
import {
  hasMultimodalContent,
  processMultimodalContent,
  formatImageReferences,
  messagesToPrompt,
  messagesToPromptWithImages,
  type MultimodalContentResult,
} from "../../src/lib/openai-compat/utils";

describe("hasMultimodalContent", () => {
  test("returns false for null content", () => {
    expect(hasMultimodalContent(null)).toBe(false);
  });

  test("returns false for string content", () => {
    expect(hasMultimodalContent("Just text")).toBe(false);
  });

  test("returns false for text-only array", () => {
    const content = [
      { type: "text" as const, text: "Line 1" },
      { type: "text" as const, text: "Line 2" },
    ];
    expect(hasMultimodalContent(content)).toBe(false);
  });

  test("returns true for array with image_url", () => {
    const content = [
      { type: "text" as const, text: "Check this" },
      { type: "image_url" as const, image_url: { url: "http://example.com/img.jpg" } },
    ];
    expect(hasMultimodalContent(content)).toBe(true);
  });
});

describe("processMultimodalContent", () => {
  test("handles null content", () => {
    const result = processMultimodalContent(null);
    expect(result.text).toBe("");
    expect(result.images).toEqual([]);
    expect(result.hasImages).toBe(false);
  });

  test("handles string content", () => {
    const result = processMultimodalContent("Hello world");
    expect(result.text).toBe("Hello world");
    expect(result.images).toEqual([]);
    expect(result.hasImages).toBe(false);
  });

  test("extracts text from array content", () => {
    const content = [
      { type: "text" as const, text: "First" },
      { type: "text" as const, text: "Second" },
    ];
    const result = processMultimodalContent(content);
    expect(result.text).toBe("First\nSecond");
    expect(result.hasImages).toBe(false);
  });

  test("extracts images from array content", () => {
    const content = [
      { type: "text" as const, text: "Look at this image" },
      {
        type: "image_url" as const,
        image_url: { url: "https://example.com/photo.png", detail: "high" as const },
      },
    ];
    const result = processMultimodalContent(content);

    expect(result.text).toBe("Look at this image");
    expect(result.hasImages).toBe(true);
    expect(result.images.length).toBe(1);
    expect(result.images[0].url).toBe("https://example.com/photo.png");
    expect(result.images[0].detail).toBe("high");
    expect(result.images[0].isBase64).toBe(false);
  });

  test("detects base64 data URLs", () => {
    const content = [
      {
        type: "image_url" as const,
        image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" },
      },
    ];
    const result = processMultimodalContent(content);

    expect(result.images[0].isBase64).toBe(true);
    expect(result.images[0].mimeType).toBe("image/png");
  });

  test("handles multiple images", () => {
    const content = [
      { type: "text" as const, text: "Compare these" },
      { type: "image_url" as const, image_url: { url: "http://a.com/1.jpg" } },
      { type: "image_url" as const, image_url: { url: "http://b.com/2.jpg" } },
      { type: "text" as const, text: "Which is better?" },
    ];
    const result = processMultimodalContent(content);

    expect(result.text).toBe("Compare these\nWhich is better?");
    expect(result.images.length).toBe(2);
  });
});

describe("formatImageReferences", () => {
  test("returns empty string for no images", () => {
    expect(formatImageReferences([])).toBe("");
  });

  test("formats URL image reference", () => {
    const images: MultimodalContentResult["images"] = [
      { url: "https://example.com/photo.jpg", isBase64: false },
    ];
    const result = formatImageReferences(images);
    expect(result).toContain("Image 1:");
    expect(result).toContain("https://example.com/photo.jpg");
  });

  test("formats base64 image reference", () => {
    const images: MultimodalContentResult["images"] = [
      { url: "data:image/png;base64,abc", isBase64: true, mimeType: "image/png" },
    ];
    const result = formatImageReferences(images);
    expect(result).toContain("Image 1:");
    expect(result).toContain("embedded image/png");
  });

  test("includes detail level", () => {
    const images: MultimodalContentResult["images"] = [
      { url: "http://example.com/img.jpg", isBase64: false, detail: "high" },
    ];
    const result = formatImageReferences(images);
    expect(result).toContain("detail: high");
  });

  test("formats multiple images", () => {
    const images: MultimodalContentResult["images"] = [
      { url: "http://a.com/1.jpg", isBase64: false },
      { url: "http://b.com/2.jpg", isBase64: false },
    ];
    const result = formatImageReferences(images);
    expect(result).toContain("Image 1:");
    expect(result).toContain("Image 2:");
  });
});

describe("messagesToPrompt", () => {
  test("formats basic text messages", () => {
    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi there" },
      { role: "user" as const, content: "How are you?" },
    ];

    const prompt = messagesToPrompt(messages);

    expect(prompt).toContain("User: Hello");
    expect(prompt).toContain("Assistant: Hi there");
    expect(prompt).toContain("User: How are you?");
  });

  test("prepends system messages", () => {
    const messages = [
      { role: "system" as const, content: "You are helpful" },
      { role: "user" as const, content: "Hi" },
    ];

    const prompt = messagesToPrompt(messages);

    expect(prompt.indexOf("You are helpful")).toBeLessThan(prompt.indexOf("User: Hi"));
  });

  test("formats tool calls", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function" as const,
            function: { name: "read", arguments: '{"path": "test.txt"}' },
          },
        ],
      },
    ];

    const prompt = messagesToPrompt(messages);

    expect(prompt).toContain("[Called tool: read");
  });

  test("formats tool results", () => {
    const messages = [
      { role: "tool" as const, content: "File contents", tool_call_id: "call_1" },
    ];

    const prompt = messagesToPrompt(messages);

    expect(prompt).toContain("[Tool result for call_1]");
    expect(prompt).toContain("File contents");
  });
});

describe("messagesToPromptWithImages", () => {
  test("extracts images from multimodal messages", () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "What is this?" },
          { type: "image_url" as const, image_url: { url: "http://example.com/img.jpg" } },
        ],
      },
    ];

    const result = messagesToPromptWithImages(messages, { supportsVision: true });

    expect(result.prompt).toContain("User: What is this?");
    expect(result.hasImages).toBe(true);
    expect(result.images.length).toBe(1);
  });

  test("adds image references for non-vision models", () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Describe this" },
          { type: "image_url" as const, image_url: { url: "http://example.com/img.jpg" } },
        ],
      },
    ];

    const result = messagesToPromptWithImages(messages, {
      supportsVision: false,
      includeImageReferences: true,
    });

    expect(result.prompt).toContain("Describe this");
    expect(result.prompt).toContain("Image 1:");
  });

  test("collects images from multiple messages", () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "First image" },
          { type: "image_url" as const, image_url: { url: "http://a.com/1.jpg" } },
        ],
      },
      { role: "assistant" as const, content: "I see it" },
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Second image" },
          { type: "image_url" as const, image_url: { url: "http://b.com/2.jpg" } },
        ],
      },
    ];

    const result = messagesToPromptWithImages(messages, { supportsVision: true });

    expect(result.images.length).toBe(2);
  });
});
