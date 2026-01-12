import { Allow, IsBoolean, IsDate, IsEnum, IsNumber, IsOptional, IsString } from "class-validator";
import { Max, MaxDate, MaxLength, Min, MinDate, MinLength, ValidateNested } from "class-validator";
import { Exclude, Transform, Type } from "class-transformer";
import { DecoratorsQueueStore } from "@aom-js/core";
import { JSONSchema } from "class-validator-jsonschema";
//
import { CommonDescriptionsProperties, ConnectionSchema, SchemaTypes } from "./types";
import { AomSchemas } from "./module";
import { IsNullable } from "./helpers";

// дескрипторные декораторы, позволяющие описывать структуру

function checkExistsSchemaParams($: AomSchemas) {
  if ($.schemaParams) {
    throw new Error(`${$._.target.name}.${String($._.property)} already has defined schema params`);
  }
}

declare interface StringDescriptionsProperties extends CommonDescriptionsProperties {
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
      params.nullable ? IsNullable() : undefined,
      params.hidden ? Exclude() : undefined,
      JSONSchema({
        description: params.description,
        deprecated: params.deprecated,
        nullable: params.nullable,
        default: params.default,
        examples: params.examples,
        readOnly: params.readOnly,
      }),
      ...(params.decorators || []), // добавим дополнительные декораторы
    ].filter(Boolean);

    // применим соответствующие декораторы
    Reflect.decorate(decorators, originInstance, property);
  }, DecoratorsQueueStore.LAST);
};

declare interface NumberDescriptionsProperties extends CommonDescriptionsProperties {
  minValue?: number;
  maxValue?: number;
  maxDecimalPlaces?: number;
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
        { maxDecimalPlaces: params.maxDecimalPlaces },
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
      params.hidden ? Exclude() : undefined,
      JSONSchema({
        description: params.description,
        deprecated: params.deprecated,
        nullable: params.nullable,
        default: params.default,
        examples: params.examples,
        readOnly: params.readOnly,
      }),
      Transform(({ value }) => {
        if (params.nullable && value === null) return null;
        return Number(value);
      }),
      ...(params.decorators || []), // добавим дополнительные декораторы
    ].filter(Boolean);

    // применим соответствующие декораторы
    Reflect.decorate(decorators, originInstance, property);
  }, DecoratorsQueueStore.LAST);
};

declare interface BooleanDescriptionsProperties extends CommonDescriptionsProperties {
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
      params.nullable ? IsNullable() : undefined,
      params.hidden ? Exclude() : undefined,
      JSONSchema({
        description: params.description,
        deprecated: params.deprecated,
        nullable: params.nullable,
        default: params.default,
        examples: params.examples,
        readOnly: params.readOnly,
      }),
      Transform(({ value }) => {
        if (params.nullable && value === null) return null;

        const isTrue = value === "true";
        const isFalse = value === "false";
        if (isTrue) return true;
        if (isFalse) return false;
        return typeof value === "boolean" ? value : Boolean(+value);
      }),
      ...(params.decorators || []), // добавим дополнительные декораторы
    ].filter(Boolean);

    // применим соответствующие декораторы
    Reflect.decorate(decorators, originInstance, property);
  }, DecoratorsQueueStore.LAST);
};

declare interface AnyDescriptionsProperties extends CommonDescriptionsProperties {
  default?: any;
}
// любой тип
const _Any = (params: AnyDescriptionsProperties) => {
  //
  return AomSchemas.propertyDecorator(($) => {
    checkExistsSchemaParams($);
    $.schemaName = SchemaTypes.ANY;
    $.schemaParams = params;

    const { originInstance, property } = $._;

    const decorators = [
      Allow({
        each: params.isArray,
        message: params.message,
        groups: params.groups,
        always: params.always,
      }),
      params.isOptional ? IsOptional() : undefined,
      params.nullable ? IsNullable() : undefined,
      params.hidden ? Exclude() : undefined,
      JSONSchema({
        description: params.description,
        deprecated: params.deprecated,
        nullable: params.nullable,
        default: params.default,
        examples: params.examples,
        readOnly: params.readOnly,
      }),
      ...(params.decorators || []), // добавим дополнительные декораторы
    ].filter(Boolean);

    // применим соответствующие декораторы
    Reflect.decorate(decorators, originInstance, property);
  }, DecoratorsQueueStore.LAST);
};

type EnumLike = Record<string, string | number>;

declare interface EnumDescriptionsProperties<T extends EnumLike>
  extends CommonDescriptionsProperties {
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
      params.nullable ? IsNullable() : undefined,
      params.hidden ? Exclude() : undefined,
      JSONSchema({
        description: params.description,
        deprecated: params.deprecated,
        nullable: params.nullable,
        default: params.default,
        examples: params.examples,
      }),
      ...(params.decorators || []), // добавим дополнительные декораторы
    ].filter(Boolean);

    // применим соответствующие декораторы
    Reflect.decorate(decorators, originInstance, property);
  }, DecoratorsQueueStore.LAST);
};

declare interface DateDescriptionsProperties extends CommonDescriptionsProperties {
  minDate?: Date;
  maxDate?: Date;
  default?: Date;
}

const _Date = (params: DateDescriptionsProperties) => {
  //
  //
  return AomSchemas.propertyDecorator(($) => {
    checkExistsSchemaParams($);
    $.schemaName = SchemaTypes.DATE;
    $.schemaParams = params;

    const { originInstance, property } = $._;

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
      params.nullable ? IsNullable() : undefined,
      params.hidden ? Exclude() : undefined,
      JSONSchema({
        description: params.description,
        deprecated: params.deprecated,
        nullable: params.nullable,
        default: params.default,
        examples: params.examples,
      }),
      Transform(({ value }) => {
        if (params.nullable && value === null) return null;
        return new Date(value);
      }),
    ].filter(Boolean);

    // применим соответствующие декораторы
    Reflect.decorate(decorators, originInstance, property);
  }, DecoratorsQueueStore.LAST);
};

declare interface TypeDescriptionsProperties extends CommonDescriptionsProperties {
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
      params.nullable ? IsNullable() : undefined,
      params.hidden ? Exclude() : undefined,
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

export const PropertySchema = {
  [SchemaTypes.STRING]: _String,
  [SchemaTypes.NUMBER]: _Number,
  [SchemaTypes.DATE]: _Date,
  [SchemaTypes.BOOLEAN]: _Boolean,
  [SchemaTypes.ENUM]: _Enum,
  [SchemaTypes.ANY]: _Any,
  [SchemaTypes.TYPE]: _Type,
};
