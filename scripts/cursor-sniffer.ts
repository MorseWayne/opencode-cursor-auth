#!/usr/bin/env bun
/**
 * Cursor Traffic Sniffer & Analyzer
 *
 * A proxy tool that intercepts and analyzes communication between
 * Cursor client and Cursor API servers.
 *
 * Usage:
 *   bun scripts/cursor-sniffer.ts [options]
 *
 * Options:
 *   --port <port>      Proxy port (default: 8888)
 *   --output <file>    Save captured traffic to file
 *   --verbose          Show full message content
 *   --raw              Show raw hex data
 *
 * After starting, configure Cursor to use this proxy:
 *   export HTTP_PROXY=http://127.0.0.1:8888
 *   export HTTPS_PROXY=http://127.0.0.1:8888
 *
 * Or use the built-in debug mode to analyze local plugin traffic.
 */

import { parseProtoFields, type ParsedField } from "../src/lib/api/proto/decoding";
import { parseInteractionUpdate } from "../src/lib/api/proto/interaction";
import { parseExecServerMessage } from "../src/lib/api/proto/exec";
import { parseKvServerMessage } from "../src/lib/api/proto/kv";
import { parseToolCallStartedUpdate } from "../src/lib/api/proto/tool-calls";
import type { ExecRequest } from "../src/lib/api/proto/types";

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgRed: "\x1b[41m",
};

const c = colors;

// Parse command line arguments
const args = process.argv.slice(2);
let port = 8888;
let outputFile: string | null = null;
let verbose = false;
let showRaw = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--port" && args[i + 1]) {
    port = parseInt(args[++i]!, 10);
  } else if (arg === "--output" && args[i + 1]) {
    outputFile = args[++i]!;
  } else if (arg === "--verbose" || arg === "-v") {
    verbose = true;
  } else if (arg === "--raw" || arg === "-r") {
    showRaw = true;
  } else if (arg === "--help" || arg === "-h") {
    console.log(`
${c.bright}Cursor Traffic Sniffer & Analyzer${c.reset}

${c.cyan}Usage:${c.reset}
  bun scripts/cursor-sniffer.ts [options]

${c.cyan}Options:${c.reset}
  --port <port>      Proxy port (default: 8888)
  --output <file>    Save captured traffic to file
  --verbose, -v      Show full message content
  --raw, -r          Show raw hex data
  --help, -h         Show this help

${c.cyan}Example:${c.reset}
  # Start the sniffer
  bun scripts/cursor-sniffer.ts --port 8888 --verbose

  # In another terminal, set proxy and run Cursor
  export HTTP_PROXY=http://127.0.0.1:8888
  export HTTPS_PROXY=http://127.0.0.1:8888
  cursor .

${c.cyan}Direct Analysis Mode:${c.reset}
  You can also analyze captured data directly:

  # Analyze a hex string
  echo "0a05..." | bun scripts/cursor-sniffer.ts --analyze

  # Analyze a base64 string
  echo "CgVo..." | bun scripts/cursor-sniffer.ts --analyze-base64
`);
    process.exit(0);
  }
}

// Track request/response pairs
interface CapturedRequest {
  id: string;
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
  timestamp: number;
}

interface CapturedResponse {
  requestId: string;
  status: number;
  headers: Record<string, string>;
  chunks: Uint8Array[];
  timestamp: number;
}

const capturedRequests = new Map<string, CapturedRequest>();
const capturedResponses = new Map<string, CapturedResponse>();
let requestCounter = 0;

// Logging utilities
function log(message: string) {
  const timestamp = new Date().toISOString().slice(11, 23);
  console.log(`${c.dim}[${timestamp}]${c.reset} ${message}`);
}

function logSection(title: string, color: string = c.cyan) {
  console.log(`\n${color}${"═".repeat(60)}${c.reset}`);
  console.log(`${color}${c.bright} ${title}${c.reset}`);
  console.log(`${color}${"═".repeat(60)}${c.reset}`);
}

function logSubSection(title: string) {
  console.log(`\n${c.yellow}── ${title} ──${c.reset}`);
}

