/**
 * Request Transformer
 *
 * Transforms incoming OpenAI-compatible requests for Cursor API compatibility.
 * Based on techniques from opencode-openai-codex-auth project:
 * - Filters AI SDK-only constructs (item_reference)
 * - Strips message IDs for stateless mode
 * - Handles store:false requirements
 */

import type { OpenAIMessage, OpenAIMessageContent } from "../openai-compat/types";
import { createLogger } from "./logger";

const logger = createLogger("request-transformer");

/**
 * Extended message type that includes optional fields that may need filtering
 */
export interface ExtendedMessage extends OpenAIMessage {
  id?: string;
  type?: string;
  item_reference?: string;
}

/**
 * Result of request transformation
 */
export interface TransformResult {
  /** Transformed messages */
  messages: OpenAIMessage[];
  /** Statistics about the transformation */
  stats: TransformStats;
}

/**
 * Statistics about the transformation process
 */
export interface TransformStats {
  /** Original message count */
  originalCount: number;
  /** Final message count after filtering */
  filteredCount: number;
  /** Number of item_reference entries filtered */
  itemReferencesFiltered: number;
  /** Number of message IDs stripped */
  idsStripped: number;
  /** IDs that were stripped (for debugging) */
  strippedIds: string[];
}

/**
 * Filter and transform messages for Cursor API compatibility
 *
 * Key transformations:
 * 1. Filter out item_reference type messages (AI SDK construct for server state lookup)
 * 2. Strip message IDs (causes "item not found" errors in stateless mode)
 * 3. Preserve all other message content
 *
 * @param messages - Original messages from the request
 * @param options - Transformation options
 * @returns Transformed messages and statistics
 */
export function transformMessages(
  messages: ExtendedMessage[],
  options: { logStats?: boolean } = {}
): TransformResult {
  const stats: TransformStats = {
    originalCount: messages.length,
    filteredCount: 0,
    itemReferencesFiltered: 0,
    idsStripped: 0,
    strippedIds: [],
  };

  const transformed: OpenAIMessage[] = [];

  for (const message of messages) {
    // Filter out item_reference type messages
    // These are AI SDK constructs for server state lookup (not in Cursor API spec)
    if (message.type === "item_reference") {
      stats.itemReferencesFiltered++;
      continue;
    }

    // Create a clean copy without internal fields
    const cleanMessage: OpenAIMessage = {
      role: message.role,
      content: message.content,
    };

    // Track and strip message IDs
    // In stateless mode, IDs cause "item not found" errors
    if (message.id) {
      stats.idsStripped++;
      stats.strippedIds.push(message.id);
    }

    // Preserve tool_calls for assistant messages
    if (message.tool_calls && message.tool_calls.length > 0) {
      cleanMessage.tool_calls = message.tool_calls;
    }

    // Preserve tool_call_id for tool response messages
    if (message.tool_call_id) {
      cleanMessage.tool_call_id = message.tool_call_id;
    }

    transformed.push(cleanMessage);
  }

  stats.filteredCount = transformed.length;

  // Log transformation stats if enabled
  if (options.logStats) {
    logTransformStats(stats);
  }

  return { messages: transformed, stats };
}

/**
 * Log transformation statistics for debugging
 */
export function logTransformStats(stats: TransformStats): void {
  const filtered = stats.originalCount - stats.filteredCount;

  if (filtered > 0 || stats.idsStripped > 0) {
    logger.debug(
      `[Request Transform] Processed ${stats.originalCount} messages: ` +
        `filtered ${stats.itemReferencesFiltered} item_reference(s), ` +
        `stripped ${stats.idsStripped} ID(s)`
    );

    if (stats.strippedIds.length > 0 && stats.strippedIds.length <= 10) {
      logger.debug(`[Request Transform] Stripped IDs: ${stats.strippedIds.join(", ")}`);
    } else if (stats.strippedIds.length > 10) {
      logger.debug(
        `[Request Transform] Stripped IDs: ${stats.strippedIds.slice(0, 10).join(", ")} ` +
          `... and ${stats.strippedIds.length - 10} more`
      );
    }
  }
}

/**
 * Check if a message contains multimodal content
 */
export function hasMultimodalContent(content: OpenAIMessageContent): boolean {
  if (typeof content === "string" || content === null) {
    return false;
  }
  return content.some((part) => part.type === "image_url");
}

/**
 * Extract text content from potentially multimodal content
 */
export function extractTextContent(content: OpenAIMessageContent): string {
  if (content === null) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  // Handle array of content parts
  const textParts = content
    .filter((part) => part.type === "text")
    .map((part) => (part as { type: "text"; text: string }).text);

  return textParts.join("\n");
}

/**
 * Extract image content from multimodal content
 */
export function extractImageContent(
  content: OpenAIMessageContent
): Array<{ url: string; detail?: "auto" | "low" | "high" }> {
  if (content === null || typeof content === "string") {
    return [];
  }

  return content
    .filter((part) => part.type === "image_url")
    .map((part) => {
      const imagePart = part as {
        type: "image_url";
        image_url: { url: string; detail?: "auto" | "low" | "high" };
      };
      return {
        url: imagePart.image_url.url,
        detail: imagePart.image_url.detail,
      };
    });
}

/**
 * Validate that messages are compatible with target model capabilities
 *
 * @param messages - Messages to validate
 * @param supportsVision - Whether the model supports vision/images
 * @returns Validation result with any warnings
 */
export function validateMessagesForModel(
  messages: OpenAIMessage[],
  supportsVision: boolean
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    // Skip if message is undefined (shouldn't happen, but TypeScript safety)
    if (!message) {
      continue;
    }

    // Check for image content in non-vision models
    if (!supportsVision && hasMultimodalContent(message.content)) {
      warnings.push(
        `Message ${i + 1} contains image content but the model does not support vision. ` +
          `Images will be ignored.`
      );
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}
