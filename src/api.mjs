// SFXMint JSON API client. No key, no signup. Node 20+, no dependencies.
//
// Three lookup branches, same shape out: { role, sound } where `sound` always carries
// `format_metadata` so the caller can verify bytes. These are branches, not a sequence —
// see https://sfxmint.com/api/docs
//
// `/api/v1/roles/{role}` does not return format_metadata, so the role branch makes a second
// hop to `/api/v1/sounds/{slug}`. That keeps integrity checks identical across all branches
// instead of leaving one of them unverified.

export const DEFAULT_ORIGIN = "https://sfxmint.com";
export const FORMATS = ["mp3", "wav", "ogg"];
export const STYLES = ["balanced", "crisp", "soft", "spacious"];

/** Tells SFXMint the request came through this CLI. Changes nothing in the response. */
const VIA = "cli";

// Maintainer self-tests must not land in the `cli` channel they are meant to measure.
// SFXMINT_INTERNAL=1 marks a request as internal on both axes the site classifies on.
const INTERNAL_VIA = "internal";
const INTERNAL_UA = "Mozilla/5.0 (Macintosh) sfxmint-internal/1.0";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function parseOrigin(value) {
  const origin = new URL(value ?? DEFAULT_ORIGIN);
  if (origin.protocol !== "https:" && !LOCAL_HOSTS.includes(origin.hostname)) {
    throw new Error("HTTPS is required outside localhost");
  }
  return origin;
}

function apiUrl(origin, path, params = {}, via = VIA) {
  const url = new URL(path, origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set("via", via);
  return url;
}

export function createFetcher({ timeoutMs = 30000, internal = false } = {}) {
  const via = internal ? INTERNAL_VIA : VIA;
  const userAgent = internal ? INTERNAL_UA : undefined;
  const state = { requests: 0 };
  async function get(url) {
    state.requests++;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: userAgent ? { "User-Agent": userAgent } : {},
    });
    if (!res.ok) {
      const detail = await res
        .json()
        .then((b) => b?.message || b?.error)
        .catch(() => null);
      const err = new Error(
        `HTTP ${res.status} ${url.pathname}${detail ? `: ${detail}` : ""}`,
      );
      err.status = res.status;
      throw err;
    }
    return res;
  }
  return { get, json: async (url) => (await get(url)).json(), state, via };
}

/** Full metadata for one slug, including per-format sha256 and byte counts. */
async function fetchSound(origin, fetcher, slug) {
  return fetcher.json(
    apiUrl(origin, `/api/v1/sounds/${encodeURIComponent(slug)}`, {}, fetcher.via),
  );
}

/**
 * Role branch. `roles` are ids or aliases: button-click, click, coin, jump, purchase-success…
 * Unknown role → 404 with a pointer to the index, surfaced as a readable error.
 */
export async function resolveRoles(origin, fetcher, roles, { style } = {}) {
  if (style && !STYLES.includes(style)) {
    throw new Error(`--style must be one of: ${STYLES.join(", ")}`);
  }
  const selections = [];
  const missingRoles = [];
  for (const role of roles) {
    let head;
    try {
      head = await fetcher.json(
        apiUrl(origin, `/api/v1/roles/${encodeURIComponent(role)}`, { style }, fetcher.via),
      );
    } catch (err) {
      if (err.status === 404) {
        throw new Error(
          `Unknown role "${role}". Browse ${new URL("/api/v1/roles", origin).href} ` +
            `or use: sfxmint search "${role}"`,
        );
      }
      throw err;
    }
    // A known role whose default fails its own checks (a loop not yet verified seamless)
    // answers with an error and near matches, no slug. Report it like a set's missing role.
    if (!head.slug) {
      missingRoles.push(role);
      continue;
    }
    const sound = await fetchSound(origin, fetcher, head.slug);
    selections.push({ role, sound: { ...sound, label: head.label } });
  }
  if (!selections.length) {
    throw new Error(
      `No file passes its checks yet for: ${missingRoles.join(", ")}. Near matches were not substituted.`,
    );
  }
  return { selections, missingRoles };
}

/** Set branch: a coherent kit for one product, as role → sound. */
export async function resolveSet(origin, fetcher, setId, { format } = {}) {
  let set;
  try {
    set = await fetcher.json(
      apiUrl(origin, `/api/v1/sets/${encodeURIComponent(setId)}`, { format }, fetcher.via),
    );
  } catch (err) {
    if (err.status === 404) {
      throw new Error(
        `Unknown set "${setId}". Browse ${new URL("/api/v1/sets", origin).href}`,
      );
    }
    throw err;
  }
  const selections = Object.entries(set.sounds ?? {}).map(([role, sound]) => ({
    role,
    sound,
  }));
  if (!selections.length) {
    throw new Error(
      `Set "${setId}" has no deliverable sounds` +
        (set.missing_roles?.length ? ` (missing: ${set.missing_roles.join(", ")})` : ""),
    );
  }
  // A set can be short a role. Deliver what exists and report the gap loudly rather than
  // failing the whole kit — but never quietly, or the project ships a silent event.
  return { selections, missingRoles: set.missing_roles ?? [] };
}

/**
 * Search branch: free text that matches no role. Hard conditions apply before the limit,
 * and near matches are never promoted into candidates — a gap is reported as a gap.
 */
export async function resolveSearch(
  origin,
  fetcher,
  query,
  { format, limit = 3, maxDurationMs, loop, category, pick = 1 } = {},
) {
  if (!Number.isInteger(pick) || pick < 1 || pick > limit) {
    throw new Error(`--pick must be an integer between 1 and ${limit}`);
  }
  const result = await fetcher.json(
    apiUrl(
      origin,
      "/api/v1/search",
      {
        q: query,
        response: "structured",
        limit,
        format,
        category,
        max_duration_ms: maxDurationMs,
        loop: loop === undefined ? undefined : String(loop),
      },
      fetcher.via,
    ),
  );
  const candidate = result.candidates?.[pick - 1];
  if (!candidate) {
    const near = result.near_matches?.length ?? 0;
    throw new Error(
      `No candidate meets the stated conditions for "${query}"` +
        (near ? ` (${near} near matches were not substituted).` : ".") +
        " Relax a condition or try a different description.",
    );
  }
  // Structured candidates carry checks but not always full format_metadata; resolve the slug.
  const sound = await fetchSound(origin, fetcher, candidate.slug);
  return {
    selections: [
      {
        role: candidate.slug,
        sound: {
          ...sound,
          checks: candidate.checks,
          unverified_requirements: candidate.unverified_requirements,
          content_check: candidate.content_check ?? sound.content_check ?? null,
        },
      },
    ],
    requestId: result.request_id ?? null,
  };
}
