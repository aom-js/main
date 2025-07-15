import { AomCore, Constructor, Property } from "@aom-js/core";
import { defaultMetadataStorage } from "class-transformer/cjs/storage";
import { targetConstructorToSchema } from "class-validator-jsonschema";

import {
  ConnectionSchema,
  SchemerConfig,
  RenderHandler,
  BaseDescriptionsProperties,
  SchemaTypes,
} from "./types";

export class AomSchemas extends AomCore {
  schemer: Schemer;

  isComponentSchema: boolean;
  connections: Map<Property, ConnectionSchema> = new Map();

  schemaName?: SchemaTypes;
  schemaParams?: BaseDescriptionsProperties;
}

export class Schemer {
  private refPointerPrefix: string;

  /**
   * Конструктор класса Schemer
   * @param config Конфигурация схемера
   */
  constructor(refPointerPrefix: string) {
    this.refPointerPrefix = refPointerPrefix;
    //
    // this.render = config.render;
  }

  // функция для рендера данных
  render(target: Constructor): ReturnType<typeof targetConstructorToSchema> {
    return targetConstructorToSchema(target, {
      classTransformerMetadataStorage: defaultMetadataStorage,
      refPointerPrefix: this.refPointerPrefix,
    });
  }

  // // конфигурация по умолчанию
  // static default: Schemer;

  // /**
  //  * Устанавливает конфигурацию по умолчанию
  //  * @param config Конфигурация схемера
  //  */
  // static config(config: SchemerConfig) {
  //   this.default = new this(config);
  // }
}
