import type { IncomingMessage } from "node:http";

//
import { PayloadTooLargeResponse, WrongDataResponse } from "../responses";
import { messages } from "../constants";

/**
 * Options for {@link parseJsonBody}, and the shape stored under the `\@BodyOptions` route marker.
 */
export interface BodyParseOptions {
  /** Body size limit in bytes. `0` means no limit. Defaults to {@link DEFAULT_BODY_LIMIT}. */
  // body size limit in bytes; 0 means no limit
  limit?: number;
}

/**
 * Default JSON body size limit in bytes (1 MiB), used when neither `\@BodyOptions` on the route
 * nor `AomServerSettings.bodyLimit` specify one.
 */
// 1 MiB - a sane default for a JSON request body (approved by the author)
export const DEFAULT_BODY_LIMIT = 1_048_576;

/**
 * Marker set on the error thrown by {@link parseJsonBody} when the stream was already being read
 * and got cut off mid-way (limit exceeded while reading a `Transfer-Encoding: chunked` body whose
 * length wasn't known upfront).
 *
 * The unread remainder of the body is still sitting in the TCP buffer; on a keep-alive connection
 * it would otherwise be parsed as the start of the next request. Any caller that sees this marker
 * on a rejection **must** close the connection (`Connection: close`) instead of reusing it —
 * do not remove this check as an "optimization". Rejections that happen before the stream is
 * touched at all (declared `Content-Length` already over the limit) do not carry this marker and
 * do not need `Connection: close`: the runtime drains the untouched body on its own.
 */
// marker on the error object: the stream started being read and was aborted halfway through. The
// unread remainder of the body stays in the TCP buffer and on a keep-alive connection would be
// parsed as the start of the next request - calling code must close the connection
// (Connection: close) after such an error, not reuse it
export const BODY_UNREAD: unique symbol = Symbol("body-unread");

/**
 * Reads and parses a JSON request body from a raw Node.js `IncomingMessage`, enforcing a size limit.
 *
 * This is the primitive behind `Server`'s lazy body handling (see the `body: lazy(...)` wrapper in
 * `Server`'s request handler), but it has no dependency on `Server` and is exported as a
 * self-contained brick for adapters that wire `@aom-js/router` into other HTTP frameworks.
 *
 * Behaviour to rely on:
 * - If `content-type` is anything other than `application/json` (parameters after `;` and casing
 *   are ignored per RFC 7231), the stream is **not touched at all** and the promise resolves with
 *   `{}`. This is intentional and load-bearing — it is what lets an application hand the same raw
 *   stream to formidable (or any other multipart parser) for file uploads. Do not change this to
 *   sniff or pre-read multipart bodies here.
 * - If the request declares `Content-Length` larger than `limit`, the promise rejects with
 *   `PayloadTooLargeResponse` **before a single `"data"` listener is attached** — the runtime
 *   drains the never-read body on its own and the connection stays reusable; no `Connection: close`
 *   is needed.
 * - If the length isn't known upfront (`Transfer-Encoding: chunked`) and the limit is only
 *   exceeded while reading, the rejection carries the {@link BODY_UNREAD} marker: part of the body
 *   has already been pulled off the TCP stream, and the unread remainder would otherwise be parsed
 *   as the start of the next request on a keep-alive connection. Callers that see `BODY_UNREAD`
 *   on the rejection must close the connection instead of reusing it (`Server` does this).
 * - Chunks are buffered as `Buffer`s and concatenated once at the end rather than decoded and
 *   joined as strings per chunk, which would corrupt multi-byte UTF-8 characters split across a
 *   TCP chunk boundary.
 *
 * @param req - raw incoming request; only its `headers` are read for the content-type/length
 * checks, and `data`/`end`/`error` listeners are attached to the stream unless the content-type
 * check short-circuits first
 * @param options - `{ limit }` in bytes; `0` disables the limit; defaults to {@link DEFAULT_BODY_LIMIT}
 * @returns the parsed body, or `{}` when the content type isn't `application/json`
 * @throws {PayloadTooLargeResponse} when the body exceeds `limit` (HTTP 413)
 * @throws {WrongDataResponse} when the body is not valid JSON (HTTP 400)
 *
 * @example
 * ```ts
 * import { parseJsonBody, BODY_UNREAD } from "@aom-js/api";
 * import { lazy, type HttpContextValues } from "@aom-js/router";
 *
 * // adapter that already has a parsed body (e.g. Express + body-parser): pass the ready value
 * const readyValues: HttpContextValues = {
 *   ctx: { req, res }, req, res,
 *   body: req.body,
 *   query: req.query, params: req.params, cookies: req.cookies, headers: req.headers,
 *   session: {}, files: {},
 * };
 *
 * // adapter that only hands out the raw stream: defer parsing until the first \@Body access
 * const lazyValues: HttpContextValues = {
 *   ctx: { req, res }, req, res,
 *   body: lazy(async () => {
 *     try {
 *       return await parseJsonBody(req, { limit: 1_048_576 });
 *     } catch (err: any) {
 *       if (err?.[BODY_UNREAD]) res.setHeader("Connection", "close");
 *       throw err;
 *     }
 *   }),
 *   query: {}, params: {}, cookies: {}, headers: {}, session: {}, files: {},
 * };
 * ```
 */
export async function parseJsonBody(
  req: IncomingMessage,
  options?: BodyParseOptions,
): Promise<any> {
  const limit = options?.limit ?? DEFAULT_BODY_LIMIT;

  return new Promise((resolve, reject) => {
    // charset and other content-type parameters are a standard part of the header - drop everything
    // after `;`; the type's own casing doesn't matter (RFC 7231)
    const contentType = req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      // the stream isn't touched at all - file uploads via formidable in the application rely on this
      resolve({});
      return;
    }

    // rejection by the declared length happens before the single "on" on the stream: the runtime
    // drains the body on its own, and the connection stays usable without the caller doing anything
    const contentLength = Number(req.headers["content-length"]);
    if (limit && Number.isFinite(contentLength) && contentLength > limit) {
      reject(new PayloadTooLargeResponse(messages.ERROR_PAYLOAD_TOO_LARGE));
      return;
    }

    // accumulate raw Buffer chunks and join them once: concatenating decoded strings per chunk
    // corrupts multi-byte UTF-8 characters that are split exactly on a TCP chunk boundary
    const chunks: Buffer[] = [];
    let received = 0;

    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };

    const onData = (chunk: Buffer) => {
      received += chunk.length;
      if (limit && received > limit) {
        cleanup();
        // the stream is already partially read - we don't close the connection ourselves (that's
        // the caller's responsibility), we only tag the error with the marker and stop reading
        req.pause();
        const err = new PayloadTooLargeResponse(messages.ERROR_PAYLOAD_TOO_LARGE);
        Reflect.set(err, BODY_UNREAD, true);
        reject(err);
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      cleanup();
      try {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new WrongDataResponse(messages.ERROR_WRONG_DATA));
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}
