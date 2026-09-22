// Local fixture server. No network, no production traffic.
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";

export const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** A sound payload whose format_metadata actually matches the bytes we serve. */
export function makeSound(slug, { format = "mp3", bytes, ...extra } = {}) {
  const body = bytes ?? randomBytes(64);
  return {
    body,
    sound: {
      slug,
      title: `Title for ${slug}`,
      duration_ms: 1000,
      loopable: false,
      license: "CC0-1.0",
      page_url: `https://example.invalid/sounds/${slug}`,
      mp3_url: `ORIGIN/dl/${slug}.mp3`,
      wav_url: `ORIGIN/dl/${slug}.wav`,
      ogg_url: `ORIGIN/dl/${slug}.ogg`,
      format_metadata: {
        [format]: {
          decodable: true,
          sha256: sha256(body),
          bytes: body.length,
          duration_ms: 1000,
        },
      },
      ...extra,
    },
  };
}

/**
 * @param {object} routes  pathname → handler(url) returning JSON, or a Buffer for /dl/
 */
export async function startServer(routes) {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    requests.push({ path: url.pathname, search: url.searchParams, url });
    const handler = routes[url.pathname];
    if (!handler) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found", message: "no route" }));
      return;
    }
    const value = typeof handler === "function" ? handler(url) : handler;
    if (Buffer.isBuffer(value)) {
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end(value);
      return;
    }
    if (value?.status) {
      res.writeHead(value.status, { "content-type": "application/json" });
      res.end(JSON.stringify(value.body ?? {}));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    requests,
    /** Rewrites the ORIGIN placeholder in fixtures to this server. */
    rewrite: (obj) => JSON.parse(JSON.stringify(obj).replaceAll("ORIGIN", origin)),
    close: () => new Promise((r) => server.close(r)),
  };
}
