/**
 * Unfolds `Sec-WebSocket-Protocol` into plain request headers. A browser `WebSocket` can't set
 * handshake headers, so the client passes the same headers object it gives `fetch`, with built-ins
 * only: `new WebSocket(url, [encodeURIComponent(JSON.stringify(headers))])`. Every element of the
 * header (comma-separated) that decodes to a JSON object contributes its string values; broken
 * elements and non-objects are skipped. Names are lowercased (as `node:http` does with real
 * headers), so a later key wins over the same key in another case.
 *
 * @param value - the `sec-websocket-protocol` header as `node:http` gives it
 * @param allowed - names to extract (case-insensitive); omitted — every name, empty — none
 * @returns the unfolded headers, lowercased names
 *
 * @example
 * ```ts
 * protocolHeaders(encodeURIComponent(JSON.stringify({ Authorization: "Bearer t" })));
 * // { authorization: "Bearer t" }
 * ```
 */
export function protocolHeaders(
  value: string | string[] | undefined,
  allowed?: string[],
): Record<string, string> {
  const names = allowed && new Set(allowed.map((name) => name.toLowerCase()));
  const result: Record<string, string> = {};
  for (const element of [value ?? []].flat().join(",").split(",")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeURIComponent(element.trim()));
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    for (const [key, item] of Object.entries(parsed)) {
      const name = key.toLowerCase();
      if (typeof item === "string" && (!names || names.has(name))) result[name] = item;
    }
  }
  return result;
}
