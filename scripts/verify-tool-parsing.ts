/**
 * Tool Call Parsing Verification Script
 *
 * This script verifies the correctness of tool call parsing by:
 * 1. Using known test vectors
 * 2. Parsing captured raw data from mitmproxy
 * 3. Comparing Python vs TypeScript parsing results
 *
 * Usage:
 *   bun scripts/verify-tool-parsing.ts                       # Run all tests
 *   bun scripts/verify-tool-parsing.ts --schema              # Print tool schemas
 *   bun scripts/verify-tool-parsing.ts --hex <hex_data>      # Parse hex string
 *   bun scripts/verify-tool-parsing.ts --file <path>         # Parse binary file
 *   bun scripts/verify-tool-parsing.ts --verify <dump.json>  # Verify against mitmproxy dump
 */

import {
  parseToolCall,
  parseToolCallStartedUpdate,
  parsePartialToolCallUpdate,
  TOOL_FIELD_MAP,
  TOOL_ARG_SCHEMA,
} from "../src/lib/api/proto/tool-calls";
import { parseProtoFields } from "../src/lib/api/proto/decoding";
import * as fs from "fs";

// --- Color helpers ---
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

function log(msg: string, color?: keyof typeof colors) {
  if (color) {
    console.log(`${colors[color]}${msg}${colors.reset}`);
  } else {
    console.log(msg);
  }
}

function success(msg: string) {
  log(`✓ ${msg}`, "green");
}

function failure(msg: string) {
  log(`✗ ${msg}`, "red");
}

function info(msg: string) {
  log(`ℹ ${msg}`, "cyan");
}

function section(title: string) {
  console.log();
  log(`═══════════════════════════════════════════════════════════════`, "dim");
  log(` ${title}`, "bold");
  log(`═══════════════════════════════════════════════════════════════`, "dim");
}

// --- Hex utilities ---
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.replace(/\s+/g, "").replace(/0x/gi, "");
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array, limit = 64): string {
  const hex = Array.from(bytes.slice(0, limit))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
  return bytes.length > limit ? `${hex} ... (${bytes.length} bytes total)` : hex;
}

// --- Test vectors ---
interface TestCase {
  name: string;
  description: string;
  data: Uint8Array;
  expectedTool?: string;
  expectedArgs?: Record<string, unknown>;
}

