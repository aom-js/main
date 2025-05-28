import { AomCore, Property } from "@aom-js/core";

import { ConnectionSchema, SchemerConfig, RenderHandler } from "./types";

export class AomSchemas extends AomCore {
  schemer: Schemer;

  connections: Map<Property, ConnectionSchema> = new Map();
}

export class Schemer implements SchemerConfig {
  // функция для рендера данных
  render: RenderHandler;

  /**
   * Конструктор класса Schemer
   * @param config Конфигурация схемера
   */
  constructor(config: SchemerConfig) {
    //
    this.render = config.render;
  }

  // конфигурация по умолчанию
  static default: Schemer;

  /**
   * Устанавливает конфигурацию по умолчанию
   * @param config Конфигурация схемера
   */
  static config(config: SchemerConfig) {
    this.default = new this(config);
  }
}
