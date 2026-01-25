/**
 * Protobuf analyzer module for cursor-sniffer
 */

import { parseProtoFields } from "../../src/lib/api/proto/decoding";
import { parseInteractionUpdate } from "../../src/lib/api/proto/interaction";
import { parseExecServerMessage } from "../../src/lib/api/proto/exec";
import { parseKvServerMessage } from "../../src/lib/api/proto/kv";
import { colors, type ParsedMessage, type TrafficEntry } from "./types";

const c = colors;

// Event emitter for real-time updates
type TrafficListener = (entry: TrafficEntry) => void;
const listeners: TrafficListener[] = [];

export function addTrafficListener(listener: TrafficListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

export function emitTraffic(entry: TrafficEntry): void {
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch {
      // Ignore listener errors
    }
  }
}

// Hex dump utility
export function hexDump(data: Uint8Array, maxBytes = 128): string {
  const bytes = data.slice(0, maxBytes);
  let hex = "";
  let ascii = "";
  let result = "";

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    hex += byte.toString(16).padStart(2, "0") + " ";
    ascii += byte >= 32 && byte < 127 ? String.fromCharCode(byte) : ".";

    if ((i + 1) % 16 === 0) {
      result += `  ${c.dim}${hex}${c.reset} ${c.green}${ascii}${c.reset}\n`;
      hex = "";
      ascii = "";
    }
  }

  if (hex) {
    result += `  ${c.dim}${hex.padEnd(48)}${c.reset} ${c.green}${ascii}${c.reset}\n`;
  }

  if (data.length > maxBytes) {
    result += `  ${c.dim}... (${data.length - maxBytes} more bytes)${c.reset}\n`;
  }

  return result;
}

// Try to decode bytes as string
export function tryDecodeString(bytes: Uint8Array): string | null {
  try {
    const str = new TextDecoder().decode(bytes);
    if (/^[\x20-\x7E\n\r\t]*$/.test(str) && str.length > 0) {
      return str;
    }
    return null;
  } catch {
    return null;
  }
}

// Try to parse as nested protobuf message
export function tryParseNested(bytes: Uint8Array): boolean {
  try {
    const fields = parseProtoFields(bytes);
    return fields.length > 0 && fields.every((f) => f.fieldNumber > 0 && f.fieldNumber < 100);
  } catch {
    return false;
  }
}

// Analyze protobuf fields recursively
export function analyzeProtoFields(data: Uint8Array, depth = 0, showRaw = false): string {
  const indent = "  ".repeat(depth);
  let result = "";

  try {
    const fields = parseProtoFields(data);

    for (const field of fields) {
      const fieldNum = field.fieldNumber;
      const wireType = field.wireType;

      result += `${indent}${c.cyan}field ${fieldNum}${c.reset} (wire=${wireType}): `;

      if (wireType === 0) {
        result += `${c.yellow}${field.value}${c.reset}\n`;
      } else if (wireType === 2 && field.value instanceof Uint8Array) {
        const bytes = field.value;
        const maybeString = tryDecodeString(bytes);
        if (maybeString && maybeString.length <= 100) {
          result += `${c.green}"${maybeString}"${c.reset}\n`;
        } else if (maybeString && maybeString.length > 100) {
          result += `${c.green}"${maybeString.slice(0, 100)}..."${c.reset} (${bytes.length} bytes)\n`;
        } else {
          const nested = tryParseNested(bytes);
          if (nested) {
            result += `${c.magenta}[nested message]${c.reset}\n`;
            result += analyzeProtoFields(bytes, depth + 1, showRaw);
          } else {
            result += `${c.dim}[${bytes.length} bytes]${c.reset}\n`;
            if (showRaw && bytes.length <= 64) {
              result += hexDump(bytes, 64);
            }
          }
        }
      } else if (wireType === 1 && field.value instanceof Uint8Array) {
        result += `${c.yellow}[64-bit: ${Buffer.from(field.value).toString("hex")}]${c.reset}\n`;
      } else if (wireType === 5 && field.value instanceof Uint8Array) {
        result += `${c.yellow}[32-bit: ${Buffer.from(field.value).toString("hex")}]${c.reset}\n`;
      } else {
        result += `${c.dim}[unknown]${c.reset}\n`;
      }
    }
  } catch (err) {
    result += `${indent}${c.red}[parse error: ${err}]${c.reset}\n`;
  }

  return result;
}

