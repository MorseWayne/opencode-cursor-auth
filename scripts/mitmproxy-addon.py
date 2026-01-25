#!/usr/bin/env python3
"""
Cursor Traffic Analyzer - mitmproxy Addon

This addon integrates with mitmproxy to analyze Cursor API traffic in real-time.
It automatically detects and parses protobuf messages from Cursor's Agent API.

Usage:
    mitmdump -s scripts/mitmproxy-addon.py -p 8080
    
    # With verbose output
    mitmdump -s scripts/mitmproxy-addon.py -p 8080 --set cursor_verbose=true
    
    # Save to file
    mitmdump -s scripts/mitmproxy-addon.py -p 8080 --set cursor_output=traffic.log
    
    # Filter modes (default: smart)
    mitmdump -s scripts/mitmproxy-addon.py -p 8080 --set cursor_filter=smart
    
    Filter modes:
      - smart: Hide background noise (repo sync, telemetry) - RECOMMENDED
      - ai:    Only show AI-related requests (models, chat, agent)
      - all:   Show everything (very verbose)
      - quiet: Only count requests, no details

Then configure Cursor to use the proxy:
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
    "GetUsableModels",
    "GetDefaultModelForCli",
    "NameAgent",
    "StreamChat",
    "AgentService",
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


def timestamp():
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


class CursorAnalyzer:
    """Mitmproxy addon for analyzing Cursor API traffic."""
    
    def __init__(self):
        self.request_count = 0
        self.filtered_count = 0
        self.verbose = False
        self.output_file: Optional[str] = None
        self.filter_mode = "smart"  # smart, ai, all, quiet
        self.script_dir = os.path.dirname(os.path.abspath(__file__))
        self.project_root = os.path.dirname(self.script_dir)
        
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
        
        print(f"\n{c.DIM}Configure Cursor with:{c.RESET}")
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
            self.analyze_message(
                flow.request.content,
                direction="request",
                endpoint=flow.request.path
            )
    
    def response(self, flow: http.HTTPFlow):
        """Handle response."""
        if not self.is_cursor_api(flow):
            return
        
        # Check if request was filtered
        if not flow.metadata.get("cursor_show", True):
            return
        
        req_id = flow.metadata.get("cursor_req_id", "?")
        content_type = flow.response.headers.get("content-type", "")
        
        self.log(f"\n{c.BLUE}── Response #{req_id} ──{c.RESET}")
        self.log(f"  {c.CYAN}Status:{c.RESET} {flow.response.status_code}")
        self.log(f"  {c.CYAN}Content-Type:{c.RESET} {content_type}")
        
        if not flow.response.content:
            return
        
        # Handle SSE responses
        if "event-stream" in content_type:
            self.analyze_sse(flow.response.content, flow.request.path)
        else:
            self.analyze_message(
                flow.response.content,
                direction="response",
                endpoint=flow.request.path
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
    print("  mitmdump -s scripts/mitmproxy-addon.py -p 8080")
    print()
    print("Or with options:")
    print("  mitmdump -s scripts/mitmproxy-addon.py -p 8080 --set cursor_verbose=true")
    sys.exit(1)
