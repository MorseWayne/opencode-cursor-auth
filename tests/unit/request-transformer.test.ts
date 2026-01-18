/**
 * Request Transformer Unit Tests
 *
 * Tests for the request transformation layer that handles:
 * - Filtering item_reference type messages
 * - Stripping message IDs for stateless mode
 * - Multimodal content extraction
 */

import { describe, expect, test } from "bun:test";
import {
  transformMessages,
  hasMultimodalContent,
  extractTextContent,
  extractImageContent,
  validateMessagesForModel,
  type ExtendedMessage,
} from "../../src/lib/utils/request-transformer";

describe("transformMessages", () => {
  test("filters out item_reference type messages", () => {
    const messages: ExtendedMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi", type: "item_reference" },
      { role: "user", content: "How are you?" },
    ];

    const result = transformMessages(messages);

    expect(result.messages.length).toBe(2);
    expect(result.stats.itemReferencesFiltered).toBe(1);
    expect(result.messages[0].content).toBe("Hello");
    expect(result.messages[1].content).toBe("How are you?");
  });

  test("strips message IDs", () => {
    const messages: ExtendedMessage[] = [
      { role: "user", content: "Hello", id: "msg_123" },
      { role: "assistant", content: "Hi", id: "msg_456" },
      { role: "user", content: "Question" },
    ];

    const result = transformMessages(messages);

    expect(result.messages.length).toBe(3);
    expect(result.stats.idsStripped).toBe(2);
    expect(result.stats.strippedIds).toContain("msg_123");
    expect(result.stats.strippedIds).toContain("msg_456");

    // Verify IDs are removed from output
    for (const msg of result.messages) {
      expect((msg as ExtendedMessage).id).toBeUndefined();
    }
  });

  test("preserves tool_calls for assistant messages", () => {
    const messages: ExtendedMessage[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: { name: "read", arguments: '{"filePath": "test.txt"}' },
          },
        ],
      },
    ];

    const result = transformMessages(messages);

    expect(result.messages[0].tool_calls).toBeDefined();
    expect(result.messages[0].tool_calls?.length).toBe(1);
    expect(result.messages[0].tool_calls?.[0].function.name).toBe("read");
  });

  test("preserves tool_call_id for tool response messages", () => {
    const messages: ExtendedMessage[] = [
      {
        role: "tool",
        content: "File contents here",
        tool_call_id: "call_123",
      },
    ];

    const result = transformMessages(messages);

    expect(result.messages[0].tool_call_id).toBe("call_123");
  });

  test("handles empty messages array", () => {
    const result = transformMessages([]);

    expect(result.messages.length).toBe(0);
    expect(result.stats.originalCount).toBe(0);
    expect(result.stats.filteredCount).toBe(0);
  });

  test("combines multiple transformations", () => {
    const messages: ExtendedMessage[] = [
      { role: "user", content: "Hello", id: "msg_1" },
      { role: "assistant", content: "ref", type: "item_reference", id: "msg_2" },
      { role: "user", content: "World", id: "msg_3" },
    ];

    const result = transformMessages(messages);

    expect(result.messages.length).toBe(2);
    expect(result.stats.itemReferencesFiltered).toBe(1);
    expect(result.stats.idsStripped).toBe(2); // msg_1 and msg_3 (msg_2 was filtered)
  });
});

describe("hasMultimodalContent", () => {
  test("returns false for null content", () => {
    expect(hasMultimodalContent(null)).toBe(false);
  });

  test("returns false for string content", () => {
    expect(hasMultimodalContent("Hello world")).toBe(false);
  });

  test("returns false for text-only array content", () => {
    const content = [
      { type: "text" as const, text: "Hello" },
      { type: "text" as const, text: "World" },
    ];
    expect(hasMultimodalContent(content)).toBe(false);
  });

  test("returns true for content with images", () => {
    const content = [
      { type: "text" as const, text: "Describe this image" },
      {
        type: "image_url" as const,
        image_url: { url: "https://example.com/image.png" },
      },
    ];
    expect(hasMultimodalContent(content)).toBe(true);
  });
});

describe("extractTextContent", () => {
  test("returns empty string for null content", () => {
    expect(extractTextContent(null)).toBe("");
  });

  test("returns string content as-is", () => {
    expect(extractTextContent("Hello world")).toBe("Hello world");
  });

  test("extracts text from array content", () => {
    const content = [
      { type: "text" as const, text: "Hello" },
      { type: "text" as const, text: "World" },
    ];
    expect(extractTextContent(content)).toBe("Hello\nWorld");
  });

  test("ignores image parts in array content", () => {
    const content = [
      { type: "text" as const, text: "Describe this" },
      {
        type: "image_url" as const,
        image_url: { url: "https://example.com/image.png" },
      },
      { type: "text" as const, text: "Please" },
    ];
    expect(extractTextContent(content)).toBe("Describe this\nPlease");
  });
});

describe("extractImageContent", () => {
  test("returns empty array for null content", () => {
    expect(extractImageContent(null)).toEqual([]);
  });

  test("returns empty array for string content", () => {
    expect(extractImageContent("Hello")).toEqual([]);
  });

  test("extracts image URLs from array content", () => {
    const content = [
      { type: "text" as const, text: "Look at this" },
      {
        type: "image_url" as const,
        image_url: { url: "https://example.com/1.png", detail: "high" as const },
      },
      {
        type: "image_url" as const,
        image_url: { url: "https://example.com/2.png" },
      },
    ];

    const images = extractImageContent(content);

    expect(images.length).toBe(2);
    expect(images[0].url).toBe("https://example.com/1.png");
    expect(images[0].detail).toBe("high");
    expect(images[1].url).toBe("https://example.com/2.png");
    expect(images[1].detail).toBeUndefined();
  });
});

describe("validateMessagesForModel", () => {
  test("returns valid for text-only messages", () => {
    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi" },
    ];

    const result = validateMessagesForModel(messages, false);

    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBe(0);
  });

  test("warns for images with non-vision model", () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Describe" },
          {
            type: "image_url" as const,
            image_url: { url: "https://example.com/img.png" },
          },
        ],
      },
    ];

    const result = validateMessagesForModel(messages, false);

    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("does not support vision");
  });

  test("no warning for images with vision model", () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Describe" },
          {
            type: "image_url" as const,
            image_url: { url: "https://example.com/img.png" },
          },
        ],
      },
    ];

    const result = validateMessagesForModel(messages, true);

    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBe(0);
  });
});
