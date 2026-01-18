/**
 * OpenAI-Compatible API Utilities
 * 
 * Shared utility functions for OpenAI API compatibility layer.
 */

import { randomUUID } from "node:crypto";
import type { ExecRequest } from "../api/agent-service";
import type {
  OpenAIMessage,
  OpenAIMessageContent,
  OpenAIStreamChunk,
  OpenAITextContentPart,
  OpenAIImageContentPart,
} from "./types";

/**
 * Generate a unique completion ID
 */
export function generateCompletionId(): string {
  return `chatcmpl-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

// --- Multimodal Content Processing ---

/**
 * Result of processing multimodal content
 */
export interface MultimodalContentResult {
  /** Combined text content */
  text: string;
  /** Extracted image content */
  images: Array<{
    url: string;
    detail?: "auto" | "low" | "high";
    /** Whether the URL is a base64 data URL */
    isBase64: boolean;
    /** Detected MIME type (if base64) */
    mimeType?: string;
  }>;
  /** Whether the content contains images */
  hasImages: boolean;
}

/**
 * Check if content contains multimodal (image) parts
 */
export function hasMultimodalContent(content: OpenAIMessageContent): boolean {
  if (content === null || typeof content === "string") {
    return false;
  }
  return content.some((part) => part.type === "image_url");
}

/**
 * Process multimodal content into separate text and image parts
 *
 * Handles:
 * - Plain string content
 * - Array of text/image parts
 * - Base64 data URLs
 * - Regular image URLs
 */
export function processMultimodalContent(content: OpenAIMessageContent): MultimodalContentResult {
  if (content === null) {
    return { text: "", images: [], hasImages: false };
  }

  if (typeof content === "string") {
    return { text: content, images: [], hasImages: false };
  }

  const texts: string[] = [];
  const images: MultimodalContentResult["images"] = [];

  for (const part of content) {
    if (part.type === "text") {
      texts.push((part as OpenAITextContentPart).text);
    } else if (part.type === "image_url") {
      const imagePart = part as OpenAIImageContentPart;
      const url = imagePart.image_url.url;
      const isBase64 = url.startsWith("data:");

      let mimeType: string | undefined;
      if (isBase64) {
        // Extract MIME type from data URL: data:image/png;base64,...
        const match = url.match(/^data:([^;]+);/);
        mimeType = match?.[1];
      }

      images.push({
        url,
        detail: imagePart.image_url.detail,
        isBase64,
        mimeType,
      });
    }
  }

  return {
    text: texts.join("\n"),
    images,
    hasImages: images.length > 0,
  };
}

/**
 * Extract only text content from potentially multimodal content
 */
function extractTextContent(content: OpenAIMessageContent): string {
  if (content === null) return "";
  if (typeof content === "string") return content;
  
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map(part => part.text)
    .join("\n");
}

/**
 * Format image references for text-based prompts
 * When images can't be directly passed, include a description
 */
export function formatImageReferences(images: MultimodalContentResult["images"]): string {
  if (images.length === 0) return "";

  const refs = images.map((img, i) => {
    const source = img.isBase64
      ? `[embedded ${img.mimeType || "image"}]`
      : `[image: ${img.url}]`;
    const detail = img.detail ? ` (detail: ${img.detail})` : "";
    return `Image ${i + 1}: ${source}${detail}`;
  });

  return refs.join("\n");
}

/**
 * Options for message to prompt conversion
 */
export interface MessagesToPromptOptions {
  /** Whether the model supports vision/images */
  supportsVision?: boolean;
  /** Whether to include image references in text when vision not supported */
  includeImageReferences?: boolean;
}

/**
 * Result of message to prompt conversion
 */
export interface MessagesToPromptResult {
  /** The formatted prompt text */
  prompt: string;
  /** Extracted images from all messages */
  images: MultimodalContentResult["images"];
  /** Whether the conversation contains images */
  hasImages: boolean;
}

/**
 * Convert OpenAI messages array to a prompt string for Cursor.
 * Handles the full message history including:
 * - system messages (prepended)
 * - user messages (with optional multimodal content)
 * - assistant messages (including those with tool_calls)
 * - tool result messages (role: "tool")
 * 
 * For multi-turn conversations with tool calls, this formats the conversation
 * so the model can see what tools were called and their results.
 *
 * For multimodal content:
 * - Extracts text content for the prompt
 * - Collects images separately for models that support vision
 * - Optionally adds image references for non-vision models
 */
export function messagesToPrompt(
  messages: OpenAIMessage[],
  options: MessagesToPromptOptions = {}
): string {
  const result = messagesToPromptWithImages(messages, options);
  return result.prompt;
}

/**
 * Convert OpenAI messages to prompt with image extraction
 * Returns both the prompt and any extracted images for vision models
 */
export function messagesToPromptWithImages(
  messages: OpenAIMessage[],
  options: MessagesToPromptOptions = {}
): MessagesToPromptResult {
  const { supportsVision = false, includeImageReferences = true } = options;
  const parts: string[] = [];
  const allImages: MultimodalContentResult["images"] = [];
  
  // Extract system messages to prepend
  const systemMessages = messages.filter(m => m.role === "system");
  if (systemMessages.length > 0) {
    parts.push(systemMessages.map(m => extractTextContent(m.content)).join("\n"));
  }
  
  // Process non-system messages in order
  const conversationMessages = messages.filter(m => m.role !== "system");
  
  // Check if this is a continuation with tool results
  const hasToolResults = conversationMessages.some(m => m.role === "tool");
  
  // Format the full conversation history
  for (const msg of conversationMessages) {
    if (msg.role === "user") {
      // Process potentially multimodal user messages
      const multimodal = processMultimodalContent(msg.content);
      let userContent = multimodal.text;

      if (multimodal.hasImages) {
        // Collect images for vision-capable models
        allImages.push(...multimodal.images);

        // Add image references for non-vision models or as context
        if (!supportsVision && includeImageReferences) {
          const imageRefs = formatImageReferences(multimodal.images);
          if (imageRefs) {
            userContent = `${userContent}\n${imageRefs}`;
          }
        }
      }

      parts.push(`User: ${userContent}`);
    } else if (msg.role === "assistant") {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Assistant made tool calls - show what was called
        const toolCallsDesc = msg.tool_calls.map(tc => 
          `[Called tool: ${tc.function.name}(${tc.function.arguments})]`
        ).join("\n");
        const textContent = extractTextContent(msg.content);
        if (textContent) {
          parts.push(`Assistant: ${textContent}\n${toolCallsDesc}`);
        } else {
          parts.push(`Assistant: ${toolCallsDesc}`);
        }
      } else {
        const textContent = extractTextContent(msg.content);
        if (textContent) {
          parts.push(`Assistant: ${textContent}`);
        }
      }
    } else if (msg.role === "tool") {
      // Tool result - show the result with the tool call ID for context
      parts.push(`[Tool result for ${msg.tool_call_id}]: ${extractTextContent(msg.content)}`);
    }
  }
  
  // Add instruction for the model to continue if there are tool results
  if (hasToolResults) {
    parts.push("\nBased on the tool results above, please continue your response:");
  }
  
  return {
    prompt: parts.join("\n\n"),
    images: allImages,
    hasImages: allImages.length > 0,
  };
}

/**
 * Map exec request to OpenAI tool call format
 * 
 * Mapping rules:
 * - shell → bash: Execute shell commands
 * - read → read: Read file contents
 * - ls → list: List directory contents
 * - grep (with pattern) → grep: Search file contents
 * - grep (with glob) → glob: Search files by pattern
 * - write → write: Write/create files (supports text and binary)
 * - mcp → original tool name: MCP tool passthrough
 * - request_context → null: Internal use only, not exposed
 */
export function mapExecRequestToTool(execReq: ExecRequest): {
  toolName: string | null;
  toolArgs: Record<string, unknown> | null;
} {
  switch (execReq.type) {
    case "shell": {
      const toolArgs: Record<string, unknown> = { command: execReq.command };
      if (execReq.cwd) toolArgs.cwd = execReq.cwd;
      return { toolName: "bash", toolArgs };
    }
    
    case "read":
      return { toolName: "read", toolArgs: { filePath: execReq.path } };
    
    case "ls":
      return { toolName: "list", toolArgs: { path: execReq.path } };
    
    case "grep": {
      // Prefer glob pattern over regex pattern when both exist
      // glob is used for file path matching (e.g., **/*.ts)
      // pattern is used for content searching (e.g., "function foo")
      if (execReq.glob) {
        return { toolName: "glob", toolArgs: { pattern: execReq.glob, path: execReq.path } };
      }
      return { toolName: "grep", toolArgs: { pattern: execReq.pattern, path: execReq.path } };
    }
    
    case "write": {
      // Handle both text and binary content
      // Binary content (fileBytes) takes precedence if present
      const content = execReq.fileBytes && execReq.fileBytes.length > 0
        ? Buffer.from(execReq.fileBytes).toString("base64")
        : execReq.fileText;
      const toolArgs: Record<string, unknown> = { filePath: execReq.path, content };
      // Flag to indicate base64 encoding for binary files
      if (execReq.fileBytes && execReq.fileBytes.length > 0) {
        toolArgs.encoding = "base64";
      }
      return { toolName: "write", toolArgs };
    }
    
    case "mcp":
      return { 
        toolName: execReq.toolName, 
        toolArgs: (execReq.args ?? {}) as Record<string, unknown> 
      };
    
    case "request_context":
      // Internal tool, not exposed to OpenCode
      return { toolName: null, toolArgs: null };
    
    default:
      // Unknown type - return null to skip
      return { toolName: null, toolArgs: null };
  }
}

/**
 * Create an error response in OpenAI format
 */
export function createErrorResponse(
  message: string, 
  type = "invalid_request_error", 
  status = 400
): Response {
  return new Response(
    JSON.stringify({
      error: {
        message,
        type,
        param: null,
        code: null,
      },
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

/**
 * Create an SSE chunk string from data
 */
export function createSSEChunk(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Create an SSE done signal
 */
export function createSSEDone(): string {
  return "data: [DONE]\n\n";
}

/**
 * Create a streaming SSE response
 */
export function makeStreamResponse(readable: ReadableStream<Uint8Array>): Response {
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Create CORS preflight response
 */
export function handleCORS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}

/**
 * Determine model owner based on model name
 */
export function getModelOwner(displayName: string): string {
  const lowerName = displayName.toLowerCase();
  if (lowerName.includes("claude") || lowerName.includes("opus") || lowerName.includes("sonnet")) {
    return "anthropic";
  }
  if (lowerName.includes("gpt")) {
    return "openai";
  }
  if (lowerName.includes("gemini")) {
    return "google";
  }
  if (lowerName.includes("grok")) {
    return "xai";
  }
  return "cursor";
}

/**
 * Create an OpenAI stream chunk
 */
export function createStreamChunk(
  completionId: string,
  model: string,
  created: number,
  delta: { role?: "assistant"; content?: string | null; tool_calls?: OpenAIStreamChunk["choices"][0]["delta"]["tool_calls"] },
  finishReason: "stop" | "length" | "content_filter" | "tool_calls" | null = null
): OpenAIStreamChunk {
  return {
    id: completionId,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{
      index: 0,
      delta,
      finish_reason: finishReason,
    }],
  };
}

/**
 * Generate a tool call ID from completion ID and index
 */
export function generateToolCallId(completionId: string, index: number): string {
  // completionId format is "chatcmpl-{uuid}", so skip the "chatcmpl-" prefix (9 chars)
  // This ensures unique IDs across different requests
  return `call_${completionId.slice(9, 17)}_${index}`;
}