// Parse AgentClientMessage
export function parseAgentClientMessage(data: Uint8Array): ParsedMessage {
  const fields = parseProtoFields(data);
  const result: ParsedMessage = {
    type: "AgentClientMessage",
    summary: "",
    details: {},
  };

  for (const field of fields) {
    if (field.fieldNumber === 1 && field.wireType === 2 && field.value instanceof Uint8Array) {
      result.summary = "AgentRunRequest";
      result.details = parseAgentRunRequest(field.value);
    } else if (field.fieldNumber === 2 && field.wireType === 2 && field.value instanceof Uint8Array) {
      result.summary = "ExecClientMessage (tool result)";
      result.details = parseExecClientMessage(field.value);
    } else if (field.fieldNumber === 3 && field.wireType === 2 && field.value instanceof Uint8Array) {
      result.summary = "KvClientMessage";
      result.details = { raw: Buffer.from(field.value).toString("hex").slice(0, 64) };
    } else if (field.fieldNumber === 4 && field.wireType === 2 && field.value instanceof Uint8Array) {
      result.summary = "ConversationAction";
      result.details = parseConversationAction(field.value);
    }
  }

  return result;
}

function parseAgentRunRequest(data: Uint8Array): Record<string, unknown> {
  const fields = parseProtoFields(data);
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.fieldNumber === 2 && field.wireType === 2 && field.value instanceof Uint8Array) {
      result.action = parseConversationAction(field.value);
    } else if (field.fieldNumber === 3 && field.wireType === 2 && field.value instanceof Uint8Array) {
      result.model = parseModelDetails(field.value);
    } else if (field.fieldNumber === 5 && field.wireType === 2 && field.value instanceof Uint8Array) {
      result.conversationId = new TextDecoder().decode(field.value);
    }
  }

  return result;
}

function parseConversationAction(data: Uint8Array): Record<string, unknown> {
  const fields = parseProtoFields(data);
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.fieldNumber === 1 && field.wireType === 2 && field.value instanceof Uint8Array) {
      result.userMessage = parseUserMessageAction(field.value);
    } else if (field.fieldNumber === 2 && field.wireType === 2) {
      result.resume = true;
    }
  }

  return result;
}

function parseUserMessageAction(data: Uint8Array): Record<string, unknown> {
  const fields = parseProtoFields(data);
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.fieldNumber === 1 && field.wireType === 2 && field.value instanceof Uint8Array) {
      const msgFields = parseProtoFields(field.value);
      for (const mf of msgFields) {
        if (mf.fieldNumber === 1 && mf.wireType === 2 && mf.value instanceof Uint8Array) {
          const text = new TextDecoder().decode(mf.value);
          result.text = text.length > 200 ? text.slice(0, 200) + "..." : text;
        }
        if (mf.fieldNumber === 4 && mf.wireType === 0) {
          result.mode = Number(mf.value);
        }
      }
    }
  }

  return result;
}

function parseModelDetails(data: Uint8Array): string {
  const fields = parseProtoFields(data);
  for (const field of fields) {
    if (field.fieldNumber === 1 && field.wireType === 2 && field.value instanceof Uint8Array) {
      return new TextDecoder().decode(field.value);
    }
  }
  return "unknown";
}

function parseExecClientMessage(data: Uint8Array): Record<string, unknown> {
  const fields = parseProtoFields(data);
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.fieldNumber === 1 && field.wireType === 0) {
      result.id = Number(field.value);
    }
  }

  return result;
}

// Parse AgentServerMessage
export function parseAgentServerMessage(data: Uint8Array): ParsedMessage[] {
  const fields = parseProtoFields(data);
  const results: ParsedMessage[] = [];

  for (const field of fields) {
    if (field.fieldNumber === 1 && field.wireType === 2 && field.value instanceof Uint8Array) {
      const update = parseInteractionUpdate(field.value);
      const msg: ParsedMessage = {
        type: "InteractionUpdate",
        summary: "",
        details: {},
      };

      if (update.text) {
        msg.summary = "text";
        msg.details.text = update.text.length > 100 ? update.text.slice(0, 100) + "..." : update.text;
      }
      if (update.thinking) {
        msg.summary = "thinking";
        msg.details.thinking = update.thinking.length > 100 ? update.thinking.slice(0, 100) + "..." : update.thinking;
      }
      if (update.toolCallStarted) {
        msg.summary = "tool_call_started";
        msg.details = update.toolCallStarted;
      }
      if (update.toolCallCompleted) {
        msg.summary = "tool_call_completed";
        msg.details = update.toolCallCompleted;
      }
      if (update.partialToolCall) {
        msg.summary = "partial_tool_call";
        msg.details = update.partialToolCall;
      }
      if (update.isComplete) {
        msg.summary = "turn_ended";
      }
      if (update.isHeartbeat) {
        msg.summary = "heartbeat";
      }

      if (msg.summary) {
        results.push(msg);
      }
    } else if (field.fieldNumber === 2 && field.wireType === 2 && field.value instanceof Uint8Array) {
      const exec = parseExecServerMessage(field.value);
      if (exec) {
        results.push({
          type: "ExecServerMessage",
          summary: exec.type,
          details: exec as unknown as Record<string, unknown>,
        });
      }
    } else if (field.fieldNumber === 3 && field.wireType === 2) {
      results.push({
        type: "Checkpoint",
        summary: "conversation_checkpoint",
        details: {},
      });
    } else if (field.fieldNumber === 4 && field.wireType === 2 && field.value instanceof Uint8Array) {
      const kv = parseKvServerMessage(field.value);
      results.push({
        type: "KvServerMessage",
        summary: kv.messageType,
        details: { id: kv.id },
      });
    } else if (field.fieldNumber === 7 && field.wireType === 2) {
      results.push({
        type: "InteractionQuery",
        summary: "query",
        details: {},
      });
    }
  }

  return results;
}

