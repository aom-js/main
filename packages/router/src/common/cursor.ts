import type { ClassConstructor } from "@aom-js/core";
import { Schemer } from "@aom-js/schemer";

import * as constants from "../constants";
import { FwdContainer, RouteRefContainer, ThisRefContainer } from "./references";
import { AomApi, type AomEndpoint } from "./api";
import {
  AomParameterKind,
  AomValuesSource,
  type AomCursorKind,
  type AomViaKind,
} from "./kinds";
import type { ParameterLocation } from "openapi3-ts/oas31";

/**
 * Resolves a decorator's target argument in the context of a cursor — the single place
 * where `FwdRef`/`ThisRef`/`RouteRef` are unwrapped. Parameter handlers call it on every
 * request; `AomCursor.parameters()` and `realizeDelay` call it too, so the projection and
 * execution agree by construction. Its inputs (`cursor.$` after `resolveFor`,
 * `cursor.endpoint`) are fixed when the cursor is created.
 *
 * @param ref - a class, `FwdRef(...)`, `ThisRef(...)`, `RouteRef(...)`, a key, a handler
 *   function or `undefined`
 * @param cursor - the cursor the reference is resolved for
 * @returns `fn()` for `FwdRef`, `fn(cursor's class)` for `ThisRef`, `fn(endpoint's class)`
 *   for `RouteRef`; anything else unchanged
 * @throws {Error} `ROUTE_REF_DELAY_ERROR` for a `RouteRef` on a cursor without an endpoint
 */
export function resolveTarget(ref: unknown, cursor: AomCursor): any {
  if (ref instanceof FwdContainer) return ref.exec();
  if (ref instanceof ThisRefContainer) return ref.exec(cursor.$._.target);
  if (ref instanceof RouteRefContainer) {
    if (!cursor.endpoint) throw new Error(constants.ROUTE_REF_DELAY_ERROR);
    return ref.exec(cursor.endpoint.$._.target);
  }
  return ref;
}

/** One entry of `AomCursor.parameters()`: a parameter descriptor with its target resolved for this cursor. */
export declare type AomCursorParameter = {
  kind: AomParameterKind;
  source?: AomValuesSource;
  /** `resolveTarget(ref, cursor)`; for `\@This()` without an argument — the cursor's own class. */
  target?: unknown;
  name?: string;
};

/** Projection of one parameter — `AomCursor.toJSON().parameters[i]`. */
export declare type AomParameterJSON =
  | { kind: AomParameterKind.This; subject: string }
  | { kind: AomParameterKind.State; subject?: string }
  | { kind: AomParameterKind.Values; source: AomValuesSource; fields?: string[] }
  | { kind: AomParameterKind.Other; name?: string }
  | { kind: AomParameterKind };

/** Projection of one cursor — `AomCursor.toJSON()`; the step's place, attachment and targets, without references. */
export declare interface AomCursorJSON {
  /** Position in the route. */
  i: number;
  /** `AomApi.toString` of the executed method. */
  step: string;
  /** `AomApi.toString` of the attachment point. */
  origin: string;
  via?: AomViaKind;
  /** For `Next`: `AomApi.toString` of the step whose `\@Next` was expanded. */
  viaGroup?: string;
  /** Only a kind declared with `\@CursorKind`; derivable kinds are added by the application. */
  kind?: AomCursorKind;
  /** In signature order. */
  parameters: AomParameterJSON[];
  /** Classes whose instance this step creates first in the route: its own class, then `\@This` targets. */
  creates: string[];
  /** `\@OnInstance` hooks run on that creation. */
  hooks: string[];
}

// field names are read from rendered schemas; the prefix only shapes `$ref`s, which aren't read
const schemer = new Schemer("#/components/schemas/");

/** OpenAPI `in` of a parameter for each request field that has one. */
const locations: Partial<Record<AomValuesSource, ParameterLocation>> = {
  [AomValuesSource.Query]: "query",
  [AomValuesSource.Headers]: "header",
  [AomValuesSource.Cookies]: "cookie",
  [AomValuesSource.Params]: "path",
};

/** `fn.name` for a class or function, the string itself otherwise. */
const nameOf = (value: unknown): string =>
  typeof value === "function" ? value.name : String(value);

/**
 * One step of a route's execution chain: a middleware, an endpoint, a nextpoint, or an
 * `\@OnInstance` hook, bound to the class (`$`) that owns it. `Router.build` and
 * `AomRoute`'s constructor create cursors while assembling a route; `RxContext.run`
 * executes them one by one.
 *
 * Creating a cursor has a side effect: it re-binds `$` to the correct subclass
 * (`AomApi.resolveFor`, needed when a decorator captured a parent class's static
 * reference before `\@Controller()` ran on the child) and realizes the method's
 * `delayStack` — see `realizeDelay`.
 */
