/**
 * Constructor settings for {@link Server}.
 *
 * @example
 * ```ts
 * import { Server, type AomServerSettings } from "@aom-js/api";
 *
 * const settings: AomServerSettings = { port: 3000, url: "http://localhost" };
 * new Server(settings, router);
 * ```
 */
export interface AomServerSettings {
  /** TCP port the server listens on; passed straight to `http.Server.listen`. */
  port: number;
  /** Base URL of the deployment; its `pathname` is prepended to every incoming request path. */
  url: string;
  /** Optional display name for the server instance; not used by `Server` itself. */
  name?: string;
  /**
   * Global JSON body size limit in bytes, used when a route has no `\@BodyOptions` marker.
   * Defaults to `DEFAULT_BODY_LIMIT` (1 MiB) when omitted; `0` removes the limit entirely.
   * Lifting the limit is only safe behind infrastructure (reverse proxy, load balancer) that
   * already caps request size — otherwise an unauthenticated client can make the process buffer
   * an unbounded body in memory.
   */
  // JSON request body size limit in bytes; defaults to DEFAULT_BODY_LIMIT, 0 means no limit
  bodyLimit?: number;
}
