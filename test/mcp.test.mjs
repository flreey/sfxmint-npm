import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createMcpServer, INSTRUCTIONS, LIBRARY_TOOLS } from "../src/mcp.mjs";
import { ACCOUNT_DESCRIPTIONS } from "../src/mcp-tools.mjs";
import { startServer } from "./helpers.mjs";

const BIN = fileURLToPath(new URL("../bin/sfxmint.mjs", import.meta.url));
const KEY = "sfx_live_" + "b".repeat(40);
const ACCOUNT_TOOL = { name: "generate_sound", description: "Make a sound", inputSchema: { type: "object", properties: {} } };
const KIT_TOOL = { name: "start_game_kit", description: "Plan a kit", inputSchema: { type: "object", properties: {} } };
/** The account's tools as the package lists them: the server's schema, the bundled words. */
const bundled = (tool) => ({ ...tool, description: ACCOUNT_DESCRIPTIONS[tool.name] });
const SEARCH_RESULT = {
  content: [{ type: "text", text: JSON.stringify({ request_id: "r1", results: [{ slug: "coin-01" }], count: 1, library_fit: "full" }) }],
};

/** A stand-in for https://sfxmint.com/mcp: answers the way the Worker does, and records each call. */
async function remoteMcp({ tools = [...LIBRARY_TOOLS, ACCOUNT_TOOL, KIT_TOOL] } = {}) {
  return startServer({
    "/mcp": (_url, rpc) => {
      const reply = (result) => ({ jsonrpc: "2.0", id: rpc.id, result });
      switch (rpc.method) {
        case "initialize":
          return reply({ protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, instructions: "Remote instructions with generation." });
        case "tools/list":
          return reply({ tools });
        case "tools/call":
          if (rpc.params.name === "search_sounds") return reply(SEARCH_RESULT);
          if (rpc.params.name === "generate_sound") {
            return reply({ isError: true, content: [{ type: "text", text: '{"error":"api_key_required"}' }] });
          }
          return { jsonrpc: "2.0", id: rpc.id, error: { code: -32602, message: `Unknown tool: ${rpc.params.name}` } };
        default:
          return { jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Method not found" } };
      }
    },
  });
}

const request = (id, method, params) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });

test("initialize answers locally with the library instructions when there is no key", async () => {
  const remote = await remoteMcp();
  const server = createMcpServer({ origin: remote.origin, apiKey: "", version: "9.9.9" });
  const reply = await server.handle(request(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } }));
  assert.equal(reply.id, 1);
  assert.equal(reply.result.protocolVersion, "2025-03-26", "echoes the client's version");
  assert.deepEqual(reply.result.capabilities, { tools: {} });
  assert.deepEqual(reply.result.serverInfo, { name: "sfxmint", version: "9.9.9" });
  assert.equal(reply.result.instructions, INSTRUCTIONS);
  assert.equal(remote.requests.length, 0, "no network for the handshake");
  await remote.close();
});

test("without a key tools/list is the bundled library tools, with no network", async () => {
  const remote = await remoteMcp();
  const server = createMcpServer({ origin: remote.origin, apiKey: "" });
  const reply = await server.handle(request(2, "tools/list"));
  assert.deepEqual(reply.result.tools.map((t) => t.name), ["search_sounds", "get_role_sound", "get_sound", "get_sound_set"]);
  assert.deepEqual(reply.result.tools, LIBRARY_TOOLS);
  assert.equal(remote.requests.length, 0);
  await remote.close();
});

// Directory rule (98eb9324): a description says what its tool does, nothing about other tools or how the model should act.
test("each tool's description names no other tool and gives no instruction", () => {
  const described = [...LIBRARY_TOOLS.map((t) => [t.name, t.description]), ...Object.entries(ACCOUNT_DESCRIPTIONS)];
  const names = described.map(([name]) => name);
  for (const [name, description] of described) {
    for (const other of names) if (other !== name) assert.ok(!description.includes(other), `${name} names ${other}`);
    assert.doesNotMatch(description, /\b(prefer|instead|you should|should|always|never|tell the user|let the user|choose this|use it when|then call)\b/i, name);
    assert.ok(description.length > 60, name);
  }
  assert.doesNotMatch(JSON.stringify(described), /\$\d|pricing/, "no prices in the package");
  assert.doesNotMatch(JSON.stringify(LIBRARY_TOOLS), /generate_sound/, "no generation among the library tools");
});