export class AomCursor {
  // the endpoint being applied
  /** Endpoint of the route this cursor belongs to; `undefined` for class-level middleware cursors collected by `Router.build` before `AomRoute` assigns one (see `realizeDelay` and `ROUTE_REF_DELAY_ERROR`). */
  endpoint?: AomEndpoint;

  // place where the cursor is attached
  /** The `AomApi` this cursor was attached from (the class that declared `\@Before`/`\@Bridge`/etc.), used to resolve `Self.Method`-style references against the right subclass. */
  origin: AomApi;

  // path prefix
  /** Path prefix in effect at the point this cursor was collected. */
  prefix: string;

  // sequence number
  /** Position of this cursor within `AomRoute.cursors`, assigned after the route is fully laid out. */
  index!: number;

  // the cursor's own api instance
  /** Meta-instance of the method (or class) this cursor executes — already re-bound to the correct subclass. */
  $: AomApi;

  /** Why the cursor stands in the chain — set where the chain is laid out (`Router.build`, `AomRoute`); `undefined` for cursors built at request time (`\@Run`, `\@OnInstance` hooks). */
  via?: AomViaKind;

  /** For `via === Next`: `AomApi.toString` of the step whose `\@Next` was expanded. */
  viaGroup?: string;

  // ownership chain: classes whose creation this execution branch is holding. Lives on the
  // cursor, not on the context: the context is one per request, while several branches run
  // concurrently (Promise.all over hooks, over arguments), and a shared list would mix them up
  /**
   * Ownership chain: classes whose creation this execution branch is currently holding.
   * Lives on the cursor rather than on `RxContext` because several branches run
   * concurrently within one request (`Promise.all` over hooks, over constructor
   * arguments) and a single shared list would mix them up. Read by
   * `AomApi.instanceWithHooks` to tell "my own creation" from "someone else's" and to
   * build the class-name chain in `CIRCULAR_INSTANCE_ERROR`.
   */
  creating: ClassConstructor[] = [];

  constructor($: AomApi, origin: AomApi, prefix: string, endpoint?: AomEndpoint) {
    // if $ refers to the parent class's static side relative to the attachment point —
    // rebind to the descendant's instance before realizing the delay stack, otherwise
    // ThisRef gets a class without inherited values (e.g. without a builder's schema)
    this.$ = AomApi.resolveFor($, origin._.target);
    this.origin = origin;
    this.prefix = prefix;
    this.endpoint = endpoint;
    this.index = 0;

    this.realizeDelay();
  }

  /**
   * What this cursor's method parameters inject, in signature order: each parameter's
   * descriptor with `ref` resolved by `resolveTarget` for this cursor — the same target the
   * parameter's handler gets on a request. Computed on every call, nothing is stored.
   */
  parameters(): AomCursorParameter[] {
    // Array.from, not map: a parameter without a decorator leaves a hole in the array
    return Array.from(this.$.element.parameters.descriptors, (descriptor) => {
      const { kind, source, ref, name } = descriptor ?? { kind: AomParameterKind.Other };
      const target = resolveTarget(ref, this);
      const parameter: AomCursorParameter = { kind };
      if (source) parameter.source = source;
      // same rule as the `\@This` handler: only an omitted argument means the cursor's own class
      if (kind === AomParameterKind.This) parameter.target = ref ? target : this.$._.target;
      else if (target !== undefined) parameter.target = target;
      if (name) parameter.name = name;
      return parameter;
    });
  }

  /**
   * Projection of this cursor (`JSON.stringify(cursor)`): place, attachment, declared kind,
   * parameter targets, and the instances it creates. Computed on demand, executes nothing.
   *
   * @param created - classes already created by earlier cursors of the route
   *   (`AomRoute.toJSON` shares one set across its cursors and this call adds to it); on its
   *   own the cursor is treated as the first of its route
   */
  toJSON(created?: Set<unknown>): AomCursorJSON {
    // JSON.stringify passes the property key here, not a set
    const seen = created instanceof Set ? created : new Set<unknown>();
    const parameters = this.parameters();
    const creates = [
      this.$._.target,
      ...parameters.filter(({ kind }) => kind === AomParameterKind.This).map(({ target }) => target),
    ].filter((target) => {
      if (seen.has(target)) return false;
      seen.add(target);
      return true;
    });

    const { cursorKind } = this.$.element;
    return {
      i: this.index,
      step: this.$.toString(),
      origin: this.origin.toString(),
      via: this.via,
      ...(this.viaGroup ? { viaGroup: this.viaGroup } : {}),
      ...(cursorKind ? { kind: cursorKind } : {}),
      parameters: parameters.map((parameter) => this.parameterJSON(parameter)),
      creates: creates.map(nameOf),
      hooks: creates.flatMap(
        (target) => AomApi.checkExists(target as ClassConstructor)?.element.instanceHooks.map(String) ?? [],
      ),
    };
  }

