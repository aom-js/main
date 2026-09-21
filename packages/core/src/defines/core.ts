import {
  ClassConstructor,
  CombinedDecorator,
  ClassType,
  Property,
  ExecutionPhase,
  InheritPlacement,
  InstanceTarget,
} from "./types";
import { isClass } from "./functions";
import { AomNode } from "./node";
import type {
  AomClass,
  OriginDescriptor,
  AomHandler,
  AomCombinedHandler,
  AomMethodHandler,
  AomPropertyHandler,
  AomParameterHandler,
} from "./internals";

/**
 * Base class for building a legacy-decorator meta-class: subclass it to get
 * your own instance registry (keyed by "class + property") and five
 * decorator factories that queue their handler as a lazy call instead of
 * running it immediately.
 *
 * Subclasses hold their own application state as regular instance fields —
 * `AomCore` itself only carries one field, the service node `_`. Every
 * meta-class you define (`class MySchemas extends AomCore {}`) gets an
 * independent registry: two subclasses with different names never share
 * instances, even for the same decorated class.
 *
 * @example
 * ```ts
 * import { AomCore } from "@aom-js/core";
 *
 * class Meta extends AomCore {
 *   label?: string;
 * }
 *
 * const Label = (label: string) =>
 *   Meta.classDecorator(($) => {
 *     $.label = label;
 *   });
 *
 * @Label("service")
 * class UserService {}
 *
 * Meta.instance(UserService).label; // "service"
 * ```
 */
export class AomCore {
  /** This meta-instance's service node: target/property identity, decorator queues, and inheritance. */
  _: AomNode<this>;

  constructor(
    base: AomClass<any>,
    target: ClassConstructor,
    property?: Property,
    origin?: OriginDescriptor,
  ) {
    this._ = new AomNode<this>(this, base, target, property, origin);
  }

  /** Lazily creates and returns the `WeakMap` backing this meta-class's registry, stored on the meta-class itself under a per-class `Symbol.for` key. */
  private static instancesMap<T extends AomCore, E extends InstanceTarget>(
    this: AomClass<T>,
  ): WeakMap<E | T, T> {
    //
    const mapSymbol = Symbol.for(`AOM_MAP_${this.name}`);

    // check whether a map already exists for this specific class ('this')
    if (!(this as any)[mapSymbol]) {
      // if not, create it
      (this as any)[mapSymbol] = new WeakMap<E | T, T>();
    }

    // get a reference to the map
    const map: WeakMap<E | T, T> = (this as any)[mapSymbol];

    return map;
  }

  /**
   * Computes the registry key for `target`(`+property`). Methods are keyed
   * by the function value itself (so `instance(A, "run")` and
   * `instance(A.run)` resolve to the same instance); a decorated non-method
   * property (an instance field, or an enumerable static data field) has no
   * stable function to key on, so a synthetic meta-instance is created,
   * registered under itself, and stashed in the owning class's `statics`/
   * `properties` map. Everything else (no `property`, or `target` isn't a
   * class) is keyed by `target` directly.
   */
  private static instanceKey<T extends AomCore, E extends InstanceTarget>(
    this: AomClass<T>,
    target: E,
    property?: Property,
  ): T | E {
    // extract the constructor that will be the root
    const constructor = (
      target instanceof Function ? target : target.constructor
    ) as ClassConstructor;

    const map = this.instancesMap();

    let instanceKey: T | E;
    // if a specific property is given, and the current context is for a specific class
    if (property && isClass(constructor)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);

      if (descriptor && descriptor.value && !descriptor.enumerable) {
        // if this is a method, use the descriptor's value as the instance key — the
        // same value the method will be referenced by via its name
        instanceKey = descriptor.value as E;
      } else {
        // get its own instance
        const constructorInstance = this.instance(constructor);
        // if it's a property, figure out whether it's static or own, and get the relevant map from there
        let propertiesMap: Map<Property, T>;
        // if the incoming target equals constructor, this is a static context
        if (target === constructor) {
          propertiesMap = constructorInstance._.statics;
        } else {
          // otherwise it's an own-properties context
          propertiesMap = constructorInstance._.properties;
        }
        const existing = propertiesMap.get(property);
        if (existing) {
          instanceKey = existing;
        } else {
          const originDescriptor = { target, property, descriptor };

          // create the instance
          instanceKey = new this(this, constructor, property, originDescriptor);
          // register it in the shared map
          map.set(instanceKey, instanceKey);
          // store it in the relevant map
          propertiesMap.set(property, instanceKey);
        }
      }
    } else {
      instanceKey = target;
    }

