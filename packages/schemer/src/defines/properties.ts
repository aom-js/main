import { Allow, IsBoolean, IsDate, IsEnum, IsNumber, IsOptional, IsString } from "class-validator";
import {
  Matches,
  Max,
  MaxDate,
  MaxLength,
  Min,
  MinDate,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Exclude, Transform, Type } from "class-transformer";
import { InstanceTarget, Property, ExecutionPhase } from "@aom-js/core";
import { JSONSchema } from "class-validator-jsonschema";
//
import { CommonDescriptionsProperties, ConnectionSchema, SchemaTypes } from "./types";
import { AomSchemas } from "./module";
import { IsNullable } from "./helpers";

// descriptor decorators used to describe structure
export function decorateProperty(
  decorators: unknown[],
  target: InstanceTarget,
  property: Property | undefined,
) {
  Reflect.decorate(decorators.filter(Boolean) as PropertyDecorator[], target, property as Property);
}

// check that no decorator has already been added to this property
function checkExistsSchemaParams($: AomSchemas) {
  if ($.schemaParams) {
    throw new Error(`${$._.target.name}.${String($._.property)} already has defined schema params`);
  }
  // no error — add it to the set
  // property is always set here: this is only called from AomSchemas.propertyDecorator
  $._.root.properties.add($._.property!);
}

/** Parameters for `PropertySchema.String`. */
declare interface StringDescriptionsProperties extends CommonDescriptionsProperties {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: string;
}

/**
 * String property: `IsString` plus `MaxLength`/`MinLength`/`Matches` when given, and the usual
 * `IsOptional`/`IsNullable`/`Exclude`/`JSONSchema` set. `pattern` is applied as a `Matches` validator
 * but does not appear in the rendered JSON Schema itself — read it off the property's decorators,
 * not off `schemer.render(...)`.
 */
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
      params.maxLength != null ? MaxLength(params.maxLength, { each: params.isArray }) : undefined,
      params.minLength != null ? MinLength(params.minLength, { each: params.isArray }) : undefined,
      params.pattern ? Matches(new RegExp(params.pattern), { each: params.isArray }) : undefined,
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
      ...(params.decorators || []), // append the extra decorators
    ];

    // apply the resulting decorators
    decorateProperty(decorators, originInstance, property);
  }, ExecutionPhase.LAST);
};

/** Parameters for `PropertySchema.Number`. */
declare interface NumberDescriptionsProperties extends CommonDescriptionsProperties {
  minValue?: number;
  maxValue?: number;
  maxDecimalPlaces?: number;
  default?: number;
}

/**
 * Number property: `IsNumber` plus `Max`/`Min` when given, and the usual optional/nullable/hidden
 * set. Also applies a `Transform` that coerces the input to `Number(value)` (or to `null` when
 * `nullable` and the input is `null`) before validation.
 */
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
        },
      ),
      params.isOptional ? IsOptional() : undefined,
      params.maxValue != null ? Max(params.maxValue, { each: params.isArray }) : undefined,
      params.minValue != null ? Min(params.minValue, { each: params.isArray }) : undefined,
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
        return Number(value);
      }),
      ...(params.decorators || []), // append the extra decorators
    ];

    // apply the resulting decorators
    decorateProperty(decorators, originInstance, property);
  }, ExecutionPhase.LAST);
};

/** Parameters for `PropertySchema.Boolean`. */
declare interface BooleanDescriptionsProperties extends CommonDescriptionsProperties {
  default?: boolean;
}

/**
 * Boolean property: `IsBoolean` plus the usual optional/nullable/hidden set. The applied `Transform`
 * accepts the literal strings `"true"`/`"false"`, an actual boolean, or falls back to
 * `Boolean(+value)` for anything else — convenient for query-string style input.
 */
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
      ...(params.decorators || []), // append the extra decorators
    ];

    // apply the resulting decorators
    decorateProperty(decorators, originInstance, property);
  }, ExecutionPhase.LAST);
};

/** Parameters for `PropertySchema.Any`. */
declare interface AnyDescriptionsProperties extends CommonDescriptionsProperties {
  default?: any;
}
// any type
/** Unvalidated property: `Allow(...)` plus the usual optional/nullable/hidden set — accepts any value. */
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
      ...(params.decorators || []), // append the extra decorators
    ];

    // apply the resulting decorators
    decorateProperty(decorators, originInstance, property);
  }, ExecutionPhase.LAST);
};

type EnumLike = Record<string, string | number>;

/** Parameters for `PropertySchema.Enum`. `value` is the actual TS enum object. */
declare interface EnumDescriptionsProperties<
  T extends EnumLike,
> extends CommonDescriptionsProperties {
  value: T;
  default?: T[keyof T];
  // name of the enum for the generated code (codegen); doesn't appear in the JSON Schema
  /** Name to use for the generated `enum` in `@aom-js/codegen` output; never appears in the rendered JSON Schema. */
  enumName?: string;
}