function hexDump(data: Uint8Array, maxBytes = 128): string {
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

// Protobuf analysis
function analyzeProtoFields(data: Uint8Array, depth = 0): string {
  const indent = "  ".repeat(depth);
  let result = "";

  try {
    const fields = parseProtoFields(data);

    for (const field of fields) {
      const fieldNum = field.fieldNumber;
      const wireType = field.wireType;

      result += `${indent}${c.cyan}field ${fieldNum}${c.reset} (wire=${wireType}): `;

      if (wireType === 0) {
        // Varint
        result += `${c.yellow}${field.value}${c.reset}\n`;
      } else if (wireType === 2 && field.value instanceof Uint8Array) {
        // Length-delimited
        const bytes = field.value;

        // Try to decode as string
        const maybeString = tryDecodeString(bytes);
        if (maybeString && maybeString.length <= 100) {
          result += `${c.green}"${maybeString}"${c.reset}\n`;
        } else if (maybeString && maybeString.length > 100) {
          result += `${c.green}"${maybeString.slice(0, 100)}..."${c.reset} (${bytes.length} bytes)\n`;
        } else {
          // Try to parse as nested message
          const nested = tryParseNested(bytes);
          if (nested) {
            result += `${c.magenta}[nested message]${c.reset}\n`;
            result += analyzeProtoFields(bytes, depth + 1);
          } else {
            result += `${c.dim}[${bytes.length} bytes]${c.reset}\n`;
            if (showRaw && bytes.length <= 64) {
              result += hexDump(bytes, 64);
            }
          }
        }
      } else if (wireType === 1 && field.value instanceof Uint8Array) {
        // 64-bit
        result += `${c.yellow}[64-bit: ${Buffer.from(field.value).toString("hex")}]${c.reset}\n`;
      } else if (wireType === 5 && field.value instanceof Uint8Array) {
        // 32-bit
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

function tryDecodeString(bytes: Uint8Array): string | null {
  try {
    const str = new TextDecoder().decode(bytes);
    // Check if it looks like valid text
    if (/^[\x20-\x7E\n\r\t]*$/.test(str) && str.length > 0) {
      return str;
    }
    return null;
  } catch {
    return null;
  }
}

function tryParseNested(bytes: Uint8Array): boolean {
  try {
    const fields = parseProtoFields(bytes);
    return fields.length > 0 && fields.every((f) => f.fieldNumber > 0 && f.fieldNumber < 100);
  } catch {
    return false;
  }
}

// Message type detection and parsing
interface ParsedMessage {
  type: string;
  summary: string;
  details: Record<string, unknown>;
}

function parseAgentClientMessage(data: Uint8Array): ParsedMessage {
  const fields = parseProtoFields(data);
  const result: ParsedMessage = {
    type: "AgentClientMessage",
    summary: "",
    details: {},
  };

  for (const field of fields) {
    if (field.fieldNumber === 1 && field.wireType === 2 && field.value instanceof Uint8Array) {
      // run_request (AgentRunRequest)
      result.summary = "AgentRunRequest";
      result.details = parseAgentRunRequest(field.value);
    } else if (field.fieldNumber === 2 && field.wireType === 2 && field.value instanceof Uint8Array) {
      // exec_client_message
      result.summary = "ExecClientMessage (tool result)";
      result.details = parseExecClientMessage(field.value);
    } else if (field.fieldNumber === 3 && field.wireType === 2 && field.value instanceof Uint8Array) {
      // kv_client_message
      result.summary = "KvClientMessage";
      result.details = { raw: Buffer.from(field.value).toString("hex").slice(0, 64) };
    } else if (field.fieldNumber === 4 && field.wireType === 2 && field.value instanceof Uint8Array) {
      // conversation_action
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
      // action (ConversationAction)
      result.action = parseConversationAction(field.value);
    } else if (field.fieldNumber === 3 && field.wireType === 2 && field.value instanceof Uint8Array) {
      // model_details
      result.model = parseModelDetails(field.value);
    } else if (field.fieldNumber === 5 && field.wireType === 2 && field.value instanceof Uint8Array) {
      // conversation_id
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
      // user_message_action
      result.userMessage = parseUserMessageAction(field.value);
    } else if (field.fieldNumber === 2 && field.wireType === 2) {
      // resume_action
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
      // user_message
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
    // Other fields contain tool results
  }

  return result;
}

function parseAgentServerMessage(data: Uint8Array): ParsedMessage[] {
  const fields = parseProtoFields(data);
  const results: ParsedMessage[] = [];

  for (const field of fields) {
    if (field.fieldNumber === 1 && field.wireType === 2 && field.value instanceof Uint8Array) {
      // interaction_update
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
      // exec_server_message
      const exec = parseExecServerMessage(field.value);
      if (exec) {
        results.push({
          type: "ExecServerMessage",
          summary: exec.type,
          details: exec as unknown as Record<string, unknown>,
        });
      }
    } else if (field.fieldNumber === 3 && field.wireType === 2) {
      // checkpoint
      results.push({
        type: "Checkpoint",
        summary: "conversation_checkpoint",
        details: {},
      });
    } else if (field.fieldNumber === 4 && field.wireType === 2 && field.value instanceof Uint8Array) {
      // kv_server_message
      const kv = parseKvServerMessage(field.value);
      results.push({
        type: "KvServerMessage",
        summary: kv.messageType,
        details: { id: kv.id },
      });
    } else if (field.fieldNumber === 7 && field.wireType === 2) {
      // interaction_query
      results.push({
        type: "InteractionQuery",
        summary: "query",
        details: {},
      });
    }
  }

  return results;
}

// Remove Connect envelope (5 bytes: 1 byte flags + 4 bytes length)
function removeEnvelope(data: Uint8Array): Uint8Array {
  if (data.length < 5) return data;
  return data.slice(5);
}

// Analyze a single message
function analyzeMessage(data: Uint8Array, direction: "request" | "response", endpoint: string): void {
  const payload = removeEnvelope(data);

  if (direction === "request") {
    logSubSection(`${c.bgGreen}${c.bright} REQUEST ${c.reset} ${endpoint}`);

    if (endpoint.includes("AgentService/RunSSE") || endpoint.includes("BidiService/RunSSE")) {
      // BidiRequestId message
      console.log(`  ${c.cyan}Type:${c.reset} BidiRequestId`);
      const fields = parseProtoFields(payload);
      for (const f of fields) {
        if (f.fieldNumber === 1 && f.wireType === 2 && f.value instanceof Uint8Array) {
          console.log(`  ${c.cyan}RequestId:${c.reset} ${new TextDecoder().decode(f.value)}`);
        }
      }
    } else if (endpoint.includes("BidiAppend")) {
      // BidiAppendRequest
      console.log(`  ${c.cyan}Type:${c.reset} BidiAppendRequest`);
      const fields = parseProtoFields(payload);
      for (const f of fields) {
        if (f.fieldNumber === 1 && f.wireType === 2 && f.value instanceof Uint8Array) {
          // data (hex-encoded)
          const hexData = new TextDecoder().decode(f.value);
          const innerData = Buffer.from(hexData, "hex");
          console.log(`  ${c.cyan}Data:${c.reset} ${innerData.length} bytes`);

          const parsed = parseAgentClientMessage(innerData);
          console.log(`  ${c.cyan}Message:${c.reset} ${parsed.summary}`);
          if (verbose) {
            console.log(`  ${c.cyan}Details:${c.reset}`, JSON.stringify(parsed.details, null, 2));
          }
        }
        if (f.fieldNumber === 2 && f.wireType === 2 && f.value instanceof Uint8Array) {
          console.log(`  ${c.cyan}RequestId:${c.reset} ${new TextDecoder().decode(f.value)}`);
        }
        if (f.fieldNumber === 3 && f.wireType === 0) {
          console.log(`  ${c.cyan}Seqno:${c.reset} ${f.value}`);
        }
      }
    } else {
      // Generic request
      console.log(`  ${c.cyan}Raw fields:${c.reset}`);
      console.log(analyzeProtoFields(payload, 1));
    }

    if (showRaw) {
      console.log(`\n  ${c.dim}Raw data:${c.reset}`);
      console.log(hexDump(payload));
    }
  } else {
    // Response
    logSubSection(`${c.bgBlue}${c.bright} RESPONSE ${c.reset} ${endpoint}`);

    const messages = parseAgentServerMessage(payload);

    for (const msg of messages) {
      const summaryColor =
        msg.summary === "text"
          ? c.green
          : msg.summary === "thinking"
            ? c.magenta
            : msg.summary.includes("tool")
              ? c.yellow
              : c.cyan;

      console.log(`  ${c.cyan}${msg.type}:${c.reset} ${summaryColor}${msg.summary}${c.reset}`);

      if (verbose && Object.keys(msg.details).length > 0) {
        console.log(`    ${c.dim}${JSON.stringify(msg.details)}${c.reset}`);
      }
    }

    if (messages.length === 0) {
      console.log(`  ${c.dim}[no recognized messages]${c.reset}`);
      if (verbose) {
        console.log(analyzeProtoFields(payload, 1));
      }
    }

    if (showRaw) {
      console.log(`\n  ${c.dim}Raw data:${c.reset}`);
      console.log(hexDump(payload));
    }
  }
}

// SSE chunk parser
function parseSSEChunk(chunk: string): Uint8Array | null {
  const lines = chunk.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const data = line.slice(6).trim();
      if (data === "[DONE]") return null;
      try {
        return Buffer.from(data, "base64");
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Interactive analysis mode
async function interactiveMode(): Promise<void> {
  logSection("Cursor Traffic Analyzer - Interactive Mode", c.magenta);
  console.log(`
${c.cyan}Commands:${c.reset}
  ${c.yellow}hex <hexstring>${c.reset}   - Analyze hex-encoded protobuf
  ${c.yellow}b64 <base64>${c.reset}      - Analyze base64-encoded protobuf
  ${c.yellow}file <path>${c.reset}       - Analyze file content
  ${c.yellow}q${c.reset}                 - Quit

${c.cyan}Example:${c.reset}
  hex 0a05...
  b64 CgV...
`);

  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question(`${c.green}>${c.reset} `, async (input) => {
      const trimmed = input.trim();

      if (!trimmed || trimmed === "q" || trimmed === "quit") {
        rl.close();
        return;
      }

      try {
        if (trimmed.startsWith("hex ")) {
          const hexData = trimmed.slice(4).replace(/\s/g, "");
          const data = Buffer.from(hexData, "hex");
          console.log(`\n${c.cyan}Analyzing ${data.length} bytes...${c.reset}\n`);
          console.log(analyzeProtoFields(data, 0));
        } else if (trimmed.startsWith("b64 ")) {
          const b64Data = trimmed.slice(4).trim();
          const data = Buffer.from(b64Data, "base64");
          console.log(`\n${c.cyan}Analyzing ${data.length} bytes...${c.reset}\n`);
          console.log(analyzeProtoFields(data, 0));
        } else if (trimmed.startsWith("file ")) {
          const filePath = trimmed.slice(5).trim();
          const fs = await import("fs");
          const content = fs.readFileSync(filePath);
          console.log(`\n${c.cyan}Analyzing ${content.length} bytes from ${filePath}...${c.reset}\n`);
          console.log(analyzeProtoFields(content, 0));
        } else {
          // Try to auto-detect format
          if (/^[0-9a-fA-F]+$/.test(trimmed)) {
            const data = Buffer.from(trimmed, "hex");
            console.log(`\n${c.cyan}Analyzing ${data.length} bytes (hex)...${c.reset}\n`);
            console.log(analyzeProtoFields(data, 0));
          } else if (/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
            const data = Buffer.from(trimmed, "base64");
            console.log(`\n${c.cyan}Analyzing ${data.length} bytes (base64)...${c.reset}\n`);
            console.log(analyzeProtoFields(data, 0));
          } else {
            console.log(`${c.red}Unknown command. Type 'q' to quit.${c.reset}`);
          }
        }
      } catch (err) {
        console.log(`${c.red}Error: ${err}${c.reset}`);
      }

      prompt();
    });
  };

  prompt();
}

// Analyze from stdin
async function analyzeFromStdin(isBase64: boolean): Promise<void> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  const input = Buffer.concat(chunks).toString().trim();
  const data = isBase64 ? Buffer.from(input, "base64") : Buffer.from(input, "hex");

  logSection("Protobuf Analysis", c.cyan);
  console.log(`${c.dim}Input: ${data.length} bytes${c.reset}\n`);
  console.log(analyzeProtoFields(data, 0));
}

// HTTP Proxy server
async function startProxyServer(): Promise<void> {
  logSection("Cursor Traffic Sniffer", c.green);
  console.log(`
${c.cyan}Proxy Settings:${c.reset}
  Port: ${c.yellow}${port}${c.reset}
  Verbose: ${c.yellow}${verbose}${c.reset}
  Show Raw: ${c.yellow}${showRaw}${c.reset}

${c.cyan}To use this proxy with Cursor:${c.reset}
  ${c.dim}export HTTP_PROXY=http://127.0.0.1:${port}${c.reset}
  ${c.dim}export HTTPS_PROXY=http://127.0.0.1:${port}${c.reset}
  ${c.dim}cursor .${c.reset}

${c.yellow}Note:${c.reset} For HTTPS interception, you'll need to set up
      certificate trust. Consider using mitmproxy instead.

${c.cyan}Listening for connections...${c.reset}
`);

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const reqId = `req-${++requestCounter}`;

      // Log incoming request
      log(`${c.green}→${c.reset} ${req.method} ${url.pathname}`);

      // Check if this is a Cursor API request
      const isCursorAPI = url.hostname.includes("cursor.sh");

      if (isCursorAPI) {
        logSection(`Request #${requestCounter}`, c.green);
        console.log(`  ${c.cyan}Method:${c.reset} ${req.method}`);
        console.log(`  ${c.cyan}URL:${c.reset} ${url.href}`);

        // Log relevant headers
        const authHeader = req.headers.get("authorization");
        if (authHeader) {
          console.log(`  ${c.cyan}Auth:${c.reset} ${authHeader.slice(0, 20)}...`);
        }

        const checksum = req.headers.get("x-cursor-checksum");
        if (checksum) {
          console.log(`  ${c.cyan}Checksum:${c.reset} ${checksum.slice(0, 20)}...`);
        }

        // Read and analyze request body
        if (req.body) {
          const body = await req.arrayBuffer();
          const bodyBytes = new Uint8Array(body);

          if (bodyBytes.length > 0) {
            analyzeMessage(bodyBytes, "request", url.pathname);
          }

          // Forward the request
          const targetUrl = url.href;
          const headers = new Headers(req.headers);

          try {
            const response = await fetch(targetUrl, {
              method: req.method,
              headers,
              body: bodyBytes,
            });

            // Handle SSE response
            if (response.headers.get("content-type")?.includes("event-stream")) {
              logSubSection(`${c.bgBlue}${c.bright} SSE STREAM ${c.reset}`);

              // We can't easily intercept SSE in Bun's simple HTTP mode
              // For full SSE interception, use mitmproxy
              console.log(`  ${c.yellow}SSE stream detected - forwarding...${c.reset}`);
              console.log(`  ${c.dim}(Use mitmproxy for full SSE interception)${c.reset}`);

              return response;
            }

            // Regular response
            const responseBody = await response.arrayBuffer();
            const responseBytes = new Uint8Array(responseBody);

            if (responseBytes.length > 0) {
              analyzeMessage(responseBytes, "response", url.pathname);
            }

            return new Response(responseBytes, {
              status: response.status,
              headers: response.headers,
            });
          } catch (err) {
            log(`${c.red}Error forwarding request: ${err}${c.reset}`);
            return new Response("Proxy Error", { status: 502 });
          }
        }
      }

      // For non-Cursor requests, just forward
      try {
        const response = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
        });
        return response;
      } catch {
        return new Response("Proxy Error", { status: 502 });
      }
    },
  });

  log(`Proxy server started on port ${server.port}`);
}

// Main entry point
async function main(): Promise<void> {
  // Check for stdin analysis mode
  if (args.includes("--analyze")) {
    await analyzeFromStdin(false);
    return;
  }

  if (args.includes("--analyze-base64")) {
    await analyzeFromStdin(true);
    return;
  }

  // Check for interactive mode
  if (args.includes("--interactive") || args.includes("-i")) {
    await interactiveMode();
    return;
  }

  // Default: start proxy server
  await startProxyServer();
}

main().catch((err) => {
  console.error(`${c.red}Fatal error:${c.reset}`, err);
  process.exit(1);
});