test("with a key the account's tools follow the library tools, in the bundled words, and every call carries the key", async () => {
  // The remote server's descriptions point at other tools; the bundled ones are listed instead. A tool the package
  // has no words for yet is left out.
  const NEW_TOOL = { name: "brand_new_tool", description: "Then call generate_sound", inputSchema: { type: "object", properties: {} } };
  const remote = await remoteMcp({ tools: [{ ...LIBRARY_TOOLS[0], description: "Choose get_role_sound instead" }, ...LIBRARY_TOOLS.slice(1), ACCOUNT_TOOL, KIT_TOOL, NEW_TOOL] });
  const server = createMcpServer({ origin: remote.origin, apiKey: KEY });
  const init = await server.handle(request(1, "initialize", { protocolVersion: "2025-06-18" }));
  assert.equal(init.result.instructions, "Remote instructions with generation.");
  const list = await server.handle(request(2, "tools/list"));
  assert.deepEqual(list.result.tools, [...LIBRARY_TOOLS, bundled(ACCOUNT_TOOL), bundled(KIT_TOOL)]);
  const [listCall] = remote.requests.filter((r) => r.body.method === "tools/list");
  assert.equal(listCall.method, "POST");
  assert.equal(listCall.path, "/mcp");
  assert.equal(listCall.search.get("via"), "cli");
  // A second list is served from memory.
  await server.handle(request(3, "tools/list"));
  assert.equal(remote.requests.filter((r) => r.body.method === "tools/list").length, 1);
  const gen = await server.handle(request(4, "tools/call", { name: "generate_sound", arguments: { prompt: "laser" } }));
  assert.equal(gen.result.isError, true, "the remote refusal is passed on as a tool result");
  assert.ok(remote.requests.every((r) => r.authorization === `Bearer ${KEY}`));
  await remote.close();
});

test("with a key and SFXMint unreachable, tools/list is the library tools until it answers again", async () => {
  let up = false;
  const flaky = await startServer({
    "/mcp": (_url, rpc) => (up ? { jsonrpc: "2.0", id: rpc.id, result: { tools: [...LIBRARY_TOOLS, ACCOUNT_TOOL] } } : { status: 503, body: { error: "unavailable" } }),
  });
  const server = createMcpServer({ origin: flaky.origin, apiKey: KEY });
  assert.deepEqual((await server.handle(request(1, "tools/list"))).result.tools, LIBRARY_TOOLS);
  // The fallback is not kept: once the server answers, the account's tools are added.
  up = true;
  assert.deepEqual((await server.handle(request(2, "tools/list"))).result.tools, [...LIBRARY_TOOLS, bundled(ACCOUNT_TOOL)]);
  await flaky.close();

  const gone = await startServer({});
  const origin = gone.origin;
  await gone.close();
  const offline = createMcpServer({ origin, apiKey: KEY });
  assert.deepEqual((await offline.handle(request(3, "tools/list"))).result.tools, LIBRARY_TOOLS, "a key adds nothing offline");
  assert.equal((await offline.handle(request(4, "initialize", {}))).result.instructions, INSTRUCTIONS);
});

test("tools/call forwards the name and arguments and returns the remote result unchanged", async () => {
  const remote = await remoteMcp();
  const server = createMcpServer({ origin: remote.origin, apiKey: "" });
  const args = { query: "coin pickup", limit: 3, format: "wav" };
  const reply = await server.handle(request("a", "tools/call", { name: "search_sounds", arguments: args }));
  assert.equal(reply.id, "a");
  assert.deepEqual(reply.result, SEARCH_RESULT);
  const [call] = remote.requests;
  assert.equal(call.body.method, "tools/call");
  assert.deepEqual(call.body.params, { name: "search_sounds", arguments: args });
  assert.equal(call.search.get("via"), "cli");
  await remote.close();
});

