#!/usr/bin/env python3
"""
Cursor Traffic Analyzer - mitmproxy Addon

This addon integrates with mitmproxy to analyze Cursor API traffic in real-time.
It automatically detects and parses protobuf messages from Cursor's Agent API.

Usage:
    # Basic usage (with streaming support for gRPC)
    mitmdump -s scripts/mitmproxy-addon.py -p 8080 --set stream_large_bodies=1
    
    # With verbose output
    mitmdump -s scripts/mitmproxy-addon.py -p 8080 --set stream_large_bodies=1 --set cursor_verbose=true
    
    # Save to file
    mitmdump -s scripts/mitmproxy-addon.py -p 8080 --set stream_large_bodies=1 --set cursor_output=traffic.log
    
    # Filter modes (default: smart)
    mitmdump -s scripts/mitmproxy-addon.py -p 8080 --set cursor_filter=smart
    
    Filter modes:
      - smart: Hide background noise (repo sync, telemetry) - RECOMMENDED
      - ai:    Only show AI-related requests (models, chat, agent)
      - all:   Show everything (very verbose)
      - quiet: Only count requests, no details

For cursor-agent CLI (bypasses HTTP_PROXY, use proxychains):
    # Install proxychains
    sudo apt install proxychains4
    
    # Create config ~/.proxychains.conf
    strict_chain
    proxy_dns
    localnet 127.0.0.0/255.0.0.0
    [ProxyList]
    http 127.0.0.1 8080
    
    # Run cursor-agent through proxy
    proxychains4 -f ~/.proxychains.conf cursor-agent

For Cursor IDE (respects HTTP_PROXY):
    export HTTP_PROXY=http://127.0.0.1:8080
    export HTTPS_PROXY=http://127.0.0.1:8080
    export NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem
    cursor .

Requirements:
    pip install mitmproxy
"""

import subprocess
import base64
import json
import os
import re
import sys
from datetime import datetime
from typing import Optional, List, Set
from mitmproxy import ctx, http
from mitmproxy.addonmanager import Loader


# Endpoint patterns to filter
NOISE_ENDPOINTS = {
    # Repository sync (very frequent)
    "SyncMerkleSubtreeV2",
    "FastUpdateFileV2",
    "FastRepoInitHandshakeV2",
    "FastRepoSyncComplete",
    # Telemetry
    "v1/traces",
    # Dashboard/settings (initialization)
    "GetTeamHooks",
    "GetTeamAdminSettingsOrEmptyIfNotInTeam",
    "GetUserPrivacyMode",
    "GetTeamCommands",
    "GetCliDownloadUrl",
}

# AI-related endpoints (always interesting)
AI_ENDPOINTS = {
    # Model info
    "GetUsableModels",
    "GetDefaultModelForCli",
    # Agent service (the main AI conversation flow)
    "AgentService",
    "RunSSE",           # agent.v1.AgentService/RunSSE - main streaming response
    "BidiAppend",       # aiserver.v1.BidiService/BidiAppend - bidirectional messages
    "BidiService",      # The bidi service namespace
    # Legacy/other AI endpoints
    "NameAgent",
    "StreamChat",
    "Conversation",
}


# ANSI colors for terminal output
class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"


c = Colors()


def parse_varint(data: bytes, offset: int) -> tuple:
    """Parse a protobuf varint, return (value, new_offset)."""
    result = 0
    shift = 0
    while offset < len(data):
        byte = data[offset]
        result |= (byte & 0x7F) << shift
        offset += 1
        if not (byte & 0x80):
            break
        shift += 7
    return result, offset


def parse_proto_fields(data: bytes) -> list:
    """Parse protobuf fields from binary data.
    
    Returns list of (field_number, wire_type, value) tuples.
    wire_type 0 = varint, 2 = length-delimited (bytes/string)
    """
    fields = []
    offset = 0
    
    while offset < len(data):
        try:
            tag, offset = parse_varint(data, offset)
            field_number = tag >> 3
            wire_type = tag & 0x07
            
            if wire_type == 0:  # Varint
                value, offset = parse_varint(data, offset)
                fields.append((field_number, wire_type, value))
            elif wire_type == 2:  # Length-delimited
                length, offset = parse_varint(data, offset)
                if offset + length > len(data):
                    break
                value = data[offset:offset + length]
                offset += length
                fields.append((field_number, wire_type, value))
            elif wire_type == 1:  # 64-bit
                offset += 8
            elif wire_type == 5:  # 32-bit
                offset += 4
            else:
                break  # Unknown wire type
        except Exception:
            break
    
    return fields


