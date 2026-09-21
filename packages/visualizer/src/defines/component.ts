import type { ClassType } from "@aom-js/core";
import { AomRoute, Router } from "@aom-js/router";

import { buildVisualGraph } from "./graph";
import { renderVisualGraph } from "./render";
import type { BuildGraphOptions, RenderOptions, VisualGraph } from "./types";

/** What can be taken as the map's root: a route, a router, or the controller class itself. */
export type VisualizerSource = AomRoute | Router | ClassType;

/**
 * The API map as a value, rather than as a controller.
 *
 * Knows nothing about HTTP: create it wherever convenient, passing a route (`\@Route() route`),
 * a router, or a controller class. The map's root becomes the root of that route's router — the
 * module the component was placed inside of.
 *
 * ```ts
 * \@Get("/visualizer")
 * static Page(\@Route() route: AomRoute): string {
 *   return new Visualizer(route).html;
 * }
 * ```
 *
 * Building is lazy: nothing is computed until `graph` or `html` is read, and each is computed
 * only once per instance.
 *
 * @example
 * ```ts
 * import { Visualizer } from "@aom-js/visualizer";
 *
 * const page = new Visualizer(AppRoot, { title: "Public API" });
 * page.html; // self-contained HTML string
 * page.graph.stats.routes; // same data, as a plain object
 * ```
 */
export class Visualizer {
  readonly source: VisualizerSource;

  private readonly options: BuildGraphOptions & RenderOptions;

  private builtGraph?: VisualGraph;

  private rendered?: string;

  constructor(source: VisualizerSource, options: BuildGraphOptions & RenderOptions = {}) {
    this.source = source;
    this.options = options;
  }

  /** Class the map is built from. */
  get root(): ClassType {
    const { source } = this;
    if (source instanceof AomRoute) return source.router.root;
    if (source instanceof Router) return source.root;
    return source;
  }

  /** Map data: routes, links, schemas and the connections between them. Built once, on first access. */
  get graph(): VisualGraph {
    if (!this.builtGraph) this.builtGraph = buildVisualGraph(this.root, this.options);
    return this.builtGraph;
  }

  /** Ready-to-serve, self-contained HTML page. Rendered once, on first access. */
  get html(): string {
    if (this.rendered === undefined) {
      this.rendered = renderVisualGraph(this.graph, this.options);
    }
    return this.rendered;
  }

  /**
   * String form — the same page as `html`.
   *
   * @returns `this.html`.
   *
   * @example
   * ```ts
   * String(new Visualizer(route)); // same as new Visualizer(route).html
   * ```
   */
  toString(): string {
    return this.html;
  }

  /**
   * Data, not a page. `Server` serializes a returned object with `JSON.stringify`, so
   * `return new Visualizer(route)` from an endpoint hands back the graph; returning the page
   * itself requires `.html` explicitly.
   *
   * @returns The same value as `this.graph`.
   */
  toJSON(): VisualGraph {
    return this.graph;
  }
}
