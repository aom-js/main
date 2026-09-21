import type { HTTPMethods } from "@aom-js/router";

/** Role of a node in a cursor chain: the same vocabulary labels the blocks rendered in the HTML page. */
export type VisualNodeKind =
  "controller" | "middleware" | "endpoint" | "websocket" | "nextpoint" | "marker" | "hook";

/** Where a parameter is read from — matches OpenAPI's `in`. */
export type VisualParameterIn = "path" | "query" | "header" | "cookie";

/** Reference to a component schema, or an inline description of a type that did not resolve to one. */
export interface VisualSchemaRef {
  /** Component schema name, when the value collapsed to a `$ref`. */
  ref?: string;
  /** Short type label for inline schemas: `string`, `array<Foo>`, `object`. */
  label: string;
  isArray?: boolean;
}

export interface VisualParameter {
  name: string;
  in: VisualParameterIn;
  required?: boolean;
  description?: string;
  schema: VisualSchemaRef;
}

export interface VisualResponse {
  status: string;
  description?: string;
  contentType: string;
  schema: VisualSchemaRef;
}

export interface VisualRequestBody {
  description?: string;
  contentType: string;
  schema: VisualSchemaRef;
}

/** One link in a route's execution chain — a single router cursor. */
export interface VisualChainItem {
  /** `Class.method`, matches `AomApi.toString()`. */
  id: string;
  cls: string;
  method?: string;
  kind: VisualNodeKind;
  /** Class the cursor was attached to the route from (`AomCursor.origin`). */
  origin: string;
  prefix: string;
  index: number;
  title?: string;
  description?: string;
}

export interface VisualRoute {
  /** `get /api/orgs/:id`. */
  id: string;
  method: HTTPMethods;
  path: string;
  operationId: string;
  title?: string;
  description?: string;
  tags: string[];
  /** Controller that declared the endpoint. */
  controller: string;
  endpoint: string;
  isWebsocket: boolean;
  chain: VisualChainItem[];
  parameters: VisualParameter[];
  requestBody?: VisualRequestBody;
  responses: VisualResponse[];
  security: string[];
  /** Names of the component schemas this route touches. */
  schemas: string[];
  /** Route marker data (`AomRoute.markers`), serialized as-is. */
  markers: Record<string, unknown>;
}

export interface VisualBridge {
  prefix: string;
  target: string;
  /** Middleware wrapping the bridge (`@Bridge` on a method), if any. */
  via?: string;
}

/** A decorated controller member — including one not attached to any route. */
export interface VisualMember {
  id: string;
  method: string;
  kind: VisualNodeKind;
  title?: string;
}

export interface VisualController {
  id: string;
  title?: string;
  description?: string;
  /** Parent class, if it is also a controller. */
  parent?: string;
  /** Every prefix this controller is mounted under. */
  prefixes: string[];
  bridges: VisualBridge[];
  /** Controllers that bridge into this one. */
  parents: string[];
  pre: string[];
  post: string[];
  hooks: string[];
  markers: string[];
  /** Ids of routes declared directly on this controller. */
  routes: string[];
  /** Every decorated class member, including ones not wired to a route. */
  members: VisualMember[];
  /** Depth in the bridge tree from the visualization root. */
  depth: number;
}

export interface VisualMiddleware {
  id: string;
  cls: string;
  method?: string;
  kind: VisualNodeKind;
  title?: string;
  description?: string;
  /** Ids of routes whose chain includes this link. */
  usedBy: string[];
  /** Controllers where this link is attached. */
  origins: string[];
  /** Schemas declared by decorators on this link itself. */
  schemas: string[];
  security: string[];
}

export interface VisualSchemaProperty {
  name: string;
  /** Type label for the table column. */
  type: string;
  format?: string;
  description?: string;
  required: boolean;
  isArray: boolean;
  nullable?: boolean;
  /** Name of the referenced component schema — an edge of the ER diagram. */
  ref?: string;
  enum?: string[];
}

export interface VisualSchema {
  id: string;
  description?: string;
  properties: VisualSchemaProperty[];
  /** Outgoing links: property → schema. */
  refs: Array<{ property: string; target: string }>;
  /** Schemas that reference this one. */
  referencedBy: string[];
  /** Routes where this schema is used. */
  usedBy: string[];
}

/**
 * Serializable snapshot of an API's structure: routes, chain links and component schemas with
 * their cross-references. Built by `buildVisualGraph`, rendered to HTML by `renderVisualGraph`.
 */
export interface VisualGraph {
  /** Class the graph was built from. */
  root: string;
  title: string;
  /** ISO timestamp of when the graph was assembled, filled in by the builder. */
  builtAt: string;
  controllers: VisualController[];
  routes: VisualRoute[];
  middlewares: VisualMiddleware[];
  schemas: VisualSchema[];
  /** Names of every controller reachable in this graph, usable as a `root` for rebuilding. */
  roots: string[];
  stats: {
    controllers: number;
    routes: number;
    websockets: number;
    middlewares: number;
    schemas: number;
    /** Links that appear in more than one route. */
    shared: number;
  };
  warnings: string[];
}

/** Options accepted by `buildVisualGraph`. */
export interface BuildGraphOptions {
  /** Document title; defaults to the root class name. */
  title?: string;
  /** Base OpenAPI document info passed to the internal schema collector. */
  info?: { title?: string; version?: string };
  /** Skip parsing route markers — they can be expensive to serialize. */
  skipMarkers?: boolean;
}

/** Options accepted by `renderVisualGraph`. */
export interface RenderOptions {
  /** How many routes a link must be used by to be considered shared. */
  sharedThreshold?: number;
}