    return instanceKey;
  }

  /**
   * Looks up an existing meta-instance for `target` (`+property`) without
   * creating one. Returns `undefined` if none exists yet.
   *
   * For a plain class lookup (no `property`) this is a pure read. Passing
   * `property` for a target that has no property descriptor yet takes the
   * same code path as `instance()` and can create and register a synthetic
   * instance as a side effect — in practice every call in this codebase
   * passes only a class, so this branch is unreachable in normal use, but
   * it's not a guarantee `checkExists` makes for arbitrary input.
   *
   * @param target - a class, function, or prototype/instance to look up
   * @param property - optional property/method key on `target`
   * @returns the existing meta-instance, or `undefined`
   *
   * @example
   * ```ts
   * import { AomCore } from "@aom-js/core";
   *
   * class Meta extends AomCore {}
   * class Service {}
   *
   * Meta.checkExists(Service); // undefined — nothing decorated it yet
   * Meta.instance(Service);
   * Meta.checkExists(Service); // the same instance now
   * ```
   */
  static checkExists<T extends AomCore, E extends InstanceTarget>(
    this: AomClass<T>,
    target: E,
    property?: Property,
  ): T | undefined {
    const map = this.instancesMap();

    const instanceKey = this.instanceKey(target, property);

    return map.get(instanceKey);
  }

  /**
   * Finds or creates the meta-instance for `target` (`+property`) in this
   * meta-class's registry. This is what every decorator factory calls under
   * the hood, and it's also the main entry point for reading state an
   * application-defined meta-class attached to a decorated class.
   *
   * Repeated calls with the same `target`/`property` return the same
   * instance. If an instance was previously created by function value alone
   * (e.g. `instance(A.run)`, before `A` was known to own `run` as a named
   * property), a later call with the class and property name
   * (`instance(A, "run")`) resolves to that same instance and repairs its
   * node (`target`/`property`/`root`) to the correct values.
   *
   * @param target - a class, function, or prototype/instance to look up
   * @param property - optional property/method key on `target`; omit to address the class itself
   * @returns the meta-instance, created on first access
   *
   * @example
   * ```ts
   * import { AomCore } from "@aom-js/core";
   *
   * class Meta extends AomCore {
   *   calls = 0;
   * }
   *
   * class Service {}
   *
   * Meta.instance(Service).calls++;
   * Meta.instance(Service).calls; // 1 — same instance every time
   * ```
   */
  static instance<T extends AomCore, E extends InstanceTarget>(
    this: AomClass<T>,
    target: E,
    property?: Property,
  ): T {
    // use a Symbol for a unique map key on each subclass
    // look up an existing instance for target in this class's map
    // if property is given, the class instance is stored by the function handler
    const map = this.instancesMap();

    const instanceKey = this.instanceKey(target, property);

    // extract the constructor that will be the root
    const constructor = (
      target instanceof Function ? target : target.constructor
    ) as ClassConstructor;

    let instance = map.get(instanceKey);

    // console.log("defined instance key", { target, property, instanceKey, instance });

    // originDescriptor only makes sense for a specific property — there is none at the class level
    const originDescriptor: OriginDescriptor | undefined =
      property === undefined
        ? undefined
        : { target, property, descriptor: Reflect.getOwnPropertyDescriptor(target, property) };

    // if there is no instance
    if (!instance) {
      // create a new instance of the current class ('this')
      instance = new this(this, constructor, property, originDescriptor);
      // instance = this.create(constructor, property, originDescriptor);
      // store it in the map
      map.set(instanceKey, instance);
    } else if (property && instance._.target !== constructor) {
      // tricky case that can happen if an instance for some static function/method was
      // created earlier than a useful decorator was declared for the property itself —
      // in that case its `_` value needs to be replaced with a correct one, with the
      // right target, root, and property
      instance._ = new AomNode(instance, this, constructor, property, originDescriptor);
    }

    // return the found or created instance
    return instance;
  }

  /**
   * Late-binds a meta-instance reference to a subclass context. A reference
   * like `@Before(Self.Method)` is evaluated at decoration time, before the
   * subclass's own aggregator decorator (e.g. `@Controller()`) has run, so
   * it captures the *parent's* meta-instance for `Method`. After
   * `inherit()` runs, the subclass owns a curried copy of `Method` with its
   * own meta-instance; `resolveFor($, context)` redirects the original
   * reference to that copy when `context` is a subclass that already has
   * one.
   *
   * If `$` doesn't describe a property, or `context` isn't a subclass of
   * `$`'s owner, or the subclass has no copy of the property yet, `$` is
   * returned unchanged — the call is always safe on an arbitrary reference.
   *
   * @param $ - a meta-instance reference captured earlier, possibly pointing at a parent class member
   * @param context - the class to resolve the reference in
   * @returns `context`'s own meta-instance for the same property if one exists, otherwise `$` unchanged
   *
   * @example
   * ```ts
   * import { AomCore } from "@aom-js/core";
   *
   * class Meta extends AomCore {}
   *
   * class Base {
   *   static run() {}
   * }
   * const staleRef = Meta.instance(Base, "run"); // captured before Child owns its own copy
   *
   * class Child extends Base {}
   * Meta.instance(Child)._.inherit(Base); // Child now has its own curried "run"
   *
   * Meta.resolveFor(staleRef, Child); // Child's own meta-instance for "run", not Base's
   * ```
   */
  // late resolution of a static reference against the context class: if the `$` instance
  // is bound to the context's parent, return the instance of the subclass's curried copy
  static resolveFor<T extends AomCore>(this: AomClass<T>, $: T, context: ClassConstructor): T {
    const { target, property } = $._;
    // Object.hasOwn is required: the subclass only gets its own copy via inherit();
    // without it, instance() would create an empty instance with no descriptor instead of the correct one
    if (property && context.prototype instanceof target && Object.hasOwn(context, property)) {
      return this.instance(context, property);
    }
    return $;
  }

  /**
   * Builds a class decorator that queues `handler` as a lazy call instead of
   * running it directly. `handler` receives the class's meta-instance,
   * obtained via `this.instance(target)`.
   *
   * The value `handler` returns is discarded — none of the five factories
   * forward it to TypeScript, so a class decorator built this way cannot
   * replace the constructor.
   *
   * @param handler - runs with the class's meta-instance as `$`
   * @param storeFlag - {@link ExecutionPhase} controlling when `handler` runs (default `FIRST`, i.e. immediately)
   * @param inherit - {@link InheritPlacement} controlling how this call is treated when transferred to a subclass by `inherit()`
   * @returns a `ClassDecorator` ready to apply with `@`
   *
   * @example
   * ```ts
   * import { AomCore } from "@aom-js/core";
   *
   * class Meta extends AomCore {
   *   tag?: string;
   * }
   *
   * const Tag = (tag: string) =>
   *   Meta.classDecorator(($) => {
   *     $.tag = tag;
   *   });
   *
   * @Tag("service")
   * class UserService {}
   *
   * Meta.instance(UserService).tag; // "service"
   * ```
   */
  // use AomClass for 'this'
  static classDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomHandler<T>,
    storeFlag: ExecutionPhase = ExecutionPhase.FIRST,
    inherit?: InheritPlacement,
  ): ClassDecorator {
    const self = this; // t is now typed as AomClass<T>
    return function (target: ClassType) {
      // get the AOM instance for this constructor
      const targetInstance = self.instance(target);
      targetInstance._.callstack.add([handler, [targetInstance], inherit], storeFlag);
      // Class decorators can return a constructor, but here we're only used for the side effect
    };
  }

  /**
   * Builds a decorator usable on either a class or a method, returned typed
   * as {@link CombinedDecorator}. `handler` gets a `descriptor` only when
   * applied to a method — check for its presence to tell the two cases
   * apart. Applied via `Reflect.decorate` (or plain `@`) the same way as the
   * other factories; TypeScript itself applies method decorators before
   * class decorators on the same declaration.
   *
   * @param handler - `descriptor` is defined for a method application, `undefined` for a class application
   * @param storeFlag - {@link ExecutionPhase} controlling when `handler` runs (default `FIRST`, i.e. immediately)
   * @param inherit - {@link InheritPlacement} controlling how this call is treated when transferred to a subclass by `inherit()`
   * @returns a {@link CombinedDecorator}
   *
   * @example
   * ```ts
   * import { AomCore } from "@aom-js/core";
   *
   * class Meta extends AomCore {}
   *
   * const Both = () =>
   *   Meta.combinedDecorator(($, descriptor) => {
   *     console.log(descriptor ? "method" : "class");
   *   });
   *
   * @Both()
   * class Service {
   *   @Both()
   *   static run() {}
   * }
   * ```
   */
  // use AomClass for 'this'
  static combinedDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomCombinedHandler<T>,
    storeFlag: ExecutionPhase = ExecutionPhase.FIRST,
    inherit?: InheritPlacement,
  ): CombinedDecorator {
    const self = this;
    return function (target: InstanceTarget, property?: Property, descriptor?: PropertyDescriptor) {
      // get the AOM instance for this constructor
      const targetInstance = self.instance(target, property);
      targetInstance._.callstack.add([handler, [targetInstance, descriptor], inherit], storeFlag);
      // call the handler
      // return handler(targetInstance, descriptor);
    };
  }

  /**
   * Builds a method decorator (static or prototype method) that queues
   * `handler` as a lazy call. `handler` always receives the method's
   * `PropertyDescriptor` alongside its meta-instance.
   *
   * `handler`'s return value is never used to replace the descriptor — in
   * any phase — so this cannot swap out the method implementation the way a
   * native TypeScript method decorator can. Use the meta-instance's own
   * state, or mutate the descriptor's `value` in place, if you need to
   * affect behaviour.
   *
   * @param handler - runs with the method's meta-instance and its descriptor
   * @param storeFlag - {@link ExecutionPhase} controlling when `handler` runs (default `FIRST`, i.e. immediately)
   * @param inherit - {@link InheritPlacement} controlling how this call is treated when transferred to a subclass by `inherit()`
   * @returns a `MethodDecorator` ready to apply with `@`
   *
   * @example
   * ```ts
   * import { AomCore } from "@aom-js/core";
   *
   * class Meta extends AomCore {}
   *
   * const LogCall = () =>
   *   Meta.methodDecorator(($, descriptor) => {
   *     console.log(`decorated ${$._.target.name}.${String($._.property)}`);
   *   });
   *
   * class Service {
   *   @LogCall()
   *   static run() {}
   * }
   * ```
   */
  // use AomClass for 'this'
  static methodDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomMethodHandler<T>,
    storeFlag: ExecutionPhase = ExecutionPhase.FIRST,
    inherit?: InheritPlacement,
  ): MethodDecorator {
    const self = this; // t is now typed as AomClass<T>
    return function (target: InstanceTarget, property: Property, descriptor: PropertyDescriptor) {
      // get the AOM instance for the class's constructor
      const targetInstance = self.instance(target, property);
      targetInstance._.callstack.add([handler, [targetInstance, descriptor], inherit], storeFlag);
      // return handler(targetInstance, descriptor);
    };
  }

  /**
   * Builds a property decorator (instance field or static data field) that
   * queues `handler` as a lazy call. `handler` receives only the field's
   * meta-instance — there is no descriptor to inspect at decoration time for
   * a field.
   *
   * @param handler - runs with the field's meta-instance as `$`
   * @param storeFlag - {@link ExecutionPhase} controlling when `handler` runs (default `FIRST`, i.e. immediately)
   * @param inherit - {@link InheritPlacement} controlling how this call is treated when transferred to a subclass by `inherit()`
   * @returns a `PropertyDecorator` ready to apply with `@`
   *
   * @example
   * ```ts
   * import { AomCore, ExecutionPhase } from "@aom-js/core";
   *
   * class Meta extends AomCore {}
   *
   * const Required = () =>
   *   Meta.propertyDecorator(($) => {
   *     console.log(`required: ${String($._.property)}`);
   *   }, ExecutionPhase.LAST);
   *
   * class UserDto {
   *   @Required()
   *   email!: string;
   * }
   * ```
   */
  // use AomClass for 'this'
  static propertyDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomPropertyHandler<T>,
    storeFlag: ExecutionPhase = ExecutionPhase.FIRST,
    inherit?: InheritPlacement,
  ): PropertyDecorator {
    const self = this; // t is now typed as AomClass<T>
    return function (target: InstanceTarget, property: Property) {
      // get the AOM instance for the class's constructor
      const targetInstance = self.instance(target, property);
      targetInstance._.callstack.add([handler, [targetInstance], inherit], storeFlag);
      // return handler(targetInstance);
    };
  }

  /**
   * Builds a parameter decorator (constructor or method parameter) that
   * queues `handler` as a lazy call. `handler` receives `parameterIndex` as
   * a plain argument — it does not control where in the queue the call ends
   * up, so multiple decorated parameters on the same method just run in the
   * order TypeScript applies them (right to left, for a single decorator per
   * parameter).
   *
   * For a constructor parameter, `property` is `undefined`, so the
   * meta-instance resolves to the class's own node rather than a specific
   * method's. This is also the only decorator kind marked internally so
   * `inherit()` can skip transferring it onto a subclass that declares its
   * own decorated constructor (see the `LazyCall` tuple in `callstack.ts`).
   *
   * @param handler - runs with the meta-instance and the zero-based parameter index
   * @param storeFlag - {@link ExecutionPhase} controlling when `handler` runs (default `FIRST`, i.e. immediately)
   * @param inherit - {@link InheritPlacement} controlling how this call is treated when transferred to a subclass by `inherit()`
   * @returns a `ParameterDecorator` ready to apply with `@`
   *
   * @example
   * ```ts
   * import { AomCore } from "@aom-js/core";
   *
   * class Meta extends AomCore {}
   *
   * const Inject = () =>
   *   Meta.parameterDecorator(($, index) => {
   *     console.log(`param ${index} of ${$._.target.name}`);
   *   });
   *
   * class Service {
   *   static run(@Inject() a: string, @Inject() b: string) {}
   * }
   * ```
   */
  // use AomClass for 'this'
  static parameterDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomParameterHandler<T>,
    storeFlag: ExecutionPhase = ExecutionPhase.FIRST,
    inherit?: InheritPlacement,
  ): ParameterDecorator {
    const self = this; // t is now typed as AomClass<T>
    // property === undefined for constructor parameters — then this is the context of the class itself
    return function (
      target: InstanceTarget,
      property: Property | undefined,
      parameterIndex: number,
    ) {
      // get the AOM instance for the class's constructor
      const targetInstance = self.instance(target, property);
      //
      targetInstance._.callstack.add(
        [handler, [targetInstance, parameterIndex], inherit, true],
        storeFlag,
      );
    };
  }
}
