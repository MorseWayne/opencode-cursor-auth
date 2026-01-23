/**
 * Security Utilities
 * 
 * Provides security-related utility functions for input validation,
 * path sanitization, and other security measures.
 */

import { resolve, normalize, isAbsolute } from "node:path";

/**
 * Result of path validation
 */
export interface PathValidationResult {
  valid: boolean;
  normalizedPath: string;
  error?: string;
}

/**
 * Options for path validation
 */
export interface PathValidationOptions {
  /** Base directory to restrict access within (defaults to cwd) */
  baseDir?: string;
  /** Allow absolute paths outside baseDir (default: false) */
  allowAbsolute?: boolean;
  /** List of blocked path patterns (e.g., /etc, /proc) */
  blockedPatterns?: RegExp[];
}

/** Default blocked path patterns for security */
const DEFAULT_BLOCKED_PATTERNS: RegExp[] = [
  /^\/etc\b/i,         // System config
  /^\/proc\b/i,        // Process info (Linux)
  /^\/sys\b/i,         // System info (Linux)
  /^\/dev\b/i,         // Device files
  /^\/boot\b/i,        // Boot files
  /^\/root\b/i,        // Root home
  /^\/var\/run\b/i,    // Runtime data
  /^\/var\/lock\b/i,   // Lock files
  /^~\//,              // Home directory shortcut
  /\.\./,              // Parent directory traversal
];

/**
 * Validate and sanitize a file path to prevent path traversal attacks.
 * 
 * @param inputPath - The path to validate
 * @param options - Validation options
 * @returns Validation result with normalized path or error
 */
export function validatePath(
  inputPath: string,
  options: PathValidationOptions = {}
): PathValidationResult {
  const {
    baseDir = process.cwd(),
    allowAbsolute = false,
    blockedPatterns = DEFAULT_BLOCKED_PATTERNS,
  } = options;

  // Empty path is invalid
  if (!inputPath || inputPath.trim() === "") {
    return {
      valid: false,
      normalizedPath: "",
      error: "Path cannot be empty",
    };
  }

  // Check for null bytes (common attack vector)
  if (inputPath.includes("\0")) {
    return {
      valid: false,
      normalizedPath: "",
      error: "Path contains null bytes",
    };
  }

  // Check against blocked patterns
  for (const pattern of blockedPatterns) {
    if (pattern.test(inputPath)) {
      return {
        valid: false,
        normalizedPath: "",
        error: `Path matches blocked pattern: ${pattern.source}`,
      };
    }
  }

  // Normalize the path to resolve . and ..
  const normalizedPath = normalize(inputPath);

  // Check for parent directory traversal after normalization
  if (normalizedPath.includes("..")) {
    return {
      valid: false,
      normalizedPath: "",
      error: "Path contains parent directory traversal",
    };
  }

  // Resolve to absolute path
  const absolutePath = isAbsolute(normalizedPath)
    ? normalizedPath
    : resolve(baseDir, normalizedPath);

  // If absolute paths are not allowed, ensure path is within baseDir
  if (!allowAbsolute) {
    const normalizedBaseDir = normalize(baseDir);
    if (!absolutePath.startsWith(normalizedBaseDir)) {
      return {
        valid: false,
        normalizedPath: "",
        error: `Path escapes base directory: ${baseDir}`,
      };
    }
  }

  // Check normalized absolute path against blocked patterns
  for (const pattern of blockedPatterns) {
    if (pattern.test(absolutePath)) {
      return {
        valid: false,
        normalizedPath: "",
        error: `Resolved path matches blocked pattern: ${pattern.source}`,
      };
    }
  }

  return {
    valid: true,
    normalizedPath: absolutePath,
  };
}

/**
 * Sanitize a shell command to prevent command injection.
 * This is a basic sanitization - for production use, prefer allowlists.
 * 
 * @param command - The command to sanitize
 * @returns Sanitization result
 */
export interface CommandValidationResult {
  valid: boolean;
  error?: string;
}

/** Dangerous shell patterns that could indicate command injection */
const DANGEROUS_PATTERNS: RegExp[] = [
  /;\s*rm\s+-rf/i,           // rm -rf after semicolon
  /\|\s*sh\b/i,              // Piping to shell
  /\|\s*bash\b/i,            // Piping to bash
  /`[^`]*`/,                 // Backtick command substitution
  /\$\([^)]*\)/,             // $() command substitution
  />\s*\/etc\//i,            // Redirecting to /etc
  />\s*\/proc\//i,           // Redirecting to /proc
  /&&\s*curl\s+.*\|\s*sh/i,  // Download and execute pattern
  /wget\s+.*\|\s*sh/i,       // Download and execute pattern
];

/**
 * Validate a shell command for potentially dangerous patterns.
 * 
 * Note: This is NOT a complete security solution. For security-critical
 * applications, use allowlists and avoid shell execution when possible.
 * 
 * @param command - The command to validate
 * @returns Validation result
 */
export function validateCommand(command: string): CommandValidationResult {
  if (!command || command.trim() === "") {
    return { valid: false, error: "Command cannot be empty" };
  }

  // Check for null bytes
  if (command.includes("\0")) {
    return { valid: false, error: "Command contains null bytes" };
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        valid: false,
        error: `Command contains potentially dangerous pattern: ${pattern.source}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Check if a path is safe for file operations.
 * Convenience wrapper around validatePath.
 * 
 * @param path - The path to check
 * @param baseDir - Base directory to restrict access within
 * @returns true if path is safe, false otherwise
 */
export function isPathSafe(path: string, baseDir?: string): boolean {
  // For built-in tools, we allow absolute paths but still check for traversal
  return validatePath(path, { 
    baseDir, 
    allowAbsolute: true  // Allow absolute paths for file operations
  }).valid;
}
