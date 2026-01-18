/**
 * Centralized Configuration Module
 *
 * All configuration values should be defined here for easy management.
 * Environment variables are read once at module load time.
 */

// --- Environment Variable Helpers ---

function envBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value === "1" || value.toLowerCase() === "true";
}

function envInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function envString(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

// --- Configuration Object ---

export const config = {
  /**
   * Debug and logging settings
   */
  debug: {
    /** Enable verbose debug logging */
    enabled: envBool("CURSOR_DEBUG", false),
    /** Enable performance timing logs */
    timing: envBool("CURSOR_TIMING", false),
    /** Log level: error, warn, info, debug */
    level: envString("CURSOR_LOG_LEVEL", "info") as "error" | "warn" | "info" | "debug",
    /** Enable request/response logging for debugging */
    requestLogging: envBool("CURSOR_REQUEST_LOGGING", false),
    /** Log filtered IDs and item_references during request transformation */
    logFilteredIds: envBool("CURSOR_LOG_FILTERED_IDS", false),
    /** Log multimodal content detection */
    logMultimodal: envBool("CURSOR_LOG_MULTIMODAL", false),
    /** Output logs in JSON format */
    jsonFormat: envBool("CURSOR_LOG_JSON", false),
  },

  /**
   * Session management settings
   */
  session: {
    /** Enable session reuse for tool calling */
    reuseEnabled: envBool("CURSOR_SESSION_REUSE", true),
    /** Session timeout in milliseconds */
    timeoutMs: envInt("CURSOR_SESSION_TIMEOUT_MS", 15 * 60 * 1000),
    /** Maximum number of cached sessions */
    maxSessions: envInt("CURSOR_MAX_SESSIONS", 100),
  },

  /**
   * Cache settings
   */
  cache: {
    /** Model cache TTL in milliseconds */
    modelTtlMs: envInt("CURSOR_MODEL_CACHE_TTL_MS", 5 * 60 * 1000),
    /** Maximum number of cached blobs */
    maxBlobs: envInt("CURSOR_MAX_BLOBS", 1000),
    /** Maximum blob size in bytes */
    maxBlobSize: envInt("CURSOR_MAX_BLOB_SIZE", 10 * 1024 * 1024),
  },

  /**
   * Network request settings
   */
  network: {
    /** Request timeout in milliseconds */
    requestTimeoutMs: envInt("CURSOR_REQUEST_TIMEOUT_MS", 120000),
    /** Maximum retry attempts for failed requests */
    maxRetries: envInt("CURSOR_MAX_RETRIES", 3),
    /** Base delay for exponential backoff in milliseconds */
    retryBaseDelayMs: envInt("CURSOR_RETRY_BASE_DELAY_MS", 1000),
    /** Maximum delay between retries in milliseconds */
    retryMaxDelayMs: envInt("CURSOR_RETRY_MAX_DELAY_MS", 30000),
    /** Enable automatic retry on transient errors */
    retryEnabled: envBool("CURSOR_RETRY_ENABLED", true),
  },

  /**
   * Heartbeat detection settings
   */
  heartbeat: {
    /** Idle timeout after progress in milliseconds */
    idleAfterProgressMs: envInt("CURSOR_HEARTBEAT_IDLE_PROGRESS_MS", 120000),
    /** Idle timeout before progress in milliseconds */
    idleBeforeProgressMs: envInt("CURSOR_HEARTBEAT_IDLE_NOPROGRESS_MS", 180000),
    /** Maximum heartbeats allowed after progress */
    maxAfterProgress: envInt("CURSOR_HEARTBEAT_MAX_PROGRESS", 1000),
    /** Maximum heartbeats allowed before progress */
    maxBeforeProgress: envInt("CURSOR_HEARTBEAT_MAX_NOPROGRESS", 1000),
  },

  /**
   * Server settings (for standalone proxy)
   */
  server: {
    /** Server port */
    port: envInt("PORT", 18741),
    /** Server host */
    host: envString("HOST", "localhost"),
  },

  /**
   * Cursor API settings
   */
  api: {
    /** Main API base URL */
    baseUrl: envString("CURSOR_API_URL", "https://api2.cursor.sh"),
    /** Agent privacy mode URL */
    agentPrivacyUrl: envString("CURSOR_AGENT_PRIVACY_URL", "https://agent.api5.cursor.sh"),
    /** Agent non-privacy mode URL */
    agentNonPrivacyUrl: envString("CURSOR_AGENT_NON_PRIVACY_URL", "https://agentn.api5.cursor.sh"),
    /** Enable privacy mode */
    privacyMode: envBool("CURSOR_PRIVACY_MODE", true),
    /** Try API5 fallback endpoints */
    tryApi5Fallback: envBool("CURSOR_AGENT_TRY_API5", false),
    /** Client version override */
    clientVersion: envString("CURSOR_CLIENT_VERSION", ""),
  },

  /**
   * Security settings
   */
  security: {
    /** Enable shell command validation */
    validateShellCommands: envBool("CURSOR_VALIDATE_SHELL", false),
    /** Maximum shell command execution time in milliseconds */
    shellTimeoutMs: envInt("CURSOR_SHELL_TIMEOUT_MS", 60000),
  },
} as const;

// --- Type Exports ---

export type Config = typeof config;
export type DebugConfig = typeof config.debug;
export type SessionConfig = typeof config.session;
export type CacheConfig = typeof config.cache;
export type NetworkConfig = typeof config.network;
export type HeartbeatConfig = typeof config.heartbeat;
export type ServerConfig = typeof config.server;
export type ApiConfig = typeof config.api;
export type SecurityConfig = typeof config.security;

// --- Utility Functions ---

/**
 * Check if debug mode is enabled
 */
export function isDebugEnabled(): boolean {
  return config.debug.enabled;
}

/**
 * Check if timing logs are enabled
 */
export function isTimingEnabled(): boolean {
  return config.debug.timing || config.debug.enabled;
}

/**
 * Check if session reuse is enabled
 */
export function isSessionReuseEnabled(): boolean {
  return config.session.reuseEnabled;
}

/**
 * Get the effective log level
 */
export function getLogLevel(): "error" | "warn" | "info" | "debug" {
  if (config.debug.enabled) return "debug";
  return config.debug.level;
}

/**
 * Check if request logging is enabled
 */
export function isRequestLoggingEnabled(): boolean {
  return config.debug.requestLogging || config.debug.enabled;
}

/**
 * Check if filtered IDs should be logged
 */
export function shouldLogFilteredIds(): boolean {
  return config.debug.logFilteredIds || config.debug.enabled;
}

/**
 * Check if multimodal content should be logged
 */
export function shouldLogMultimodal(): boolean {
  return config.debug.logMultimodal || config.debug.enabled;
}

/**
 * Check if JSON log format is enabled
 */
export function isJsonLogFormat(): boolean {
  return config.debug.jsonFormat;
}