def extract_text_from_agent_message(data: bytes) -> list:
    """Extract text content from AgentServerMessage protobuf (simple version)."""
    texts = []
    
    try:
        outer_fields = parse_proto_fields(data)
        for fn, wt, val in outer_fields:
            if fn == 1 and wt == 2 and isinstance(val, bytes):
                update_fields = parse_proto_fields(val)
                for ufn, uwt, uval in update_fields:
                    if ufn in (1, 4, 8) and uwt == 2 and isinstance(uval, bytes):
                        inner_fields = parse_proto_fields(uval)
                        for ifn, iwt, ival in inner_fields:
                            if ifn == 1 and iwt == 2 and isinstance(ival, bytes):
                                try:
                                    text = ival.decode('utf-8')
                                    if text.strip():
                                        texts.append(text)
                                except:
                                    pass
    except Exception:
        pass
    
    return texts


def parse_agent_message_detailed(data: bytes) -> list:
    """Parse AgentServerMessage and extract all field types with details.
    
    InteractionUpdate fields:
      field 1: text_delta (TextDeltaUpdate) -> field 1: text
      field 2: tool_call_started (ToolCallStartedUpdate)
      field 3: tool_call_completed (ToolCallCompletedUpdate)
      field 4: thinking_delta (ThinkingDeltaUpdate) -> field 1: thinking
      field 7: partial_tool_call (PartialToolCallUpdate)
      field 8: token_delta (TokenDeltaUpdate) -> field 1: text
      field 13: heartbeat
      field 14: turn_ended (TurnEndedUpdate)
    
    Returns list of dicts with 'type' and 'content' keys.
    """
    results = []
    
    FIELD_NAMES = {
        1: "text_delta",
        2: "tool_call_started",
        3: "tool_call_completed",
        4: "thinking_delta",
        7: "partial_tool_call",
        8: "token_delta",
        13: "heartbeat",
        14: "turn_ended",
    }
    
    try:
        # Parse outer message (AgentServerMessage)
        outer_fields = parse_proto_fields(data)
        
        for fn, wt, val in outer_fields:
            if fn == 1 and wt == 2 and isinstance(val, bytes):
                # This is InteractionUpdate
                update_fields = parse_proto_fields(val)
                
                for ufn, uwt, uval in update_fields:
                    field_name = FIELD_NAMES.get(ufn, f"field_{ufn}")
                    
                    # Text fields (1, 4, 8) - extract text from nested message
                    if ufn in (1, 4, 8) and uwt == 2 and isinstance(uval, bytes):
                        inner_fields = parse_proto_fields(uval)
                        for ifn, iwt, ival in inner_fields:
                            if ifn == 1 and iwt == 2 and isinstance(ival, bytes):
                                try:
                                    text = ival.decode('utf-8')
                                    if text:
                                        results.append({
                                            "type": field_name,
                                            "content": text
                                        })
                                except:
                                    pass
                    
                    # Tool call fields (2, 3) - extract tool info
                    elif ufn in (2, 3) and uwt == 2 and isinstance(uval, bytes):
                        tool_info = parse_tool_call_info(uval)
                        results.append({
                            "type": field_name,
                            "content": tool_info,
                            "raw_hex": uval.hex()  # Raw bytes for verification
                        })
                    
                    # Partial tool call (7)
                    elif ufn == 7 and uwt == 2 and isinstance(uval, bytes):
                        partial_info = parse_partial_tool_call(uval)
                        results.append({
                            "type": field_name,
                            "content": partial_info,
                            "raw_hex": uval.hex()  # Raw bytes for verification
                        })
                    
                    # Heartbeat (13) - no content
                    elif ufn == 13:
                        results.append({
                            "type": "heartbeat",
                            "content": None
                        })
                    
                    # Turn ended (14)
                    elif ufn == 14:
                        results.append({
                            "type": "turn_ended",
                            "content": None
                        })
    except Exception:
        pass
    
    return results


# Tool type mapping by field number (from tool-calls.ts)
# Names should match TypeScript TOOL_FIELD_MAP exactly
TOOL_FIELD_MAP = {
    1: "bash",
    3: "delete",
    4: "glob",
    5: "grep",
    8: "read",
    9: "todowrite",
    10: "todoread",
    12: "edit",
    13: "list",  # Changed from "ls" to match TypeScript
    14: "read_lints",
    15: "mcp",
    16: "semantic_search",
    17: "create_plan",
    18: "web_search",
    19: "task",
    20: "list_mcp_resources",
    21: "read_mcp_resource",
    22: "apply_diff",
    23: "ask_question",
    24: "webfetch",
    25: "switch_mode",
    26: "exa_search",
    27: "exa_fetch",
    28: "generate_image",
    29: "record_screen",
    30: "computer_use",
}