// Check if data looks like a gRPC-Web envelope
export function hasGrpcWebEnvelope(data: Uint8Array): boolean {
  if (data.length < 5) return false;
  
  const flags = data[0]!;
  // Valid flags: 0x00 (data frame) or 0x80 (trailer frame)
  if (flags !== 0x00 && flags !== 0x80) return false;
  
  // Read length (big-endian)
  const length = (data[1]! << 24) | (data[2]! << 16) | (data[3]! << 8) | data[4]!;
  
  // Length should match remaining bytes (or be close for trailer frames)
  return length > 0 && length <= data.length - 5;
}

// Remove Connect envelope (5 bytes: 1 byte flags + 4 bytes length)
export function removeEnvelope(data: Uint8Array): Uint8Array {
  if (!hasGrpcWebEnvelope(data)) return data;
  return data.slice(5);
}

// Parse UsableModel protobuf message
export interface UsableModel {
  modelId?: string;
  displayModelId?: string;
  displayName?: string;
  displayNameShort?: string;
  aliases?: string[];
}

export function parseUsableModel(data: Uint8Array): UsableModel {
  const fields = parseProtoFields(data);
  const model: UsableModel = {};
  
  for (const field of fields) {
    if (field.wireType === 2 && field.value instanceof Uint8Array) {
      const str = tryDecodeString(field.value);
      if (str !== null) {
        switch (field.fieldNumber) {
          case 1: model.modelId = str; break;
          case 2: model.displayModelId = str; break;
          case 3: model.displayName = str; break;
          case 4: model.displayNameShort = str; break;
          case 5:
            if (!model.aliases) model.aliases = [];
            model.aliases.push(str);
            break;
        }
      }
    }
  }
  
  return model;
}

// Parse GetUsableModelsResponse
export interface GetUsableModelsResponse {
  models: UsableModel[];
}

export function parseGetUsableModelsResponse(data: Uint8Array): GetUsableModelsResponse {
  const payload = removeEnvelope(data);
  const fields = parseProtoFields(payload);
  const response: GetUsableModelsResponse = { models: [] };
  
  for (const field of fields) {
    // Field 1 = models (repeated UsableModel)
    if (field.fieldNumber === 1 && field.wireType === 2 && field.value instanceof Uint8Array) {
      response.models.push(parseUsableModel(field.value));
    }
  }
  
  return response;
}

// Parse GetDefaultModelForCliResponse
export interface GetDefaultModelForCliResponse {
  model?: UsableModel;
}

export function parseGetDefaultModelForCliResponse(data: Uint8Array): GetDefaultModelForCliResponse {
  const payload = removeEnvelope(data);
  const fields = parseProtoFields(payload);
  const response: GetDefaultModelForCliResponse = {};
  
  for (const field of fields) {
    // Field 1 = model (UsableModel)
    if (field.fieldNumber === 1 && field.wireType === 2 && field.value instanceof Uint8Array) {
      response.model = parseUsableModel(field.value);
      break;
    }
  }
  
  return response;
}

// Format UsableModel for display
export function formatUsableModel(model: UsableModel, indent = ""): string {
  const lines: string[] = [];
  if (model.modelId) lines.push(`${indent}${c.cyan}modelId:${c.reset} ${c.green}${model.modelId}${c.reset}`);
  if (model.displayName) lines.push(`${indent}${c.cyan}displayName:${c.reset} ${model.displayName}`);
  if (model.displayModelId && model.displayModelId !== model.modelId) {
    lines.push(`${indent}${c.cyan}displayModelId:${c.reset} ${model.displayModelId}`);
  }
  if (model.aliases && model.aliases.length > 0) {
    lines.push(`${indent}${c.cyan}aliases:${c.reset} ${model.aliases.join(", ")}`);
  }
  return lines.join("\n");
}

