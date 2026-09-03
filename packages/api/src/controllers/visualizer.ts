import { Controller, Get, Responses, Route, Title, type AomRoute } from "@aom-js/router";
import { Visualizer } from "@aom-js/visualizer";
import type { BuildGraphOptions, RenderOptions, VisualGraph } from "@aom-js/visualizer";

import { messages } from "../constants";

/**
 * Карта API модуля: страница и те же данные в JSON.
 *
 * Подключается бриджем (`@Bridge("/", BaseVisualizerController)`) или наследованием
 * там, где нужны свои ограничения доступа. Корнем карты становится корень роутера,
 * обслужившего запрос, — то есть модуль, в котором контроллер смонтирован.
 *
 * Выбор поддерева — операция клиента: страница получает граф целиком и пересобирает
 * вид по `#root=ИмяКонтроллера`. Снаружи корень не параметризуется.
 */
@Controller()
export class BaseVisualizerController {
  /** Настройки сборки и рендера для наследника */
  static readonly visualizerOptions: BuildGraphOptions & RenderOptions = {};

  protected static visualizer(route: AomRoute): Visualizer {
    return new Visualizer(route, this.visualizerOptions);
  }

  @Get("/visualizer")
  @Title(messages.CONTROLLERS_VISUALIZER_PAGE)
  @Responses({
    status: 200,
    description: messages.CONTROLLERS_VISUALIZER_PAGE,
    schema: { type: "string" },
  })
  static Page(@Route() route: AomRoute): string {
    return this.visualizer(route).html;
  }

  @Get("/visualizer.json")
  @Title(messages.CONTROLLERS_VISUALIZER_DATA)
  @Responses({
    status: 200,
    description: messages.CONTROLLERS_VISUALIZER_DATA,
    schema: { type: "object" },
  })
  static Data(@Route() route: AomRoute): VisualGraph {
    return this.visualizer(route).graph;
  }
}