# Tool argument schemas - maps tool type to {field_number: arg_name}
# Should match TypeScript TOOL_ARG_SCHEMA exactly
TOOL_ARG_SCHEMA = {
    "bash": {1: "command", 2: "description", 3: "working_directory"},
    "delete": {1: "filePath"},
    "glob": {1: "pattern", 2: "path"},
    "grep": {1: "pattern", 2: "path", 3: "include"},
    "read": {1: "filePath", 2: "offset", 3: "limit"},
    "todowrite": {1: "todos"},
    "todoread": {},
    "edit": {1: "filePath", 2: "oldString", 3: "newString", 4: "replaceAll"},
    "list": {1: "path", 2: "ignore"},
    "read_lints": {},
    "mcp": {1: "provider_identifier", 2: "tool_name", 3: "tool_call_id", 4: "args"},
    "semantic_search": {1: "query", 2: "path"},
    "create_plan": {1: "plan"},
    "web_search": {1: "query"},
    "task": {1: "description", 2: "prompt", 3: "subagent_type"},
    "list_mcp_resources": {1: "provider_identifier"},
    "read_mcp_resource": {1: "provider_identifier", 2: "uri"},
    "apply_diff": {1: "filePath", 2: "diff"},
    "ask_question": {1: "question"},
    "webfetch": {1: "url", 2: "format"},
    "switch_mode": {1: "mode"},
    "exa_search": {1: "query"},
    "exa_fetch": {1: "url"},
    "generate_image": {1: "prompt"},
    "record_screen": {1: "duration"},
    "computer_use": {1: "action", 2: "text", 3: "coordinate"},
}


def parse_tool_call(data: bytes) -> dict:
    """Parse a ToolCall message. Tool type is determined by field number."""
    info = {"tool_name": "unknown", "args": {}}
    try:
        fields = parse_proto_fields(data)
        for fn, wt, val in fields:
            tool_name = TOOL_FIELD_MAP.get(fn)
            if tool_name and wt == 2 and isinstance(val, bytes):
                info["tool_name"] = tool_name
                # Get argument schema for this tool
                arg_schema = TOOL_ARG_SCHEMA.get(tool_name, {})
                # Parse tool arguments
                arg_fields = parse_proto_fields(val)
                for afn, awt, aval in arg_fields:
                    # Get the proper argument name from schema
                    arg_name = arg_schema.get(afn, f"field_{afn}")
                    if awt == 2 and isinstance(aval, bytes):
                        try:
                            # Try to decode nested string (field 1 inside)
                            nested = parse_proto_fields(aval)
                            for nfn, nwt, nval in nested:
                                if nfn == 1 and nwt == 2 and isinstance(nval, bytes):
                                    info["args"][arg_name] = nval.decode('utf-8')
                                    break
                            else:
                                info["args"][arg_name] = aval.decode('utf-8')
                        except:
                            pass
                    elif awt == 0:
                        # Handle boolean/integer values
                        if arg_name == "replaceAll":
                            info["args"][arg_name] = (aval == 1)
                        else:
                            info["args"][arg_name] = aval
                break
    except Exception:
        pass
    return info


def parse_tool_call_info(data: bytes) -> dict:
    """Parse ToolCallStartedUpdate/ToolCallCompletedUpdate.
    
    Structure:
      field 1: call_id (string)
      field 2: tool_call (ToolCall message)
      field 3: model_call_id (string)
    """
    info = {}
    try:
        fields = parse_proto_fields(data)
        for fn, wt, val in fields:
            if fn == 1 and wt == 2 and isinstance(val, bytes):
                try:
                    info["call_id"] = val.decode('utf-8')
                except:
                    pass
            elif fn == 2 and wt == 2 and isinstance(val, bytes):
                # This is the ToolCall message
                tool_info = parse_tool_call(val)
                info["tool_name"] = tool_info.get("tool_name", "unknown")
                info["args"] = tool_info.get("args", {})
            elif fn == 3 and wt == 2 and isinstance(val, bytes):
                try:
                    info["model_call_id"] = val.decode('utf-8')
                except:
                    pass
    except Exception:
        pass
    return info


def parse_partial_tool_call(data: bytes) -> dict:
    """Parse PartialToolCallUpdate.
    
    Structure:
      field 1: call_id (string)
      field 2: tool_call (ToolCall message)
      field 3: args_text_delta (string) - incremental JSON args
      field 4: model_call_id (string)
    """
    info = {}
    try:
        fields = parse_proto_fields(data)
        for fn, wt, val in fields:
            if fn == 1 and wt == 2 and isinstance(val, bytes):
                try:
                    info["call_id"] = val.decode('utf-8')
                except:
                    pass
            elif fn == 2 and wt == 2 and isinstance(val, bytes):
                # ToolCall message
                tool_info = parse_tool_call(val)
                info["tool_name"] = tool_info.get("tool_name", "unknown")
            elif fn == 3 and wt == 2 and isinstance(val, bytes):
                try:
                    info["args_delta"] = val.decode('utf-8')
                except:
                    pass
            elif fn == 4 and wt == 2 and isinstance(val, bytes):
                try:
                    info["model_call_id"] = val.decode('utf-8')
                except:
                    pass
    except Exception:
        pass
    return info


