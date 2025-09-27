import { ClassConstructor } from "@aom-js/core";
import { ValidationArguments } from "class-validator";

export declare type ConnectionSchema = () => ClassConstructor;

// /**
//  * Тип обработчика для рендеринга
//  * Функция для рендеринга входящего класса
//  */
// export declare type RenderHandler = (target: ClassConstructor) => any;

// /**
//  * Интерфейс конфигурации JSONSchema генератора
//  * Определяет настройки и обработчики для экземпляра изолятора
//  */
// export declare interface SchemerConfig {
//   /** Функция для рендера */
//   render: RenderHandler;
// }

export declare interface BaseDescriptionsProperties {
  description?: string;
  deprecated?: boolean;
}

export declare interface CommonDescriptionsProperties extends BaseDescriptionsProperties {
  nullable?: boolean;
  examples?: any[];
  isOptional?: boolean;
  isArray?: boolean;
  message?: string | ((validationArguments: ValidationArguments) => string);
  groups?: string[];
  always?: boolean;
  decorators?: PropertyDecorator[];
}

export enum SchemaTypes {
  STRING = "String",
  DATE = "Date",
  NUMBER = "Number",
  BOOLEAN = "Boolean",
  ENUM = "Enum",
  ANY = "Any",
  TYPE = "Type",
}