// Detect input format
export type DataFormat = "hex" | "base64" | "binary" | "sse" | "unknown";

export function detectFormat(data: Buffer | Uint8Array | string): DataFormat {
  if (typeof data === "string") {
    const trimmed = data.trim();
    
    // Check for SSE format
    if (trimmed.startsWith("data:") || trimmed.includes("\ndata:")) {
      return "sse";
    }
    
    // Check for hex
    if (/^[0-9a-fA-F\s]+$/.test(trimmed)) {
      return "hex";
    }
    
    // Check for base64
    if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length % 4 === 0) {
      return "base64";
    }
    
    return "unknown";
  }
  
  // Binary data
  return "binary";
}

// Parse SSE data
export function parseSSEData(content: string): Uint8Array[] {
  const results: Uint8Array[] = [];
  const lines = content.split("\n");
  
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        results.push(Buffer.from(data, "base64"));
      } catch {
        // Skip invalid base64
      }
    }
  }
  
  return results;
}

// Analyze file with auto-detection
export async function analyzeFile(
  filePath: string,
  options: { verbose?: boolean; showRaw?: boolean; format?: DataFormat } = {}
): Promise<void> {
  const fs = await import("fs");
  const content = fs.readFileSync(filePath);
  const contentStr = content.toString();
  
  const format = options.format || detectFormat(contentStr);
  
  console.log(`${c.cyan}Analyzing file:${c.reset} ${filePath}`);
  console.log(`${c.cyan}Detected format:${c.reset} ${format}`);
  console.log();
  
  let dataToAnalyze: Uint8Array[];
  
  switch (format) {
    case "sse":
      dataToAnalyze = parseSSEData(contentStr);
      console.log(`${c.cyan}Found ${dataToAnalyze.length} SSE messages${c.reset}\n`);
      break;
    case "hex":
      dataToAnalyze = [Buffer.from(contentStr.replace(/\s/g, ""), "hex")];
      break;
    case "base64":
      dataToAnalyze = [Buffer.from(contentStr.trim(), "base64")];
      break;
    case "binary":
      dataToAnalyze = [content];
      break;
    default:
      console.log(`${c.red}Unable to detect format. Try specifying --format hex|base64|sse|binary${c.reset}`);
      return;
  }
  
  for (let i = 0; i < dataToAnalyze.length; i++) {
    const data = dataToAnalyze[i]!;
    
    if (dataToAnalyze.length > 1) {
      console.log(`${c.yellow}── Message ${i + 1}/${dataToAnalyze.length} (${data.length} bytes) ──${c.reset}`);
    } else {
      console.log(`${c.cyan}Data size:${c.reset} ${data.length} bytes\n`);
    }
    
    // Try to remove envelope and analyze
    const payload = removeEnvelope(data);
    
    // Try to parse as server message first
    const serverMessages = parseAgentServerMessage(payload);
    if (serverMessages.length > 0) {
      console.log(`${c.green}Parsed as AgentServerMessage:${c.reset}`);
      for (const msg of serverMessages) {
        console.log(`  ${c.cyan}${msg.type}:${c.reset} ${msg.summary}`);
        if (options.verbose && Object.keys(msg.details).length > 0) {
          console.log(`    ${c.dim}${JSON.stringify(msg.details)}${c.reset}`);
        }
      }
    } else {
      // Try as client message
      const clientMessage = parseAgentClientMessage(payload);
      if (clientMessage.summary) {
        console.log(`${c.green}Parsed as AgentClientMessage:${c.reset}`);
        console.log(`  ${c.cyan}Type:${c.reset} ${clientMessage.summary}`);
        if (options.verbose) {
          console.log(`  ${c.cyan}Details:${c.reset}`, JSON.stringify(clientMessage.details, null, 2));
        }
      } else {
        // Fall back to raw field analysis
        console.log(`${c.yellow}Raw protobuf fields:${c.reset}`);
        console.log(analyzeProtoFields(payload, 0, options.showRaw));
      }
    }
    
    if (options.showRaw) {
      console.log(`\n${c.dim}Raw hex:${c.reset}`);
      console.log(hexDump(payload));
    }
    
    console.log();
  }
}

