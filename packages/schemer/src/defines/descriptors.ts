import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxDate,
  MaxLength,
  Min,
  MinDate,
  MinLength,
  ValidateNested,
} from "class-validator";
import { BaseDescriptionsProperties, ConnectionSchema, SchemaTypes } from "./types";
import { AomSchemas } from "./module";
import { ClassConstructor, DecoratorsQueueStore, isClass } from "@aom-js/core";
import { Transform, Type } from "class-transformer";
import { JSONSchema } from "class-validator-jsonschema";

// дескрипторные декораторы, позволяющие описывать структуру

function checkExistsSchemaParams($: AomSchemas) {
  if ($.schemaParams) {
    throw new Error(`${$._.target.name}.${String($._.property)} already has defined schema params`);
  }
}

declare interface StringDescriptionsProperties extends BaseDescriptionsProperties {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: string;
}

const _String = (params: StringDescriptionsProperties): PropertyDecorator => {
  //
  return AomSchemas.propertyDecorator(($) => {
    checkExistsSchemaParams($);
    $.schemaName = SchemaTypes.STRING;
    $.schemaParams = params;

    const { originInstance, property } = $._;

    const decorators = [
      IsString({
        each: params.isArray,
        message: params.message,
        groups: params.groups,
        always: params.always,
      }),
      params.isOptional ? IsOptional() : undefined,
      params.maxLength ? MaxLength(params.maxLength) : undefined,
      params.minLength ? MinLength(params.minLength) : undefined,
      JSONSchema({
        description: params.description,
        deprecated: params.deprecated,
        nullable: params.nullable,
        default: params.default,
      }),
    ].filter(Boolean);

    // применим соответствующие декораторы
    Reflect.decorate(decorators, originInstance, property);
  }, DecoratorsQueueStore.LAST);
};

declare interface NumberDescriptionsProperties extends BaseDescriptionsProperties {
  minValue?: number;
  maxValue?: number;
  default?: number;
}

const _Number = (params: NumberDescriptionsProperties) => {
  //
  return AomSchemas.propertyDecorator(($) => {
    checkExistsSchemaParams($);
    $.schemaName = SchemaTypes.NUMBER;
    $.schemaParams = params;

    const { originInstance, property } = $._;

    const decorators = [
      IsNumber(
        {},
        {
          each: params.isArray,
          message: params.message,
          groups: params.groups,
          always: params.always,
        }
      ),
      params.isOptional ? IsOptional() : undefined,
      params.maxValue ? Max(params.maxValue) : undefined,
      params.minValue ? Min(params.minValue) : undefined,
      JSONSchema({
        description: params.description,
        deprecated: params.deprecated,
        nullable: params.nullable,
        default: params.default,
      }),
      Transform(({ value }) => {
        if (params.nullable && value === null) return null;
        return Number(value);
      }),
    ].filter(Boolean);

    // применим соответствующие декораторы
    Reflect.decorate(decorators, originInstance, property);
  }, DecoratorsQueueStore.LAST);
};

declare interface BooleanDescriptionsProperties extends BaseDescriptionsProperties {
  default?: boolean;
}

const _Boolean = (params: BooleanDescriptionsProperties) => {
  //
  return AomSchemas.propertyDecorator(($) => {
    checkExistsSchemaParams($);
    $.schemaName = SchemaTypes.BOOLEAN;
    $.schemaParams = params;

    const { originInstance, property } = $._;

    const decorators = [
      IsBoolean({
        each: params.isArray,
        message: params.message,
        groups: params.groups,
        always: params.always,
      }),
      params.isOptional ? IsOptional() : undefined,
      JSONSchema({
        description: params.description,
        deprecated: params.deprecated,
        nullable: params.nullable,
        default: params.default,
      }),
      Transform(({ value }) => {
        if (params.nullable && value === null) return null;

        const isTrue = value === "true";
        const isFalse = value === "false";
        if (isTrue) return true;
        if (isFalse) return false;
        return typeof value === "boolean" ? value : Boolean(+value);
      }),
    ].filter(Boolean);

    // применим соответствующие декораторы
    Reflect.decorate(decorators, originInstance, property);
  }, DecoratorsQueueStore.LAST);
};

