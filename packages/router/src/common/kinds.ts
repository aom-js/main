// Dictionaries of the route-chain projection (cursor metadata spec). Values are strings so
// serialized projections stay stable across versions; an unclassifiable item gets an explicit
// value (`Step`, `Other`), never a gap.

/**
 * Kind of a step (cursor) — a grouping, not an identity or a position. The router only stores
 * kinds declared with `\@CursorKind`; kinds derivable from core classes (`Handler`, `Checkpoint`,
 * `Input`, `Meta`) are inferred by `@aom-js/api/testing` (`kindOf`), the application adds kinds of
 * its own classes (`Transport` in `test`) and decides what a declared kind means.
 */
export enum AomCursorKind {
  /** The endpoint itself. */
  Handler = "handler",
  /** Access gate: may throw 401/403, writes no conditions. */
  Checkpoint = "checkpoint",
  /** Transport step of a shells container: writes seals. */
  Transport = "transport",
  /** Reads query, writes signs. */
  Filter = "filter",
  /** Question by an id from the path. */
  Value = "value",
  /** Reads shells, assembles the query. */
  Collector = "collector",
  /** Pager or count after the handler. */
  Pager = "pager",
  /** Shapes the response body (documentation-only). */
  Response = "response",
  /** Derived: api builders (QueryString/Body/Headers/Params/Cookie) and id values. */
  Input = "input",
  /** Derived: an empty step without parameters (`Setup`, incl. with `\@UseTag`). */
  Meta = "meta",
  /** Everything else (default). */
  Step = "step",
}

/** What a method parameter injects — written by every built-in parameter decorator into its descriptor. */
export enum AomParameterKind {
  /** A class instance (`\@This`). */
  This = "this",
  /** The request's instance map; with an argument — addressed read without creation (`\@State`). */
  State = "state",
  /** Dynamic composition point: `next(...handlers)` (`\@Run`). */
  Run = "run",
  /** Request input (`\@Query`/`\@Body`/`\@Params`/`\@Headers`/`\@Cookies`/`\@Session`/`\@Files`). */
  Values = "values",
  Cursor = "cursor",
  Route = "route",
  Ctx = "ctx",
  Req = "req",
  Res = "res",
  Err = "err",
  /** A custom `Args(...)`. */
  Other = "other",
}

/** Source of a `Values` parameter — the request field it reads. */
export enum AomValuesSource {
  Query = "query",
  Body = "body",
  Params = "params",
  Headers = "headers",
  Cookies = "cookies",
  Session = "session",
  Files = "files",
}

/** Why a cursor stands in the chain — derived while the chain is laid out (`Router.build`, `plain` in `common/route.ts`). */
export enum AomViaKind {
  /** The handler itself. */
  Endpoint = "endpoint",
  /** Method-level `\@Before` of the endpoint or of a step. */
  Before = "before",
  /** Method-level `\@After`. */
  After = "after",
  /** Expansion of `\@Next`. */
  Next = "next",
  /** Class-level `\@Before` (including one that came down through a bridge). */
  ClassBefore = "class-before",
  /** Class-level `\@After`: stands BEFORE the endpoint. */
  ClassAfter = "class-after",
}