/**
 * Enum property: `IsEnum(params.value, ...)` plus the usual optional/nullable/hidden set.
 */
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
        readOnly: params.readOnly,
      }),
      ...(params.decorators || []), // append the extra decorators
    ];

    // apply the resulting decorators
    decorateProperty(decorators, originInstance, property);
  }, ExecutionPhase.LAST);
};

/** Parameters for `PropertySchema.Date`. */
declare interface DateDescriptionsProperties extends CommonDescriptionsProperties {
  minDate?: Date;
  maxDate?: Date;
  default?: Date;
}

/**
 * Date property: `IsDate` plus `MaxDate`/`MinDate` when given, and the usual optional/nullable/hidden
 * set. Renders as `{oneOf: [{format:"date",type:"string"}, {format:"date-time",type:"string"}]}`
 * (the same shape as `SCALAR_TYPE_SCHEMAS.date`). Applies a `Transform` that turns the input into
 * `new Date(value)` (or `null` when `nullable` and the input is `null`).
 */
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
      params.maxDate ? MaxDate(params.maxDate, { each: params.isArray }) : undefined,
      params.minDate ? MinDate(params.minDate, { each: params.isArray }) : undefined,
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
        return new Date(value);
      }),
      ...(params.decorators || []), // append the extra decorators
    ];

    // apply the resulting decorators
    decorateProperty(decorators, originInstance, property);
  }, ExecutionPhase.LAST);
};

/**
 * Parameters for `PropertySchema.Type`. `value` is a lazy reference (`() => Class`), so two
 * components can reference each other regardless of declaration order.
 */
declare interface TypeDescriptionsProperties extends CommonDescriptionsProperties {
  value: ConnectionSchema;
}

/**
 * Reference to another `@ComponentSchema` class: `Type(params.value)` (class-transformer) plus
 * `ValidateNested` and the usual optional/nullable/hidden set — but no `default`/`examples` in the
 * rendered JSON Schema (`TypeDescriptionsProperties` declares neither field). Also registers the
 * property in `AomSchemas.connections`, which is how `SchemasCollector` and `foldSchemas` discover
 * the `$ref` graph without re-scanning every property.
 */
const _Type = (params: TypeDescriptionsProperties) => {
  //
  return AomSchemas.propertyDecorator(($) => {
    checkExistsSchemaParams($);
    $.schemaParams = params;
    $.schemaName = SchemaTypes.TYPE;
    // register a connection on this property based on the type's value
    const { originInstance, property } = $._;

    $._.root.connections.set(property!, params.value);

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
        readOnly: params.readOnly,
      }),
      ...(params.decorators || []), // append the extra decorators
    ];

    // apply the resulting decorators
    decorateProperty(decorators, originInstance, property);
  }, ExecutionPhase.LAST);
};

/**
 * Flat, class-validator-style property decorators, one factory per scalar shape:
 * `String`/`Number`/`Boolean`/`Date`/`Enum`/`Any`/`Type`.
 *
 * Each factory queues a class-validator/class-transformer/`JSONSchema` decorator set at
 * `ExecutionPhase.LAST` — nothing runs until the owning class is decorated with `@ComponentSchema()`,
 * which flushes the queue (see `ComponentSchema`). Until then `PropertySchema.*` on a class is inert:
 * no validator is attached, nothing renders, and the property is invisible to `Schemer`.
 *
 * The raw params object passed to a factory is also kept verbatim on the property's metadata node
 * (`AomSchemas.schemaParams`). That raw copy, not the decorators it produced, is what powers
 * mapped-types (`PartialType`/`PickType`/`OmitType`/`IntersectionType`) and `foldSchemas` (the
 * distribution format consumed by `@aom-js/codegen`).
 *
 * @example
 * ```ts
 * import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
 *
 * enum Status {
 *   Active = "active",
 *   Blocked = "blocked",
 * }
 *
 * @ComponentSchema({ description: "User" })
 * class UserDto {
 *   @PropertySchema.String({ minLength: 2, maxLength: 50, description: "Name" })
 *   name!: string;
 *
 *   @PropertySchema.Number({ isOptional: true, minValue: 1 })
 *   age?: number;
 *
 *   @PropertySchema.Enum({ value: Status, isOptional: true })
 *   status?: Status;
 *
 *   @PropertySchema.Type({ value: () => AddressDto, isOptional: true })
 *   address?: AddressDto;
 * }
 *
 * @ComponentSchema()
 * class AddressDto {
 *   @PropertySchema.String({})
 *   city!: string;
 * }
 * ```
 */
export const PropertySchema = {
  [SchemaTypes.STRING]: _String,
  [SchemaTypes.NUMBER]: _Number,
  [SchemaTypes.DATE]: _Date,
  [SchemaTypes.BOOLEAN]: _Boolean,
  [SchemaTypes.ENUM]: _Enum,
  [SchemaTypes.ANY]: _Any,
  [SchemaTypes.TYPE]: _Type,
};