// Analyze from stdin
export async function analyzeFromStdin(options: {
  isBase64?: boolean;
  direction?: "request" | "response";
  verbose?: boolean;
  showRaw?: boolean;
  endpoint?: string;
}): Promise<void> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  const input = Buffer.concat(chunks);
  const inputStr = input.toString().trim();
  const format = detectFormat(inputStr);
  
  let data: Uint8Array;
  
  if (options.isBase64 || format === "base64") {
    data = Buffer.from(inputStr, "base64");
  } else if (format === "hex") {
    data = Buffer.from(inputStr.replace(/\s/g, ""), "hex");
  } else if (format === "sse") {
    const messages = parseSSEData(inputStr);
    console.log(`${c.cyan}Analyzing ${messages.length} SSE messages...${c.reset}\n`);
    for (let i = 0; i < messages.length; i++) {
      console.log(`${c.yellow}── Message ${i + 1} ──${c.reset}`);
      const payload = removeEnvelope(messages[i]!);
      const serverMsgs = parseAgentServerMessage(payload);
      for (const msg of serverMsgs) {
        console.log(`  ${c.cyan}${msg.type}:${c.reset} ${msg.summary}`);
        if (options.verbose && Object.keys(msg.details).length > 0) {
          console.log(`    ${c.dim}${JSON.stringify(msg.details)}${c.reset}`);
        }
      }
    }
    return;
  } else {
    data = input;
  }

  console.log(`${c.cyan}════════════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.cyan} Protobuf Analysis${c.reset}`);
  console.log(`${c.cyan}════════════════════════════════════════════════════════════${c.reset}`);
  
  // Check for gRPC-Web envelope
  const hasEnvelope = hasGrpcWebEnvelope(data);
  const payload = removeEnvelope(data);
  
  console.log(`${c.dim}Input: ${data.length} bytes${hasEnvelope ? `, Payload: ${payload.length} bytes (envelope removed)` : " (no envelope)"}${c.reset}\n`);
  
  let parsed = false;
  
  // Try endpoint-specific parsing first
  if (options.direction === "response" && options.endpoint) {
    if (options.endpoint.includes("GetUsableModels")) {
      const response = parseGetUsableModelsResponse(data);
      if (response.models.length > 0) {
        parsed = true;
        console.log(`${c.green}GetUsableModelsResponse:${c.reset} ${response.models.length} models\n`);
        for (let i = 0; i < response.models.length; i++) {
          const model = response.models[i]!;
          console.log(`${c.yellow}[${i + 1}]${c.reset} ${c.green}${model.modelId || "unknown"}${c.reset}`);
          if (model.displayName) console.log(`    ${c.dim}Display: ${model.displayName}${c.reset}`);
          if (model.aliases && model.aliases.length > 0) {
            console.log(`    ${c.dim}Aliases: ${model.aliases.join(", ")}${c.reset}`);
          }
        }
      }
    } else if (options.endpoint.includes("GetDefaultModelForCli")) {
      const response = parseGetDefaultModelForCliResponse(data);
      if (response.model) {
        parsed = true;
        console.log(`${c.green}GetDefaultModelForCliResponse:${c.reset}`);
        console.log(formatUsableModel(response.model, "  "));
      }
    }
  }
  
  // Try generic message parsing
  if (!parsed && options.direction === "response") {
    const messages = parseAgentServerMessage(payload);
    if (messages.length > 0) {
      parsed = true;
      console.log(`${c.green}Parsed as AgentServerMessage:${c.reset}`);
      for (const msg of messages) {
        console.log(`  ${c.cyan}${msg.type}:${c.reset} ${msg.summary}`);
        if (options.verbose && Object.keys(msg.details).length > 0) {
          console.log(`    ${c.dim}${JSON.stringify(msg.details)}${c.reset}`);
        }
      }
    }
  } else if (!parsed && options.direction === "request") {
    const msg = parseAgentClientMessage(payload);
    if (msg.summary) {
      parsed = true;
      console.log(`${c.green}Parsed as AgentClientMessage:${c.reset}`);
      console.log(`  ${c.cyan}Type:${c.reset} ${msg.summary}`);
      if (options.verbose && Object.keys(msg.details).length > 0) {
        console.log(`  ${c.cyan}Details:${c.reset} ${JSON.stringify(msg.details, null, 2)}`);
      }
    }
  }
  
  // Fallback to generic protobuf field analysis
  if (!parsed) {
    console.log(`${c.yellow}Raw protobuf fields:${c.reset}`);
    console.log(analyzeProtoFields(payload, 0, options.showRaw));
  }
  
  if (options.showRaw) {
    console.log(`\n${c.dim}Raw hex dump:${c.reset}`);
    console.log(hexDump(payload));
  }
}
