// Barrel: the package's public surface used to live entirely in this file. It's now split
// by concern (api.ts, cursor.ts, route.ts, context.ts) — this file re-exports exactly the
// names that were exported before the split, by name, so every existing
// `from "./common/classes"` / `from "../common/classes"` import keeps working unchanged.
// AomHttpOpenApiTags, AomHttpOpenApi, AomHttpParameters, AomApiElement (api.ts) and
// RxContext (context.ts) were never part of the public API and stay that way — not
// re-exported here.

export { TagsRules, AomApi } from "./api";
export type {
  ArgumentsHandlerParameters,
  ArgumentsDecoratorHandler,
  AomBridge,
  AomEndpoint,
  AomParameterDescriptor,
} from "./api";

export { AomCursor, resolveTarget } from "./cursor";
export type { AomCursorParameter } from "./cursor";

export { AomRoute } from "./route";
export type { MarkerType, MarkerHandler } from "./route";
