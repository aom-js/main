import { AomCore, ClassType, Property } from "@aom-js/core";
import { defaultMetadataStorage } from "class-transformer/cjs/storage";
import { targetConstructorToSchema } from "class-validator-jsonschema";
import { type ClassConstructor, plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import {
  ConnectionSchema,
  // SchemerConfig,
  // RenderHandler,
  CommonDescriptionsProperties,
  SchemaTypes,
} from "./types";

export class AomSchemas extends AomCore {
  schemer: Schemer;

  properties: Set<Property> = new Set();

  isComponentSchema: boolean;
  connections: Map<Property, ConnectionSchema> = new Map();

  schemaName?: SchemaTypes;
  schemaParams?: CommonDescriptionsProperties;
}

export class Schemer {
  readonly refPointerPrefix: string;

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
  render(target: ClassType): ReturnType<typeof targetConstructorToSchema> {
    return targetConstructorToSchema(target, {
      classTransformerMetadataStorage: defaultMetadataStorage,
      refPointerPrefix: this.refPointerPrefix,
    });
  }

  validate<T extends ClassConstructor<unknown>>(constructor: T, data: object) {
    const values = plainToInstance(
      constructor,
      { ...data },
      {
        exposeDefaultValues: true,
        strategy: "exposeAll",
        exposeUnsetFields: false,
        enableCircularCheck: true,
      },
    ) as T;

    const errors = validateSync(values, { whitelist: true });

    return { values, errors };
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
