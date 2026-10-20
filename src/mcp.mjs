// SFXMint as a local MCP server over stdio: `npx sfxmint mcp`. Node 20+, no dependencies.
//
// Each tools/call goes to the public MCP endpoint (https://sfxmint.com/mcp?via=cli), so tool names,
// arguments and results are the remote server's, field for field — the /api/v1 routes answer in
// other shapes. The four library tools need no key and are always listed from the bundled copy
// (src/mcp-tools.mjs), whose descriptions say only what each tool does. With SFXMINT_API_KEY set,
// calls carry it and tools/list adds the other tools the remote server offers that account
// (generation, kits): which ones and their input schemas come from the server's live list, their
// descriptions from the bundled copy, under the same rule and without prices.
//
// Transport: one JSON-RPC message per line on stdin and stdout. Nothing else is written to stdout.

import { createInterface } from "node:readline";
import { DEFAULT_ORIGIN, createFetcher, parseOrigin } from "./api.mjs";
import { ACCOUNT_DESCRIPTIONS, LIBRARY_TOOLS, LIBRARY_TOOL_NAMES } from "./mcp-tools.mjs";

export { LIBRARY_TOOLS };

export const PROTOCOL_VERSION = "2025-06-18";
const LIST_TIMEOUT_MS = 5000;
// generate_sound waits up to about 25 s on the server for its takes before answering.
const CALL_TIMEOUT_MS = 60000;

// The remote handshake's library guidance (worker/routes/mcp.ts), with what this server lists.
export const INSTRUCTIONS =
  "SFXMint is an optional free CC0 sound effects library for apps and games, with MP3/WAV file URLs and no API key. Choose tools by task: get_role_sound for a named event, get_sound_set for multiple events, search_sounds for a description or a gap. These are task branches, not a fixed sequence. Use the library only where it helps; other task-permitted sources or local synthesis may be combined with library files. Hard duration, loop and format requirements are met by every search result and closest sound. When search_sounds has no full match, judge its closest sounds (missing_terms) yourself and let the user listen; near_matches fail a condition, and match scores are ranking evidence only. Five core game roles expose content_check, scoped to scene, role, format and exact file SHA256. Unverified previews need listening. Download selected files into the project and retain originals, source URLs, license and hashes; a SOUNDS.md listing each file with its page_url keeps the source visible in the repository. Task-permitted processing requires a recipe and output SHA256, renewed file checks and a listening check; changed bytes do not inherit content review. Verify event playback, first-interaction unlock, mute, volume and offline use, and let the user judge the result in context. get_sound provides exact file metadata. If the library's closest sounds do not suit, offer generate_available.page so the user can try the description in Studio without an API key. Generation tools are listed only when SFXMINT_API_KEY is set, and they need a pass or plan on the account; the user chooses whether to buy, an agent never pays. Do not use paid services without task authorization.";

function rpcError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * @param {{ origin?: string | URL, apiKey?: string, internal?: boolean, version?: string, fetcher?: object }} [options]
 */