def timestamp():
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


class CursorAnalyzer:
    """Mitmproxy addon for analyzing Cursor API traffic."""
    
    def __init__(self):
        self.request_count = 0
        self.filtered_count = 0
        self.verbose = False
        self.debug = False  # Log all request URLs for debugging
        self.output_file: Optional[str] = None
        self.filter_mode = "smart"  # smart, ai, all, quiet
        self.script_dir = os.path.dirname(os.path.abspath(__file__))
        self.project_root = os.path.dirname(self.script_dir)
        self.toolcall_dump_file: Optional[str] = None
        self.toolcall_dump_data: List[dict] = []  # Buffer for tool call data
        
    def load(self, loader: Loader):
        """Register addon options."""
        loader.add_option(
            name="cursor_verbose",
            typespec=bool,
            default=False,
            help="Show detailed message content"
        )
        loader.add_option(
            name="cursor_output",
            typespec=Optional[str],
            default=None,
            help="Save traffic to file"
        )
        loader.add_option(
            name="cursor_filter",
            typespec=str,
            default="smart",
            help="Filter mode: smart (hide noise), ai (AI only), all (everything), quiet (summary)"
        )
        loader.add_option(
            name="cursor_debug",
            typespec=bool,
            default=False,
            help="Debug mode: log all request URLs (helps diagnose missing requests)"
        )
        loader.add_option(
            name="cursor_dump_toolcalls",
            typespec=Optional[str],
            default=None,
            help="Save raw tool call data to JSON file for verification"
        )
    
    def configure(self, updates):
        """Handle option changes."""
        if "cursor_verbose" in updates:
            self.verbose = ctx.options.cursor_verbose
        if "cursor_output" in updates:
            self.output_file = ctx.options.cursor_output
            if self.output_file:
                # Create/clear output file
                with open(self.output_file, "w") as f:
                    f.write(f"# Cursor Traffic Log - {datetime.now().isoformat()}\n\n")
        if "cursor_filter" in updates:
            self.filter_mode = ctx.options.cursor_filter
            if self.filter_mode not in ("smart", "ai", "all", "quiet"):
                print(f"{c.YELLOW}Warning: Unknown filter mode '{self.filter_mode}', using 'smart'{c.RESET}")
                self.filter_mode = "smart"
        if "cursor_debug" in updates:
            self.debug = ctx.options.cursor_debug
        if "cursor_dump_toolcalls" in updates:
            self.toolcall_dump_file = ctx.options.cursor_dump_toolcalls
            if self.toolcall_dump_file:
                self.toolcall_dump_data = []
                print(f"{c.CYAN}Tool call dump enabled: {self.toolcall_dump_file}{c.RESET}")
    
    def running(self):
        """Called when mitmproxy is ready."""
        print(f"\n{c.CYAN}{'═' * 60}{c.RESET}")
        print(f"{c.BOLD}{c.CYAN} Cursor Traffic Analyzer - mitmproxy Addon{c.RESET}")
        print(f"{c.CYAN}{'═' * 60}{c.RESET}")
        print(f"\n{c.GREEN}Listening for Cursor traffic...{c.RESET}")
        
        # Show filter mode
        filter_desc = {
            "smart": "Hide noise (repo sync, telemetry)",
            "ai": "AI requests only",
            "all": "Show everything",
            "quiet": "Summary only (count requests)",
        }
        print(f"{c.CYAN}Filter mode:{c.RESET} {self.filter_mode} - {filter_desc.get(self.filter_mode, '')}")
        
        # Show AI endpoints we're tracking
        print(f"\n{c.CYAN}AI endpoints tracked:{c.RESET}")
        print(f"  {c.DIM}AgentService/Run, RunSSE, BidiAppend, StreamChat{c.RESET}")
        
        print(f"\n{c.DIM}For cursor-agent (uses gRPC streaming):{c.RESET}")
        print(f"{c.DIM}  # Option 1: proxychains (recommended for cursor-agent){c.RESET}")
        print(f"{c.DIM}  proxychains4 -f ~/.proxychains.conf cursor-agent{c.RESET}")
        print(f"\n{c.DIM}  # Option 2: environment variables (for Cursor IDE){c.RESET}")
        print(f"{c.DIM}  export HTTP_PROXY=http://127.0.0.1:{ctx.options.listen_port}{c.RESET}")
        print(f"{c.DIM}  export HTTPS_PROXY=http://127.0.0.1:{ctx.options.listen_port}{c.RESET}")
        print(f"{c.DIM}  export NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem{c.RESET}")
        print()
    
    def should_show(self, endpoint: str) -> bool:
        """Check if this endpoint should be displayed based on filter mode."""
        if self.filter_mode == "all":
            return True
        
        if self.filter_mode == "quiet":
            return False
        
        # Check if it's a noise endpoint
        is_noise = any(noise in endpoint for noise in NOISE_ENDPOINTS)
        
        # Check if it's an AI endpoint
        is_ai = any(ai in endpoint for ai in AI_ENDPOINTS)
        
        if self.filter_mode == "ai":
            return is_ai
        
        # smart mode: show everything except noise
        if self.filter_mode == "smart":
            return not is_noise
        
        return True
    
    def log_filtered_summary(self):
        """Log summary of filtered requests."""
        if self.filtered_count > 0:
            print(f"{c.DIM}  ... ({self.filtered_count} background requests filtered){c.RESET}")
            self.filtered_count = 0
    
    def is_cursor_api(self, flow: http.HTTPFlow) -> bool:
        """Check if this is a Cursor API request."""
        return "cursor.sh" in flow.request.host
    
    def log(self, message: str):
        """Log message to console and optionally to file."""
        print(message)
        if self.output_file:
            # Strip ANSI codes for file output
            import re
            clean_msg = re.sub(r'\033\[[0-9;]*m', '', message)
            with open(self.output_file, "a") as f:
                f.write(clean_msg + "\n")
    
    def request(self, flow: http.HTTPFlow):
        """Handle request."""
        if not self.is_cursor_api(flow):
            return
        
        self.request_count += 1
        req_id = self.request_count
        
        # Store request ID for matching with response
        flow.metadata["cursor_req_id"] = req_id
        
        # Check if this endpoint should be shown
        endpoint = flow.request.path
        show = self.should_show(endpoint)
        flow.metadata["cursor_show"] = show
        
        # Debug mode: log ALL request URLs
        if self.debug:
            print(f"{c.DIM}[DEBUG #{req_id}] {flow.request.method} {endpoint}{c.RESET}")
        
        # Debug: always log AI conversation endpoints
        is_ai_conversation = "RunSSE" in endpoint or "BidiAppend" in endpoint or "BidiService" in endpoint
        if is_ai_conversation:
            self.log(f"\n{c.MAGENTA}[AI CONVERSATION DETECTED]{c.RESET}")
            show = True  # Force show AI conversation
            flow.metadata["cursor_show"] = True
        
        if not show:
            self.filtered_count += 1
            # Show periodic summary
            if self.filtered_count % 10 == 0:
                self.log_filtered_summary()
            return
        
        # Show any pending filtered summary before this request
        self.log_filtered_summary()
        
        self.log(f"\n{c.GREEN}{'═' * 60}{c.RESET}")
        self.log(f"{c.BOLD}{c.GREEN} Request #{req_id}{c.RESET}")
        self.log(f"{c.GREEN}{'═' * 60}{c.RESET}")
        self.log(f"  {c.CYAN}Time:{c.RESET} {timestamp()}")
        self.log(f"  {c.CYAN}Method:{c.RESET} {flow.request.method}")
        self.log(f"  {c.CYAN}URL:{c.RESET} {flow.request.url}")
        
        # Show relevant headers
        auth = flow.request.headers.get("authorization", "")
        if auth:
            self.log(f"  {c.CYAN}Auth:{c.RESET} {auth[:30]}...")
        
        checksum = flow.request.headers.get("x-cursor-checksum", "")
        if checksum:
            self.log(f"  {c.CYAN}Checksum:{c.RESET} {checksum[:30]}...")
        
        # Analyze request body
        if flow.request.content:
            # Special handling for AI conversation endpoints
            if "BidiAppend" in endpoint or "RunSSE" in endpoint:
                self.log(f"  {c.MAGENTA}[AI Conversation]{c.RESET}")
            
            self.analyze_message(
                flow.request.content,
                direction="request",
                endpoint=flow.request.path
            )
    
    def responseheaders(self, flow: http.HTTPFlow):
        """Called when response headers are received.
        
        Enable streaming for gRPC endpoints to prevent connection issues
        with long-running streaming responses.
        """
        if not self.is_cursor_api(flow):
            return
        
        endpoint = flow.request.path
        content_type = flow.response.headers.get("content-type", "")
        
        # Enable streaming for gRPC and SSE responses
        # This prevents mitmproxy from buffering the entire response
        is_streaming = (
            "grpc" in content_type or 
            "connect" in content_type or
            "event-stream" in content_type or
            "AgentService/Run" in endpoint or
            "RunSSE" in endpoint or
            "BidiAppend" in endpoint or
            "Stream" in endpoint
        )
        
        if is_streaming:
            flow.metadata["cursor_streaming"] = True
            flow.metadata["cursor_stream_bytes"] = 0
            flow.metadata["cursor_stream_chunks"] = 0
            flow.metadata["cursor_stream_text"] = []
            flow.metadata["cursor_stream_events"] = []  # Detailed events
            flow.metadata["cursor_raw_toolcalls"] = []  # Raw tool call data for verification
            req_id = flow.metadata.get("cursor_req_id", "?")
            
            # Log streaming response header immediately
            if flow.metadata.get("cursor_show", True):
                self.log(f"\n{c.BLUE}── Streaming Response #{req_id} ──{c.RESET}")
                self.log(f"  {c.CYAN}Status:{c.RESET} {flow.response.status_code}")
                self.log(f"  {c.CYAN}Content-Type:{c.RESET} {content_type}")
                self.log(f"  {c.MAGENTA}[gRPC Stream Active]{c.RESET}")
            
            # Use a simple streaming modifier to capture data
            addon = self
            
            def modify_stream(data: bytes) -> bytes:
                """Stream modifier - parse protobuf and extract all event types."""
                flow.metadata["cursor_stream_bytes"] += len(data)
                flow.metadata["cursor_stream_chunks"] += 1
                
                # Parse gRPC frames and extract detailed events
                try:
                    offset = 0
                    while offset + 5 <= len(data):
                        flags = data[offset]
                        length = int.from_bytes(data[offset+1:offset+5], 'big')
                        if offset + 5 + length > len(data):
                            break
                        frame_data = data[offset+5:offset+5+length]
                        offset += 5 + length
                        
                        if flags & 0x80:  # Skip trailer
                            continue
                        
                        # Parse protobuf to extract detailed events
                        events = parse_agent_message_detailed(frame_data)
                        for event in events:
                            flow.metadata["cursor_stream_events"].append(event)
                            # Also collect text for summary
                            if event["type"] in ("text_delta", "thinking_delta", "token_delta"):
                                if event["content"]:
                                    flow.metadata["cursor_stream_text"].append(event["content"])
                except Exception:
                    pass
                
                return data
            
            flow.response.stream = modify_stream
            
            if self.debug:
                self.log(f"{c.DIM}[DEBUG] Streaming enabled for: {endpoint}{c.RESET}")
    
    def response(self, flow: http.HTTPFlow):
        """Handle response."""
        if not self.is_cursor_api(flow):
            return
        
        # Check if request was filtered
        if not flow.metadata.get("cursor_show", True):
            return
        
        req_id = flow.metadata.get("cursor_req_id", "?")
        content_type = flow.response.headers.get("content-type", "")
        endpoint = flow.request.path
        
        # Streaming responses - log completion with captured data
        if flow.metadata.get("cursor_streaming", False):
            total_bytes = flow.metadata.get("cursor_stream_bytes", 0)
            total_chunks = flow.metadata.get("cursor_stream_chunks", 0)
            text_fragments = flow.metadata.get("cursor_stream_text", [])
            events = flow.metadata.get("cursor_stream_events", [])
            
            self.log(f"\n{c.BLUE}── Stream Complete #{req_id} ──{c.RESET}")
            self.log(f"  {c.CYAN}Chunks:{c.RESET} {total_chunks}")
            self.log(f"  {c.CYAN}Total Size:{c.RESET} {total_bytes} bytes")
            
            # Count events by type
            event_counts = {}
            for e in events:
                t = e.get("type", "unknown")
                event_counts[t] = event_counts.get(t, 0) + 1
            
            if event_counts:
                self.log(f"  {c.CYAN}Events:{c.RESET}")
                for event_type, count in sorted(event_counts.items()):
                    self.log(f"    - {event_type}: {count}")
            
            # Show tool calls if any
            tool_events = [e for e in events if e.get("type") in ("tool_call_started", "tool_call_completed", "partial_tool_call")]
            if tool_events:
                self.log(f"  {c.YELLOW}Tool Calls:{c.RESET}")
                for e in tool_events:
                    content = e.get("content", {})
                    if isinstance(content, dict):
                        event_type = e.get("type", "unknown")
                        tool_name = content.get("tool_name", "unknown")
                        call_id = content.get("call_id", "")
                        call_id_short = call_id[:12] + "..." if len(call_id) > 12 else call_id
                        args = content.get("args", {})
                        args_delta = content.get("args_delta", "")
                        
                        if event_type == "partial_tool_call":
                            # Show incremental args
                            if args_delta:
                                delta_preview = args_delta[:200]
                                if len(args_delta) > 200:
                                    delta_preview += "..."
                                self.log(f"    [partial] {tool_name}: {delta_preview}")
                            else:
                                self.log(f"    [partial] {tool_name} ({call_id_short})")
                        else:
                            # Show full tool call with args
                            self.log(f"    [{event_type.replace('tool_call_', '')}] {tool_name}")
                            if call_id:
                                self.log(f"      call_id: {call_id_short}")
                            if args:
                                for arg_name, arg_val in args.items():
                                    if isinstance(arg_val, str):
                                        val_preview = arg_val[:100]
                                        if len(arg_val) > 100:
                                            val_preview += "..."
                                        self.log(f"      {arg_name}: {val_preview}")
                                    else:
                                        self.log(f"      {arg_name}: {arg_val}")
            
            # Show thinking content if any
            thinking_events = [e for e in events if e.get("type") == "thinking_delta" and e.get("content")]
            if thinking_events:
                self.log(f"  {c.MAGENTA}Thinking:{c.RESET}")
                thinking_text = ''.join(e.get("content", "") for e in thinking_events)
                preview = thinking_text[:500]
                if len(thinking_text) > 500:
                    preview += "..."
                self.log(f"    {preview}")
            
            # Show AI text response
            if text_fragments:
                self.log(f"  {c.GREEN}AI Response:{c.RESET}")
                combined = ''.join(text_fragments)
                preview = combined[:800]
                if len(combined) > 800:
                    preview += "..."
                self.log(f"    {preview}")
            
            # Save tool call data for verification if enabled
            if self.toolcall_dump_file and tool_events:
                for e in tool_events:
                    raw_hex = e.get("raw_hex")
                    if raw_hex:
                        dump_entry = {
                            "timestamp": timestamp(),
                            "request_id": str(req_id),
                            "endpoint": endpoint,
                            "event_type": e.get("type"),
                            "raw_hex": raw_hex,
                            "python_parsed": e.get("content", {})
                        }
                        self.toolcall_dump_data.append(dump_entry)
                
                # Write to file
                try:
                    with open(self.toolcall_dump_file, "w") as f:
                        json.dump(self.toolcall_dump_data, f, indent=2, ensure_ascii=False)
                    self.log(f"  {c.DIM}[Saved {len(tool_events)} tool calls to {self.toolcall_dump_file}]{c.RESET}")
                except Exception as ex:
                    self.log(f"  {c.RED}[Error saving tool calls: {ex}]{c.RESET}")
            
            self.log(f"  {c.GREEN}[Stream Finished]{c.RESET}")
            return
        
        # Non-streaming response
        self.log(f"\n{c.BLUE}── Response #{req_id} ──{c.RESET}")
        self.log(f"  {c.CYAN}Status:{c.RESET} {flow.response.status_code}")
        self.log(f"  {c.CYAN}Content-Type:{c.RESET} {content_type}")
        
        if not flow.response.content:
            return
        
        # Handle SSE responses
        if "event-stream" in content_type:
            self.analyze_sse(flow.response.content, endpoint)
        # Handle gRPC-Web streaming (RunSSE uses this)
        elif "grpc-web" in content_type and ("RunSSE" in endpoint or "Stream" in endpoint):
            self.analyze_grpc_stream(flow.response.content, endpoint)
        else:
            self.analyze_message(
                flow.response.content,
                direction="response",
                endpoint=endpoint
            )
    
    def analyze_message(self, data: bytes, direction: str, endpoint: str):
        """Analyze protobuf message using bun script."""
        if len(data) < 5:
            return
        
        self.log(f"  {c.CYAN}Size:{c.RESET} {len(data)} bytes")
        
        # Try to use bun script for analysis
        try:
            cmd = [
                "bun", "run", 
                os.path.join(self.project_root, "scripts/cursor-sniffer.ts"),
                "--analyze",
                "--direction", direction,
                "--endpoint", endpoint,
                "--verbose" if self.verbose else "--raw"
            ]
            result = subprocess.run(
                cmd,
                input=data.hex().encode(),
                capture_output=True,
                timeout=5,
                cwd=self.project_root
            )
            
            if result.returncode == 0 and result.stdout:
                output = result.stdout.decode().strip()
                for line in output.split("\n"):
                    self.log(f"    {line}")
            else:
                # Fallback: show hex dump
                self.show_hex_preview(data)
                
        except subprocess.TimeoutExpired:
            self.log(f"  {c.YELLOW}[Analysis timed out]{c.RESET}")
            self.show_hex_preview(data)
        except FileNotFoundError:
            self.log(f"  {c.YELLOW}[bun not found, showing raw data]{c.RESET}")
            self.show_hex_preview(data)
        except Exception as e:
            self.log(f"  {c.RED}[Analysis error: {e}]{c.RESET}")
            self.show_hex_preview(data)
    
    def analyze_grpc_stream(self, data: bytes, endpoint: str):
        """Analyze gRPC-Web streaming response (used by RunSSE)."""
        self.log(f"  {c.CYAN}Size:{c.RESET} {len(data)} bytes")
        self.log(f"  {c.MAGENTA}[gRPC-Web Stream]{c.RESET}")
        
        # Parse gRPC-Web frames
        offset = 0
        frame_count = 0
        text_fragments = []
        
        while offset + 5 <= len(data):
            flags = data[offset]
            length = int.from_bytes(data[offset+1:offset+5], 'big')
            
            if offset + 5 + length > len(data):
                break
            
            frame_data = data[offset+5:offset+5+length]
            offset += 5 + length
            frame_count += 1
            
            # Check for trailer frame (flags & 0x80)
            if flags & 0x80:
                try:
                    trailer = frame_data.decode('utf-8')
                    self.log(f"  {c.DIM}[Trailer] {trailer[:100]}...{c.RESET}")
                except:
                    pass
                continue
            
            # Parse AgentServerMessage
            try:
                result = subprocess.run(
                    [
                        "bun", "run",
                        os.path.join(self.project_root, "scripts/cursor-sniffer.ts"),
                        "--analyze",
                        "--direction", "response",
                        "--endpoint", endpoint
                    ],
                    input=frame_data.hex().encode(),
                    capture_output=True,
                    timeout=3,
                    cwd=self.project_root
                )
                
                if result.returncode == 0 and result.stdout:
                    output = result.stdout.decode().strip()
                    # Extract text content for summary
                    for line in output.split("\n"):
                        if "text_delta" in line.lower() or "Text:" in line:
                            text_fragments.append(line.strip())
                        elif self.verbose:
                            self.log(f"      {line}")
            except:
                pass
        
        self.log(f"  {c.CYAN}Frames:{c.RESET} {frame_count}")
        
        # Show text summary
        if text_fragments:
            self.log(f"  {c.GREEN}AI Response:{c.RESET}")
            # Combine and show first part of response
            combined = " ".join(text_fragments)[:500]
            self.log(f"    {combined}{'...' if len(combined) >= 500 else ''}")
    
    def analyze_sse(self, data: bytes, endpoint: str):
        """Analyze SSE response."""
        try:
            content = data.decode("utf-8")
            lines = content.split("\n")
            message_count = 0
            
            for line in lines:
                if line.startswith("data: "):
                    payload = line[6:].strip()
                    if payload == "[DONE]":
                        self.log(f"  {c.DIM}[DONE]{c.RESET}")
                        continue
                    
                    message_count += 1
                    try:
                        decoded = base64.b64decode(payload)
                        self.analyze_sse_message(decoded, message_count)
                    except Exception as e:
                        self.log(f"  {c.RED}[Decode error: {e}]{c.RESET}")
            
            self.log(f"  {c.CYAN}Total messages:{c.RESET} {message_count}")
            
        except Exception as e:
            self.log(f"  {c.RED}[SSE parse error: {e}]{c.RESET}")
    
    def analyze_sse_message(self, data: bytes, msg_num: int):
        """Analyze a single SSE message."""
        if self.verbose:
            try:
                result = subprocess.run(
                    [
                        "bun", "run",
                        os.path.join(self.project_root, "scripts/cursor-sniffer.ts"),
                        "--analyze",
                        "--direction", "response"
                    ],
                    input=data.hex().encode(),
                    capture_output=True,
                    timeout=5,
                    cwd=self.project_root
                )
                
                if result.returncode == 0 and result.stdout:
                    output = result.stdout.decode().strip()
                    self.log(f"  {c.YELLOW}Message {msg_num}:{c.RESET}")
                    for line in output.split("\n"):
                        if line.strip():
                            self.log(f"    {line}")
            except Exception:
                pass
    
    def show_hex_preview(self, data: bytes, max_bytes: int = 64):
        """Show hex preview of data."""
        preview = data[:max_bytes]
        hex_str = " ".join(f"{b:02x}" for b in preview)
        self.log(f"  {c.DIM}Hex: {hex_str}{'...' if len(data) > max_bytes else ''}{c.RESET}")


# Register addon
addons = [CursorAnalyzer()]


if __name__ == "__main__":
    print("This script should be run with mitmproxy:")
    print("  mitmdump -s scripts/mitmproxy-addon.py -p 8080 --set stream_large_bodies=1")
    print()
    print("Options:")
    print("  --set cursor_verbose=true    Show detailed message content")
    print("  --set cursor_output=file.log Save to file")
    print("  --set cursor_filter=ai       Only AI requests (smart/ai/all/quiet)")
    print("  --set cursor_debug=true      Log all URLs for debugging")
    print()
    print("For cursor-agent, use proxychains:")
    print("  proxychains4 -f ~/.proxychains.conf cursor-agent")
    sys.exit(1)
