/** A tool as MCP `tools/list` describes it. */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
  [key: string]: unknown;
}

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpServerOptions {
  /** Where tool calls go. Defaults to `https://sfxmint.com`; HTTPS outside localhost. */
  origin?: string | URL;
  /**
   * Sent with every call when set, and adds the tools the remote server offers an account
   * (generation, kits). Defaults to `process.env.SFXMINT_API_KEY`. Library tools need no key.
   */
  apiKey?: string;
  /** Tags calls `via=internal` instead of `via=cli` (maintainer self-tests). */
  internal?: boolean;
  /** Reported as `serverInfo.version`. */
  version?: string;
}

export interface McpServer {
  /** One parsed JSON-RPC message in; the reply to send, or null for notifications and responses. */
  handle(message: unknown): Promise<JsonRpcMessage | null>;
}

/**
 * The SFXMint tools as a local MCP server. Each `tools/call` is forwarded to
 * `https://sfxmint.com/mcp`, so names, arguments and results match the remote server.
 */
export function createMcpServer(options?: McpServerOptions): McpServer;

/**
 * Serve over newline-delimited JSON-RPC (the MCP stdio transport) until `input` closes.
 * Resolves once replies still in flight are written.
 */
export function serveStdio(
  server: McpServer,
  streams?: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream },
): Promise<void>;

/** The four library tools, always listed; with a key, the account's tools follow them. */
export const LIBRARY_TOOLS: McpTool[];
export const PROTOCOL_VERSION: string;
export const INSTRUCTIONS: string;