export function createMcpServer({ origin = DEFAULT_ORIGIN, apiKey, internal = false, version = "0.0.0", fetcher } = {}) {
  const http = fetcher ?? createFetcher({ internal, apiKey, timeoutMs: CALL_TIMEOUT_MS });
  const endpoint = new URL("/mcp", parseOrigin(String(origin)));
  endpoint.searchParams.set("via", http.via);
  let nextId = 1;
  let listed = null;
  let remoteInstructions = null;

  async function remote(method, params, timeoutMs) {
    const reply = await http.post(endpoint, { jsonrpc: "2.0", id: nextId++, method, params }, { timeoutMs });
    if (reply?.error) {
      throw Object.assign(new Error(reply.error.message ?? "Remote error"), { remote: reply.error });
    }
    return reply?.result;
  }

  async function listTools() {
    if (!http.hasKey) return LIBRARY_TOOLS;
    if (listed) return listed;
    try {
      const tools = (await remote("tools/list", {}, LIST_TIMEOUT_MS))?.tools;
      if (Array.isArray(tools)) {
        const account = tools
          .filter((tool) => !LIBRARY_TOOL_NAMES.has(tool?.name) && Object.hasOwn(ACCOUNT_DESCRIPTIONS, tool?.name))
          .map((tool) => ({ ...tool, description: ACCOUNT_DESCRIPTIONS[tool.name] }));
        return (listed = [...LIBRARY_TOOLS, ...account]);
      }
    } catch {
      // Offline or the server is down: the library tools still work once it answers again.
    }
    return LIBRARY_TOOLS;
  }

  /** With a key the remote handshake names what the account can do; without one, the library text. */
  async function instructions(params) {
    if (!http.hasKey) return INSTRUCTIONS;
    if (remoteInstructions) return remoteInstructions;
    try {
      const result = await remote("initialize", params, LIST_TIMEOUT_MS);
      if (typeof result?.instructions === "string") return (remoteInstructions = result.instructions);
    } catch {
      // Fall back to the library text below.
    }
    return INSTRUCTIONS;
  }

  async function callTool(params) {
    const name = params?.name;
    if (typeof name !== "string" || !name) throw rpcError(-32602, "tools/call needs a tool name");
    try {
      return await remote("tools/call", { name, arguments: params.arguments ?? {} });
    } catch (err) {
      // The remote server's own refusal (unknown tool, invalid arguments) reaches the client as it is.
      if (err.remote) throw rpcError(err.remote.code ?? -32603, err.remote.message ?? "Remote error");
      return {
        isError: true,
        content: [{ type: "text", text: `SFXMint did not answer (${err.message}). Try again in a moment.` }],
      };
    }
  }

  async function dispatch(method, params) {
    switch (method) {
      case "initialize":
        return {
          protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "sfxmint", version },
          instructions: await instructions(params),
        };
      case "ping":
        return {};
      case "tools/list":
        return { tools: await listTools() };
      case "tools/call":
        return callTool(params);
      // Not offered, but some clients ask regardless; an empty answer keeps them quiet.
      case "resources/list":
        return { resources: [] };
      case "resources/templates/list":
        return { resourceTemplates: [] };
      case "prompts/list":
        return { prompts: [] };
      default:
        throw rpcError(-32601, `Method not found: ${method}`);
    }
  }

  /** One parsed JSON-RPC message in, the reply to write out (null for notifications and responses). */
  async function handle(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
    }
    const { id, method } = message;
    // A response to a request of ours: this server never sends one.
    if (typeof method !== "string") return null;
    const isRequest = id !== undefined && id !== null;
    if (!isRequest || method.startsWith("notifications/")) return null;
    try {
      const params = message.params && typeof message.params === "object" ? message.params : {};
      return { jsonrpc: "2.0", id, result: await dispatch(method, params) };
    } catch (err) {
      return { jsonrpc: "2.0", id, error: { code: err.code ?? -32603, message: err.message || "Internal error" } };
    }
  }

  return { handle };
}

/**
 * Serves `server` over newline-delimited JSON-RPC until the input closes, then waits for
 * replies still in flight. Requests are handled concurrently: a slow tool call does not hold
 * up a ping.
 */
export function serveStdio(server, { input = process.stdin, output = process.stdout } = {}) {
  const pending = new Set();
  const send = (reply) => {
    if (reply) output.write(`${JSON.stringify(reply)}\n`);
  };
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    // handle() answers every failure itself; this only catches a write to a closed output.
    const work = server.handle(message).then(send).catch((err) => {
      process.stderr.write(`sfxmint mcp: ${err.message}\n`);
    });
    pending.add(work);
    work.finally(() => pending.delete(work));
  });
  return new Promise((resolve) => {
    lines.on("close", () => Promise.allSettled([...pending]).then(() => resolve()));
  });
}