function buildProtoString(fieldNum: number, value: string): Uint8Array {
  const valueBytes = new TextEncoder().encode(value);
  const tag = (fieldNum << 3) | 2;
  const result = new Uint8Array(1 + 1 + valueBytes.length);
  result[0] = tag;
  result[1] = valueBytes.length;
  result.set(valueBytes, 2);
  return result;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function wrapInLengthDelimited(fieldNum: number, inner: Uint8Array): Uint8Array {
  const tag = (fieldNum << 3) | 2;
  const result = new Uint8Array(1 + 1 + inner.length);
  result[0] = tag;
  result[1] = inner.length;
  result.set(inner, 2);
  return result;
}

function createTestCases(): TestCase[] {
  const cases: TestCase[] = [];

  // Test 1: Shell tool call (bash)
  const shellArgs = concatBytes(
    buildProtoString(1, "ls -la"),
    buildProtoString(2, "List directory contents")
  );
  const shellToolCall = wrapInLengthDelimited(1, shellArgs);

  cases.push({
    name: "Shell Tool (bash)",
    description: "Simple bash command: ls -la",
    data: shellToolCall,
    expectedTool: "bash",
    expectedArgs: { command: "ls -la", description: "List directory contents" },
  });

  // Test 2: Read tool call
  const readArgs = buildProtoString(1, "/home/user/file.txt");
  const readToolCall = wrapInLengthDelimited(8, readArgs);

  cases.push({
    name: "Read Tool",
    description: "Read file: /home/user/file.txt",
    data: readToolCall,
    expectedTool: "read",
    expectedArgs: { filePath: "/home/user/file.txt" },
  });

  // Test 3: Grep tool call
  const grepArgs = concatBytes(
    buildProtoString(1, "TODO"),
    buildProtoString(2, "./src")
  );
  const grepToolCall = wrapInLengthDelimited(5, grepArgs);

  cases.push({
    name: "Grep Tool",
    description: "Search for TODO in ./src",
    data: grepToolCall,
    expectedTool: "grep",
    expectedArgs: { pattern: "TODO", path: "./src" },
  });

  // Test 4: Edit tool call
  const editArgs = concatBytes(
    buildProtoString(1, "file.ts"),
    buildProtoString(2, "old code"),
    buildProtoString(3, "new code")
  );
  const editToolCall = wrapInLengthDelimited(12, editArgs);

  cases.push({
    name: "Edit Tool",
    description: "String replacement edit",
    data: editToolCall,
    expectedTool: "edit",
    expectedArgs: { filePath: "file.ts", oldString: "old code", newString: "new code" },
  });

  return cases;
}

function runTestCase(testCase: TestCase): boolean {
  console.log();
  log(`Test: ${testCase.name}`, "yellow");
  log(`  ${testCase.description}`, "dim");
  log(`  Data: ${bytesToHex(testCase.data, 32)}`, "dim");

  try {
    const result = parseToolCall(testCase.data);

    console.log(`  Parsed:`);
    console.log(`    Tool Type: ${result.toolType}`);
    console.log(`    Tool Name: ${result.name}`);
    console.log(`    Arguments: ${JSON.stringify(result.arguments, null, 2).replace(/\n/g, "\n    ")}`);

    let passed = true;

    if (testCase.expectedTool) {
      if (result.name === testCase.expectedTool) {
        success(`Tool name matches: ${result.name}`);
      } else {
        failure(`Tool name mismatch: expected '${testCase.expectedTool}', got '${result.name}'`);
        passed = false;
      }
    }

    if (testCase.expectedArgs) {
      for (const [key, expected] of Object.entries(testCase.expectedArgs)) {
        const actual = result.arguments[key];
        if (actual === expected) {
          success(`Argument '${key}' matches: ${actual}`);
        } else {
          failure(`Argument '${key}' mismatch: expected '${expected}', got '${actual}'`);
          passed = false;
        }
      }
    }

    return passed;
  } catch (err) {
    failure(`Parse error: ${err}`);
    return false;
  }
}

function runToolCallStartedTest(): boolean {
  console.log();
  log(`Test: ToolCallStartedUpdate Parsing`, "yellow");

  const shellArgs = concatBytes(
    buildProtoString(1, "echo hello"),
    buildProtoString(2, "Print hello")
  );
  const shellToolCall = wrapInLengthDelimited(1, shellArgs);

  const toolCallStarted = concatBytes(
    buildProtoString(1, "call_abc123"),
    wrapInLengthDelimited(2, shellToolCall),
    buildProtoString(3, "model_xyz789")
  );

  log(`  Data: ${bytesToHex(toolCallStarted, 48)}`, "dim");

  try {
    const result = parseToolCallStartedUpdate(toolCallStarted);

    console.log(`  Parsed:`);
    console.log(`    Call ID: ${result.callId}`);
    console.log(`    Model Call ID: ${result.modelCallId}`);
    console.log(`    Tool Call: ${JSON.stringify(result.toolCall, null, 2).replace(/\n/g, "\n    ")}`);

    let passed = true;

    if (result.callId === "call_abc123") {
      success(`Call ID matches`);
    } else {
      failure(`Call ID mismatch: expected 'call_abc123', got '${result.callId}'`);
      passed = false;
    }

    if (result.modelCallId === "model_xyz789") {
      success(`Model Call ID matches`);
    } else {
      failure(`Model Call ID mismatch`);
      passed = false;
    }

    if (result.toolCall?.name === "bash") {
      success(`Nested tool name matches: bash`);
    } else {
      failure(`Nested tool name mismatch`);
      passed = false;
    }

    return passed;
  } catch (err) {
    failure(`Parse error: ${err}`);
    return false;
  }
}

function runPartialToolCallTest(): boolean {
  console.log();
  log(`Test: PartialToolCallUpdate Parsing`, "yellow");

  const partialUpdate = concatBytes(
    buildProtoString(1, "call_partial_001"),
    buildProtoString(3, '{"command": "npm install"}'),
    buildProtoString(4, "model_partial_002")
  );

  log(`  Data: ${bytesToHex(partialUpdate, 48)}`, "dim");

  try {
    const result = parsePartialToolCallUpdate(partialUpdate);

    console.log(`  Parsed:`);
    console.log(`    Call ID: ${result.callId}`);
    console.log(`    Model Call ID: ${result.modelCallId}`);
    console.log(`    Args Delta: ${result.argsTextDelta}`);

    let passed = true;

    if (result.callId === "call_partial_001") {
      success(`Call ID matches`);
    } else {
      failure(`Call ID mismatch`);
      passed = false;
    }

    if (result.argsTextDelta === '{"command": "npm install"}') {
      success(`Args delta matches`);
    } else {
      failure(`Args delta mismatch: got '${result.argsTextDelta}'`);
      passed = false;
    }

    return passed;
  } catch (err) {
    failure(`Parse error: ${err}`);
    return false;
  }
}

// --- Schema inspection ---
function printSchema() {
  section("Tool Field Mapping (TOOL_FIELD_MAP)");
  console.log();
  console.log("  Field Number → Tool Type");
  console.log("  ─────────────────────────────────────────");

  const sortedFields = Object.entries(TOOL_FIELD_MAP).sort(
    ([a], [b]) => parseInt(a) - parseInt(b)
  );

  for (const [fieldNum, info] of sortedFields) {
    console.log(`  ${fieldNum.padStart(3)} → ${info.name.padEnd(20)} (${info.type})`);
  }

  section("Tool Argument Schemas (TOOL_ARG_SCHEMA)");
  console.log();

  for (const [toolType, schema] of Object.entries(TOOL_ARG_SCHEMA)) {
    const toolInfo = Object.values(TOOL_FIELD_MAP).find((t) => t.type === toolType);
    console.log(`  ${toolInfo?.name || toolType}:`);
    for (const [fieldNum, argName] of Object.entries(schema)) {
      console.log(`    field ${fieldNum} → ${argName}`);
    }
    console.log();
  }
}

// --- Parse from hex string ---
function parseFromHex(hexString: string) {
  section("Parsing Hex Data");

  const data = hexToBytes(hexString);
  info(`Input: ${data.length} bytes`);
  log(`Hex: ${bytesToHex(data)}`, "dim");

  console.log();
  log("Raw proto fields:", "yellow");

  const fields = parseProtoFields(data);
  for (const field of fields) {
    const wireTypeName = ["varint", "64-bit", "len-delim", "start", "end", "32-bit"][field.wireType] || "?";
    if (field.value instanceof Uint8Array) {
      console.log(`  field ${field.fieldNumber} (${wireTypeName}): ${bytesToHex(field.value, 32)}`);
    } else {
      console.log(`  field ${field.fieldNumber} (${wireTypeName}): ${field.value}`);
    }
  }

  console.log();
  log("As ToolCall:", "yellow");
  const toolCall = parseToolCall(data);
  console.log(`  ${JSON.stringify(toolCall, null, 2).replace(/\n/g, "\n  ")}`);

  console.log();
  log("As ToolCallStartedUpdate:", "yellow");
  const started = parseToolCallStartedUpdate(data);
  console.log(`  ${JSON.stringify(started, null, 2).replace(/\n/g, "\n  ")}`);

  console.log();
  log("As PartialToolCallUpdate:", "yellow");
  const partial = parsePartialToolCallUpdate(data);
  console.log(`  ${JSON.stringify(partial, null, 2).replace(/\n/g, "\n  ")}`);
}

// --- Parse from binary file ---
function parseFromFile(filePath: string) {
  section(`Parsing File: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    failure(`File not found: ${filePath}`);
    return;
  }

  const content = fs.readFileSync(filePath);
  const data = new Uint8Array(content);

  info(`File size: ${data.length} bytes`);

  if (data.length >= 5) {
    const compressFlag = data[0];
    const msgLen = (data[1] << 24) | (data[2] << 16) | (data[3] << 8) | data[4];
    info(`Possible gRPC frame: compressed=${compressFlag}, length=${msgLen}`);

    if (data.length >= 5 + msgLen) {
      log("Parsing payload after gRPC header...", "cyan");
      const payload = data.slice(5, 5 + msgLen);
      parseFromHex(Array.from(payload).map((b) => b.toString(16).padStart(2, "0")).join(""));
      return;
    }
  }

  parseFromHex(Array.from(data).map((b) => b.toString(16).padStart(2, "0")).join(""));
}

// --- Dump file entry (from mitmproxy) ---
interface DumpEntry {
  timestamp: string;
  request_id: string;
  endpoint: string;
  event_type: string;
  raw_hex: string;
  python_parsed: {
    tool_name?: string;
    call_id?: string;
    model_call_id?: string;
    args?: Record<string, unknown>;
    args_delta?: string;
  };
}

// --- Verify against mitmproxy dump ---
function verifyDump(dumpFile: string) {
  section(`Verifying Tool Call Dump: ${dumpFile}`);

  if (!fs.existsSync(dumpFile)) {
    failure(`Dump file not found: ${dumpFile}`);
    return;
  }

  let entries: DumpEntry[];
  try {
    const content = fs.readFileSync(dumpFile, "utf-8");
    entries = JSON.parse(content);
  } catch (err) {
    failure(`Failed to parse JSON: ${err}`);
    return;
  }

  info(`Found ${entries.length} tool call entries`);
  console.log();

  let passed = 0;
  let failed = 0;

  for (const entry of entries) {
    console.log(`${colors.dim}─────────────────────────────────────────────${colors.reset}`);
    log(`Entry: ${entry.event_type} @ ${entry.timestamp}`, "yellow");
    log(`  Endpoint: ${entry.endpoint}`, "dim");
    log(`  Hex: ${entry.raw_hex.substring(0, 60)}${entry.raw_hex.length > 60 ? "..." : ""}`, "dim");

    // Parse with TypeScript
    const data = hexToBytes(entry.raw_hex);
    let tsResult: ReturnType<typeof parseToolCallStartedUpdate> | ReturnType<typeof parsePartialToolCallUpdate>;

    if (entry.event_type === "partial_tool_call") {
      tsResult = parsePartialToolCallUpdate(data);
    } else {
      tsResult = parseToolCallStartedUpdate(data);
    }

    const pyParsed = entry.python_parsed;

    console.log(`\n  ${colors.cyan}Python parsed:${colors.reset}`);
    console.log(`    tool_name: ${pyParsed.tool_name}`);
    console.log(`    call_id: ${pyParsed.call_id || "(none)"}`);
    if (pyParsed.args && Object.keys(pyParsed.args).length > 0) {
      console.log(`    args: ${JSON.stringify(pyParsed.args)}`);
    }
    if (pyParsed.args_delta) {
      console.log(`    args_delta: ${pyParsed.args_delta.substring(0, 100)}${pyParsed.args_delta.length > 100 ? "..." : ""}`);
    }

    console.log(`\n  ${colors.cyan}TypeScript parsed:${colors.reset}`);
    console.log(`    tool_name: ${tsResult.toolCall?.name || "(none)"}`);
    console.log(`    call_id: ${tsResult.callId || "(none)"}`);
    if (tsResult.toolCall?.arguments && Object.keys(tsResult.toolCall.arguments).length > 0) {
      console.log(`    args: ${JSON.stringify(tsResult.toolCall.arguments)}`);
    }
    if ("argsTextDelta" in tsResult && tsResult.argsTextDelta) {
      console.log(`    argsTextDelta: ${tsResult.argsTextDelta.substring(0, 100)}${tsResult.argsTextDelta.length > 100 ? "..." : ""}`);
    }

    // Compare results
    let entryPassed = true;

    // Compare tool name
    const pyToolName = pyParsed.tool_name || "unknown";
    const tsToolName = tsResult.toolCall?.name || "unknown";
    if (pyToolName === tsToolName) {
      success(`Tool name matches: ${pyToolName}`);
    } else {
      failure(`Tool name mismatch: Python='${pyToolName}', TypeScript='${tsToolName}'`);
      entryPassed = false;
    }

    // Compare call_id
    const pyCallId = pyParsed.call_id || "";
    const tsCallId = tsResult.callId || "";
    if (pyCallId === tsCallId) {
      success(`Call ID matches: ${pyCallId || "(empty)"}`);
    } else {
      failure(`Call ID mismatch: Python='${pyCallId}', TypeScript='${tsCallId}'`);
      entryPassed = false;
    }

    // Compare args_delta for partial_tool_call
    if (entry.event_type === "partial_tool_call") {
      const pyArgsDelta = pyParsed.args_delta || "";
      const tsArgsDelta = "argsTextDelta" in tsResult ? tsResult.argsTextDelta || "" : "";
      if (pyArgsDelta === tsArgsDelta) {
        success(`Args delta matches`);
      } else {
        failure(`Args delta mismatch`);
        entryPassed = false;
      }
    }

    if (entryPassed) {
      passed++;
    } else {
      failed++;
    }

    console.log();
  }

  // Summary
  section("Verification Summary");
  console.log();
  if (failed === 0) {
    success(`All ${passed} entries verified successfully!`);
    log("Python and TypeScript parsing results match.", "green");
  } else {
    failure(`${failed} of ${passed + failed} entries have mismatches`);
    log("Please check the parsing logic for discrepancies.", "yellow");
  }
}

// --- Main ---
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Tool Call Parsing Verification Script

Usage:
  bun scripts/verify-tool-parsing.ts                       Run all unit tests
  bun scripts/verify-tool-parsing.ts --schema              Print tool schemas
  bun scripts/verify-tool-parsing.ts --hex <hex>           Parse hex string
  bun scripts/verify-tool-parsing.ts --file <path>         Parse binary file
  bun scripts/verify-tool-parsing.ts --verify <dump.json>  Verify against mitmproxy dump

Examples:
  # Parse captured gRPC payload
  bun scripts/verify-tool-parsing.ts --hex "0a 0e 0a 0c 6c 73 20 2d 6c 61"

  # Verify real traffic captured by mitmproxy
  # First, run mitmproxy with dump enabled:
  #   mitmdump -s scripts/mitmproxy-addon.py --set cursor_dump_toolcalls=toolcalls.json
  # Then verify:
  bun scripts/verify-tool-parsing.ts --verify toolcalls.json
`);
    return;
  }

  if (args.includes("--schema")) {
    printSchema();
    return;
  }

  const hexIdx = args.indexOf("--hex");
  if (hexIdx !== -1 && args[hexIdx + 1]) {
    parseFromHex(args[hexIdx + 1]);
    return;
  }

  const fileIdx = args.indexOf("--file");
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    parseFromFile(args[fileIdx + 1]);
    return;
  }

  const verifyIdx = args.indexOf("--verify");
  if (verifyIdx !== -1 && args[verifyIdx + 1]) {
    verifyDump(args[verifyIdx + 1]);
    return;
  }

  // Run all tests
  section("Running Tool Call Parsing Tests");

  const testCases = createTestCases();
  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    if (runTestCase(testCase)) {
      passed++;
    } else {
      failed++;
    }
  }

  if (runToolCallStartedTest()) {
    passed++;
  } else {
    failed++;
  }

  if (runPartialToolCallTest()) {
    passed++;
  } else {
    failed++;
  }

  // Summary
  section("Test Summary");
  console.log();
  if (failed === 0) {
    success(`All ${passed} tests passed!`);
  } else {
    failure(`${failed} of ${passed + failed} tests failed`);
  }

  printSchema();
}

main().catch(console.error);