  private parameterJSON({ kind, source, target, name }: AomCursorParameter): AomParameterJSON {
    switch (kind) {
      case AomParameterKind.This:
        return { kind, subject: nameOf(target) };
      case AomParameterKind.State:
        return target ? { kind, subject: nameOf(target) } : { kind };
      case AomParameterKind.Values: {
        const fields = this.fields(source!, target);
        return fields.length ? { kind, source: source!, fields } : { kind, source: source! };
      }
      case AomParameterKind.Other:
        return name ? { kind, name } : { kind };
      default:
        return { kind };
    }
  }

  /**
   * Field names a `Values` parameter reads: declared in `$.openApi` (filled by builders'
   * `\@DelayRefStack` after `realizeDelay`) for its source — parameters by location, path
   * parameters, top-level properties of the request body schema; a string key otherwise.
   */
  private fields(source: AomValuesSource, target: unknown): string[] {
    const { openApi } = this.$;
    const names =
      source === AomValuesSource.Body
        ? this.schemaFields(openApi.requestBody?.schema)
        : openApi.parameters.filter((p) => p.in === locations[source]).map((p) => p.name);
    if (source === AomValuesSource.Params) {
      names.push(...openApi.path.flatMap((structure) => Object.values(structure).map((p) => p.name)));
    }
    if (!names.length && typeof target === "string") names.push(target);
    return names;
  }

  private schemaFields(schema: unknown): string[] {
    const resolved = resolveTarget(schema, this);
    const rendered = typeof resolved === "function" ? schemer.render(resolved as ClassConstructor) : resolved;
    return Object.keys((rendered as { properties?: object } | undefined)?.properties ?? {});
  }

  /**
   * Runs the method's `\@DelayRefStack` handlers once, applying the decorators they
   * return via `Reflect.decorate` in the context of the correct subclass. Guarded by
   * `$.delayRealized` so a meta-instance shared by several cursors (class-level
   * middleware reused across routes) only realizes its stack the first time.
   *
   * @throws {Error} `ROUTE_REF_DELAY_ERROR` when the stack contains a `RouteRef` and this
   *   cursor isn't the endpoint itself. The stack is realized once per meta-instance, so on
   *   a step shared by several routes the first route's resolution would silently spread to
   *   the others; a class-level middleware collected by `Router.build` has no `endpoint`
   *   at all.
   *
   * If a handler throws, `delayRealized` is left `false` and the stack is not
   * consumed: the same binding problem reproduces on every subsequent attempt to
   * build a cursor from this meta-instance, instead of silently degrading.
   */
  private realizeDelay() {
    const { $ } = this;

    const { target, property } = $._;
    // the delay stack is realized on the instance exactly once; on error the flag isn't set
    // and the stack isn't consumed — the binding problem reproduces on every subsequent
    // build instead of silently going away
    if (!$.delayRealized && $.delayStack.length) {
      for (const handler of $.delayStack) {
        // run the delayed actions
        // the descriptor must be passed explicitly: without `attributes` the reflect-metadata
        // polyfill invokes the decorator with `descriptor = undefined`, and a queued decorator
        // that assigns `element.descriptor = descriptor` (e.g. UseMarker) then overwrites the
        // descriptor the inherit() transfer had installed — the copied method becomes
        // unexecutable (KI-COMMON-17: AccessController.Required died exactly this way)
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property!);
        // RouteRef is endpoint-specific, while the stack is realized once per meta-instance:
        // only the endpoint's own stack may hold it (a shared step would keep the first route's result)
        if (handler instanceof RouteRefContainer && $ !== this.endpoint?.$) {
          throw new Error(constants.ROUTE_REF_DELAY_ERROR);
        }
        Reflect.decorate([...resolveTarget(handler, this)], target, property!, descriptor);
      }
      $.delayRealized = true;
      // apply any pending delayed calls
      $._.apply();
    }
  }
}