test("a remote refusal stays a JSON-RPC error; an unreachable server is a tool error, not a crash", async () => {
  const remote = await remoteMcp();
  const server = createMcpServer({ origin: remote.origin, apiKey: "" });
  const unknown = await server.handle(request(1, "tools/call", { name: "no_such_tool", arguments: {} }));
  assert.deepEqual(unknown.error, { code: -32602, message: "Unknown tool: no_such_tool" });
  const nameless = await server.handle(request(2, "tools/call", {}));
  assert.equal(nameless.error.code, -32602);
  const origin = remote.origin;
  await remote.close();

  const offline = createMcpServer({ origin, apiKey: "" });
  const reply = await offline.handle(request(3, "tools/call", { name: "search_sounds", arguments: { query: "coin" } }));
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /SFXMint did not answer/);
});

test("notifications and responses get no reply; unknown methods and bad messages get JSON-RPC errors", async () => {
  const server = createMcpServer({ origin: "http://127.0.0.1:9", apiKey: "" });
  assert.equal(await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.equal(await server.handle({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } }), null);
  assert.equal(await server.handle({ jsonrpc: "2.0", id: 7, result: {} }), null);
  assert.deepEqual(await server.handle(request(0, "ping")), { jsonrpc: "2.0", id: 0, result: {} });
  assert.equal((await server.handle(request(1, "sampling/createMessage"))).error.code, -32601);
  assert.deepEqual((await server.handle(request(2, "resources/list"))).result, { resources: [] });
  assert.equal((await server.handle([request(3, "ping")])).error.code, -32600);
  assert.equal((await server.handle("ping")).error.code, -32600);
});

test("internal mode keeps self-tests out of the cli channel", async () => {
  const remote = await remoteMcp();
  const server = createMcpServer({ origin: remote.origin, apiKey: "", internal: true });
  await server.handle(request(1, "tools/call", { name: "search_sounds", arguments: { query: "coin" } }));
  assert.equal(remote.requests[0].search.get("via"), "internal");
  assert.match(remote.requests[0].userAgent, /sfxmint-internal/);
  await remote.close();
});

test("`sfxmint mcp` speaks newline-delimited JSON-RPC on stdio and exits when stdin closes", async () => {
  const remote = await remoteMcp();
  const child = spawn(process.execPath, [BIN, "mcp", "--origin", remote.origin], {
    env: { ...process.env, SFXMINT_API_KEY: "", SFXMINT_INTERNAL: "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const replies = new Map();
  const lines = [];
  const waiting = new Promise((resolve) => {
    createInterface({ input: child.stdout }).on("line", (line) => {
      lines.push(line);
      const reply = JSON.parse(line);
      replies.set(reply.id, reply);
      if (replies.size === 5) resolve();
    });
  });
  const write = (message) => child.stdin.write(`${typeof message === "string" ? message : JSON.stringify(message)}\n`);
  write(request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } }));
  write({ jsonrpc: "2.0", method: "notifications/initialized" });
  write("{not json");
  write(request(2, "tools/list"));
  write(request(3, "tools/call", { name: "search_sounds", arguments: { query: "coin" } }));
  write(request(4, "ping"));
  await waiting;
  child.stdin.end();
  const code = await new Promise((resolve) => child.on("close", resolve));

  assert.equal(code, 0);
  assert.equal(stderr, "", "nothing on stderr");
  assert.equal(lines.length, 5, "one line per reply, none for the notification");
  assert.equal(replies.get(1).result.serverInfo.name, "sfxmint");
  assert.equal(replies.get(null).error.code, -32700);
  assert.equal(replies.get(2).result.tools.length, 4);
  assert.deepEqual(replies.get(3).result, SEARCH_RESULT);
  assert.deepEqual(replies.get(4).result, {});
  await remote.close();
});
