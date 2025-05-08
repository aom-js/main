import { Property } from "@aom/common";
import { aom } from "@aom/core";

import { ConnectionSchema, SchemerConfig, RenderHandler } from "./types";

export class AomSchemas extends aom {
  schemer: Schemer;

  connections: Map<Property, ConnectionSchema> = new Map();
}

export class Schemer implements SchemerConfig {
  static readonly refPointerPrefix = "#/components/schemas/";
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
