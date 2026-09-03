import type { ClassType } from "@aom-js/core";
import { AomRoute, Router } from "@aom-js/router";

import { buildVisualGraph } from "./graph";
import { renderVisualGraph } from "./render";
import type { BuildGraphOptions, RenderOptions, VisualGraph } from "./types";

/** Что можно взять за корень карты: маршрут, роутер или сам класс контроллера */
export type VisualizerSource = AomRoute | Router | ClassType;

/**
 * Карта API как значение, а не как контроллер.
 *
 * Компонента ничего не знает про HTTP: её создают там, где удобно, передав
 * маршрут (`@Route() route`), роутер или класс контроллера. Корнем карты
 * становится корень роутера этого маршрута — то есть модуль, внутри которого
 * компоненту и разместили.
 *
 *     @Get("/visualizer")
 *     static Page(@Route() route: AomRoute): string {
 *       return new Visualizer(route).html;
 *     }
 *
 * Сборка ленивая: пока не спросили `graph` или `html`, ничего не считается.
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

  /** Класс, от которого строится карта */
  get root(): ClassType {
    const { source } = this;
    if (source instanceof AomRoute) return source.router.root;
    if (source instanceof Router) return source.root;
    return source;
  }

  /** Данные карты: маршруты, звенья, схемы и связи между ними */
  get graph(): VisualGraph {
    if (!this.builtGraph) this.builtGraph = buildVisualGraph(this.root, this.options);
    return this.builtGraph;
  }

  /** Готовая самодостаточная HTML-страница */
  get html(): string {
    if (this.rendered === undefined) {
      this.rendered = renderVisualGraph(this.graph, this.options);
    }
    return this.rendered;
  }

  /** Строковое представление — та же страница: `String(new Visualizer(route))` */
  toString(): string {
    return this.html;
  }

  /**
   * Данные, а не страница. `Server` сериализует возвращённый объект через
   * JSON.stringify, поэтому `return new Visualizer(route)` из endpoint-а отдаёт
   * граф; для страницы нужен `.html`.
   */
  toJSON(): VisualGraph {
    return this.graph;
  }
}
