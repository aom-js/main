import { Controller, Ctx, Get, Responses, Route, Title, type AomRoute } from "@aom-js/router";
import { Visualizer } from "@aom-js/visualizer";
import type { BuildGraphOptions, RenderOptions, VisualGraph } from "@aom-js/visualizer";

import { messages } from "../constants";
import { type HttpCtx } from "../types";

/**
 * API map for a module: an HTML page and the same data as JSON.
 *
 * Mount it via a bridge (`\@Bridge("/", BaseVisualizerController)`) or by subclassing where the
 * module needs its own access restrictions. The map's root is the router that served the
 * request — i.e. the module the controller is mounted in.
 *
 * Picking a subtree is a client-side operation: the page receives the whole graph and rebuilds
 * its view from the `#root=ControllerName` URL fragment. The root cannot be parameterized from
 * outside.
 *
 * @example
 * ```ts
 * import { BaseVisualizerController } from "@aom-js/api";
 * import { Bridge, Controller } from "@aom-js/router";
 *
 * \@Controller()
 * \@Bridge("/", BaseVisualizerController) // exposes GET /visualizer and /visualizer.json
 * class ModuleRootController {}
 * ```
 */
@Controller()
export class BaseVisualizerController {
  /** Graph-build and render options passed to `Visualizer`; override in a subclass to customize. */
  static readonly VisualizerOptions: BuildGraphOptions & RenderOptions = {};

  protected static CreateVisualizer(route: AomRoute): Visualizer {
    return new Visualizer(route, this.VisualizerOptions);
  }

  /**
   * `GET /visualizer`: renders the module's route graph as an HTML page.
   * Sets `Content-Type: text/html` itself before returning the string, because a string result
   * defaults to `text/plain` otherwise (see `Server`).
   */
  @Get("/visualizer")
  @Title(messages.CONTROLLERS_VISUALIZER_PAGE)
  @Responses({
    status: 200,
    description: messages.CONTROLLERS_VISUALIZER_PAGE,
    schema: { type: "string" },
  })
  static Page(@Route() route: AomRoute, @Ctx() ctx: HttpCtx): string {
    // a string defaults to text/plain - for a real HTML page we set the type
    // explicitly, before return
    ctx.res.setHeader("Content-Type", "text/html; charset=utf-8");
    return this.CreateVisualizer(route).html;
  }

  /** `GET /visualizer.json`: the same route graph as `Page`, as raw `VisualGraph` data. */
  @Get("/visualizer.json")
  @Title(messages.CONTROLLERS_VISUALIZER_DATA)
  @Responses({
    status: 200,
    description: messages.CONTROLLERS_VISUALIZER_DATA,
    schema: { type: "object" },
  })
  static Data(@Route() route: AomRoute): VisualGraph {
    return this.CreateVisualizer(route).graph;
  }
}