type EnumLike = Record<string, string | number>;

declare interface EnumDescriptionsProperties<T extends EnumLike>
  extends BaseDescriptionsProperties {
  value: T;
  default?: T[keyof T];
}

const _Enum = <T extends EnumLike>(params: EnumDescriptionsProperties<T>) => {
  //
  //
  return AomSchemas.propertyDecorator(($) => {
    checkExistsSchemaParams($);
    $.schemaName = SchemaTypes.ENUM;
    $.schemaParams = params;

    const { originInstance, property } = $._;

    const decorators = [
      IsEnum(params.value, {
        each: params.isArray,
        message: params.message,
        groups: params.groups,
        always: params.always,
      }),
      params.isOptional ? IsOptional() : undefined,
      JSONSchema({
        description: params.description,
        deprecated: params.deprecated,
        nullable: params.nullable,
        default: params.default,
      }),
    ].filter(Boolean);

    // применим соответствующие декораторы
    Reflect.decorate(decorators, originInstance, property);
  }, DecoratorsQueueStore.LAST);
};

declare interface DateDescriptionsProperties<T extends EnumLike>
  extends BaseDescriptionsProperties {
  minDate: Date;
  maxDate: Date;
  default: Date;
}

const _Date = <T extends EnumLike>(params: DateDescriptionsProperties<T>) => {
  //
  //
  return AomSchemas.propertyDecorator(($) => {
    checkExistsSchemaParams($);
    $.schemaName = SchemaTypes.DATE;
    $.schemaParams = params;

    const { target, property } = $._;

    const decorators = [
      IsDate({
        each: params.isArray,
        message: params.message,
        groups: params.groups,
        always: params.always,
      }),
      params.maxDate ? MaxDate(params.maxDate) : undefined,
      params.minDate ? MinDate(params.minDate) : undefined,
      params.isOptional ? IsOptional() : undefined,
      JSONSchema({
        description: params.description,
        deprecated: params.deprecated,
        nullable: params.nullable,
        default: params.default,
      }),
      Transform(({ value }) => {
        if (params.nullable && value === null) return null;
        return new Date(value);
      }),
    ].filter(Boolean);

    // применим соответствующие декораторы
    Reflect.decorate(decorators, Object.getPrototypeOf(target), property);
  }, DecoratorsQueueStore.LAST);
};

declare interface TypeDescriptionsProperties extends BaseDescriptionsProperties {
  value: ConnectionSchema;
}

const _Type = (params: TypeDescriptionsProperties) => {
  //
  return AomSchemas.propertyDecorator(($) => {
    checkExistsSchemaParams($);
    $.schemaParams = params;
    $.schemaName = SchemaTypes.TYPE;
    // создадим связь на указанном свойстве согласно значению в типе
    const { originInstance, property } = $._;

    $._.root.connections.set(property, params.value);

    const decorators = [
      Type(params.value),
      ValidateNested({
        each: params.isArray,
        message: params.message,
        groups: params.groups,
        always: params.always,
      }),
      params.isOptional ? IsOptional() : undefined,
      JSONSchema({
        description: params.description,
        deprecated: params.deprecated,
        nullable: params.nullable,
      }),
    ].filter(Boolean);

    // применим соответствующие декораторы
    Reflect.decorate(decorators, originInstance, property);
  }, DecoratorsQueueStore.LAST);
};

export const Schema = {
  [SchemaTypes.STRING]: _String,
  [SchemaTypes.NUMBER]: _Number,
  [SchemaTypes.BOOLEAN]: _Boolean,
  [SchemaTypes.ENUM]: _Enum,
  [SchemaTypes.TYPE]: _Type,
};
