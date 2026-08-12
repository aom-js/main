import { ClassConstructor } from "@aom-js/core";
import { ValidationArguments } from "class-validator";

export declare type ConnectionSchema = () => ClassConstructor;

export declare interface BaseDescriptionsProperties {
  description?: string;
  deprecated?: boolean;
}

export declare interface ClassDescriptionsProperties extends BaseDescriptionsProperties {
  decorators?: ClassDecorator[];
  name?: string
}

export declare interface CommonDescriptionsProperties extends BaseDescriptionsProperties {
  nullable?: boolean;
  examples?: any[];
  isOptional?: boolean;
  hidden?: boolean;
  readOnly?: boolean;
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
