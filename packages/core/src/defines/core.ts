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

/** Handler signature for {@link AomCore.classDecorator}: receives the class's meta-instance. */
declare type AomHandler<T extends AomCore> = ($: T) => void;

/** Handler signature for {@link AomCore.combinedDecorator}: `descriptor` is set only for methods. */
declare type AomСombinedHandler<T extends AomCore> = (
  $: T,
  descriptor?: PropertyDescriptor,
) => void;

/** Handler signature for {@link AomCore.methodDecorator}: always called with the method's descriptor. */
// the handler's return value goes nowhere: add() in core.ts calls it only for its
// side effect, the value from run() is unused
declare type AomMethodHandler<T extends AomCore> = ($: T, descriptor: PropertyDescriptor) => void;

/** Handler signature for {@link AomCore.propertyDecorator}. */
declare type AomPropertyHandler<T extends AomCore> = ($: T) => void;

/** Handler signature for {@link AomCore.parameterDecorator}: `parameterIndex` is the constructor/method parameter position. */
declare type AomParameterHandler<T extends AomCore> = ($: T, parameterIndex: number) => void;

// Helper type combining the constructor signature and AOM's static methods
/** A meta-class: a concrete `AomCore` subclass constructor together with `AomCore`'s static registry/factory methods. */
type AomClass<T extends AomCore> = ClassConstructor<T> & typeof AomCore;

// Key change: make LazyCall more flexible via a generic interface
/** Union of every decorator handler signature a lazy call can carry. */
type LazyCallHandler<T extends AomCore> =
  | AomHandler<T>
  | AomСombinedHandler<T>
  | AomMethodHandler<T>
  | AomPropertyHandler<T>
  | AomParameterHandler<T>;

/**
 * A deferred decorator invocation queued by one of `AomCore`'s decorator
 * factories: `[handler, args, inherit?, parameter?]`.
 *
 * - `handler` — the decorator's own callback, applied later via `Reflect.apply`.
 * - `args` — arguments passed to `handler`; `args[0]` is always the meta-instance
 *   `$`, and it gets swapped for the subclass's meta-instance when the call is
 *   transferred by `inherit()`/`transferTo()`.
 * - `inherit` — {@link InheritPlacement} for this specific call, overriding the
 *   default `APPEND` behaviour when transferred to a subclass.
 * - `parameter` — `true` only for calls produced by {@link AomCore.parameterDecorator}.
 *   `transferTo()` uses this flag to skip transferring constructor-parameter
 *   decorators onto a subclass that declares its own constructor with its own
 *   decorated parameters (see `AomCallstack.transferTo`), so the parent's
 *   parameter decorators don't run again and overwrite the subclass's.
 */
type LazyCall<T extends AomCore> = [
  LazyCallHandler<T>,
  args: [T, ...any],
  inherit?: InheritPlacement,
  // parameter decorator call: not transferred to a subclass that has its own
  parameter?: boolean,
];

/** What was actually decorated: the target, the property key, and its descriptor (if any existed yet). */
type OriginDescriptor = {
  target: InstanceTarget;
  property: Property;
  // descriptor may be absent: class fields don't have one yet at decoration time
  descriptor?: PropertyDescriptor;
};

/** An {@link OriginDescriptor} together with the node/meta-instance it was resolved to, as stored in `AomNode.origins`. */
type NodeOriginDescriptor<T extends AomCore> = { _: AomNode<T>; self: T } & OriginDescriptor;

/**
 * Queue of {@link LazyCall}s for a single {@link ExecutionPhase}, owned by an
 * `AomCallstack`. One instance per phase is created for every node's
 * callstack; behaviour (synchronous vs `setTimeout`, immediate vs deferred)
 * is fixed at construction based on which phase it serves.
 */
class AomCallstackQueue<T extends AomCore> {
  private readonly __nominal?: T;

  private queue: Array<LazyCall<any>>;
  private fired: Array<LazyCall<any>>;

  private callstack: AomCallstack<T>;

  private type: ExecutionPhase;

  private async: boolean;

  // deferred phase: calls accumulate in the queue until exec() runs, rather than executing when added
  private deferred: boolean;

  constructor(callstack: AomCallstack<T>, type: ExecutionPhase) {
    this.callstack = callstack;

    this.queue = [];
    this.fired = [];

    this.type = type;
    this.async = [ExecutionPhase.DELAY].includes(type);
    this.deferred = [ExecutionPhase.LAST, ExecutionPhase.DELAY].includes(type);
  }

  /** Inserts a block of calls at the front of `queue` in one shot, preserving their relative order (a series of `unshift` calls would reverse it). */
  // insert a block of calls at the front of the queue, preserving their relative order
  prependBatch(values: Array<LazyCall<any>>) {
    this.queue.unshift(...values);
  }

  /**
   * Adds a lazy call to this phase's queue and, for `FIRST`/`INSTANT`, runs
   * it immediately (see {@link ExecutionPhase}). `LAST`/`DELAY` only push
   * onto `queue`, to be run later by `exec()`.
   */
  add<U extends T>(value: LazyCall<U>) {
    const { type } = this;
    // if this is a deferred run or a last-moment run, just push it onto the queue
    // maybe add DecoratorsQueueStore.DELAY here later
    if (this.deferred) {
      this.queue.push(value);
    } else if ([ExecutionPhase.FIRST].includes(type)) {
      // if we're running first, execute it and add it to the list
      this.fired.push(value);
      return this.run(value);
    } else if (type === ExecutionPhase.INSTANT) {
      // instant run: executed right away and kept nowhere — unlike FIRST, it never
      // goes into `fired`, so transferTo()/inherit() can never replay it on a subclass.
      // INSTANT decorators (e.g. holder's Delay/Apply) rely on that: they run exactly
      // once, on the class that carries them, and handle propagating their own effect
      // to subclasses themselves.
      return this.run(value);
    }
  }

  /** Drains `queue` in FIFO order, running and moving each call into `fired`. A later `exec()` call is a no-op unless new calls were queued since. */
  exec() {
    // drain the queue and move everything into fired
    let value: LazyCall<any> | undefined;
    while ((value = this.queue.shift())) {
      this.run(value);
      this.fired.push(value);
    }
  }

  /** Invokes `handler` with `args` via `Reflect.apply`. For `DELAY`, this happens inside a `setTimeout(..., 0)`, so the return value and any thrown error are lost to the caller. */
  run<U extends T>([handler, args]: LazyCall<U>) {
    // run([handler, args]: LazyCall<any>) {
    if (this.async) {
      setTimeout(() => {
        Reflect.apply(handler, null, args);
      });
    } else {
      return Reflect.apply(handler, null, args);
    }
  }

  /** Whether this queue holds any constructor-parameter decorator calls (own or already transferred). Used by `AomCallstack.transferTo` to decide whether a subclass has its own decorated constructor parameters. */
  // whether the queue holds any parameter-decorator calls (own or transferred)
  hasParameters() {
    return [...this.fired, ...this.queue].some(([, , , parameter]) => parameter);
  }

  /**
   * Copies every call from `fired` and `queue` onto `target`'s queue for the
   * same phase, rebinding the first argument (`$`) to `target`. Calls marked
   * `InheritPlacement.SKIP` are dropped; calls marked `PREPEND` are batched
   * and inserted at the front (only meaningful for deferred phases, since
   * `FIRST`/`INSTANT` calls already ran by the time transfer happens). When
   * `skipParameters` is set, constructor-parameter calls (`parameter: true`)
   * are dropped too — see {@link AomCallstack.transferTo}.
   */
  transferTo<U extends T>(target: U, skipParameters = false) {
    const { type } = this;
    // invoke with the context replaced
    const replaceContext = (value: LazyCall<T>) => {
      const [handler, args, inherit, parameter] = value;
      // build a new args array with the context replaced
      const newArgs = [target, ...args.slice(1)] as [U, ...any];
      target._.callstack.add([handler, newArgs, inherit, parameter], type);
    };
    // transfer data from the queue and fired lists, replacing context and preserving the storage type during transfer
    // already-fired calls are transferred first, then pending ones
    const prepend: Array<LazyCall<any>> = [];
    [...this.fired, ...this.queue].forEach((value) => {
      const [handler, args, inherit, parameter] = value;
      if (inherit === InheritPlacement.SKIP || (parameter && skipParameters)) return;
      // PREPEND only makes sense for deferred phases: FIRST/INSTANT run right at
      // transfer time, and their order is determined by the transfer itself
      if (inherit === InheritPlacement.PREPEND && this.deferred) {
        prepend.push([handler, [target, ...args.slice(1)] as [U, ...any], inherit, parameter]);
      } else {
        replaceContext(value);
      }
    });
    // as a single block at the front of the subclass's queue: unshifting one at a time would reverse the order
    if (prepend.length) {
      target._.callstack.stores[type].prependBatch(prepend);
    }
  }
}

/**
 * Holds one {@link AomCallstackQueue} per {@link ExecutionPhase} for a single
 * `AomNode`. This is what `$._.callstack` gives access to: the raw, per-phase
 * queues of decorator calls that haven't run yet (or ran and are kept for
 * transfer to subclasses).
 */
class AomCallstack<T extends AomCore> {
  private readonly __nominal?: T;

  _: AomNode<T>;

  stores: { [key in ExecutionPhase]: AomCallstackQueue<T> };

  constructor(_: AomNode<T>) {
    this._ = _;

    this.stores = {} as any;
    Object.values(ExecutionPhase).forEach((type) => {
      this.stores[type] = new AomCallstackQueue<T>(this, type);
    });
  }

  /** Routes a lazy call to the queue for `storeFlag`. Called by every decorator factory on `AomCore`. */
  add<U extends T>(value: LazyCall<U>, storeFlag: ExecutionPhase) {
    this.stores[storeFlag].add(value);
  }

  /**
   * Drains every phase's queue, in enum declaration order
   * (`INSTANT`, `FIRST`, `LAST`, `DELAY`). By the time this runs, `INSTANT`
   * and `FIRST` are already empty by construction (they ran at decoration
   * time), so in practice this is what executes `LAST` synchronously and
   * schedules `DELAY` via `setTimeout`.
   */
  apply() {
    Object.values(ExecutionPhase).forEach((type) => {
      this.stores[type].exec();
    });
  }

  /**
   * Transfers every phase's calls onto `target`'s callstack (see
   * `AomCallstackQueue.transferTo`). Before transferring, it checks whether
   * `target` already has its own constructor-parameter decorator calls; if
   * so, the parent's constructor-parameter calls are skipped entirely rather
   * than appended after the subclass's own (which would run afterwards and
   * clobber their result).
   */
  transferTo<U extends T>(target: U) {
    // the subclass has its own constructor with decorated parameters — the parent
    // constructor's parameters don't apply to it (otherwise they'd run after its own and overwrite them)
    // ponytail: a subclass's own constructor without decorated parameters isn't recognized as
    // such — the parent's will still transfer; detect via design:paramtypes if that's ever needed
    const skipParameters = Object.values(target._.callstack.stores).some((store) =>
      store.hasParameters(),
    );
    Object.values(ExecutionPhase).forEach((type) => {
      this.stores[type].transferTo(target, skipParameters);
    });
  }
}

/**
 * The service part of a meta-instance, reachable as `$._`. Every `AomCore`
 * instance owns exactly one `AomNode`, created by the registry
 * (`AomCore.instance`/`checkExists`) rather than by application code.
 *
 * This is where the mechanics application code actually touches live:
 * `$._.target`/`$._.property`/`$._.root` identify what was decorated,
 * `$._.callstack` holds the not-yet-run decorator calls, and `apply()`/
 * `inherit()` drive execution and metadata inheritance.
 */
class AomNode<T extends AomCore> {
  private readonly __nominal?: T;

  /** The meta-class whose registry created this instance; used to call `base.instance(...)` for related lookups. */
  base: AomClass<T>;

  /** The owning constructor — always a constructor, whether this node describes the class itself, a static member, or an instance field. */
  target: ClassConstructor;

  /** The decorated property key, if this node describes a property/method rather than the class itself. */
  property?: Property;

  // root structure for the node
  /** The class-level meta-instance: for a property node, the meta-instance of `target` itself; for a class node, `self`. */
  root: T;

  /** The meta-instance this node belongs to. */
  self: T;

  /** What was actually decorated: the class (for statics) or its prototype (for instance members). */
  originInstance: InstanceTarget;

  /**
   * Decorated methods and instance fields collected on the root node only
   * (never on a property node). Populated when a property/method meta-instance
   * is created without an `enumerable` descriptor — i.e. everything except
   * enumerable static data fields, which live in `statics` instead. Consumed
   * by `apply()` and `inherit()` to reach every decorated member of the class.
   */
  origins: NodeOriginDescriptor<T>[];

  // parents whose calls have already been transferred onto this node: a repeated
  // inherit() call for the same parent must not re-run its FIRST queue
  private inherited: WeakSet<ClassType>;

  /** Synthetic meta-instances for instance fields that have no property descriptor of their own, keyed by property name. */
  properties: Map<Property, T>;

  /** Synthetic meta-instances for enumerable static data fields, keyed by property name. */
  statics: Map<Property, T>;

  // stack of calls that need to run
  /** This node's own queues of not-yet-run decorator calls, one per {@link ExecutionPhase}. */
  callstack: AomCallstack<T>;

  constructor(
    self: T,
    base: AomClass<any>,
    target: ClassConstructor,
    property?: Property,
    origin?: OriginDescriptor,
  ) {
    this.self = self;
    this.base = base;
    this.target = target;
    this.property = property;

    this.properties = new Map();
    this.statics = new Map();

    this.origins = [];
    this.inherited = new WeakSet();
    this.callstack = new AomCallstack(this);

    // if a specific property is given, record the link to it on the instance from the original constructor
    if (property) {
      this.root = this.base.instance(target);
      if (origin) {
        this.originInstance = origin.target;
        if (!origin.descriptor?.enumerable) {
          this.root._.origins.push({ _: this, self, ...origin });
        }
      }
    } else {
      this.root = this.self;
    }
  }

  /**
   * Runs every deferred (`LAST`/`DELAY`) decorator call collected on this
   * node and on every member it owns, in a fixed order: synthetic instance
   * field nodes (`properties`), then synthetic static field nodes
   * (`statics`), then decorated methods/fields (`origins`), and finally this
   * node's own queue. Call this on the root node — decorators declared with
   * `LAST`/`DELAY` never run unless something calls `apply()` on the class.
   *
   * @example
   * ```ts
   * import { AomCore, ExecutionPhase } from "@aom-js/core";
   *
   * class Meta extends AomCore {}
   * const Late = () => Meta.methodDecorator(($) => console.log("ran"), ExecutionPhase.LAST);
   *
   * class Service {
   *   @Late()
   *   static run() {}
   * }
   *
   * Meta.instance(Service)._.apply(); // only now does "ran" print
   * ```
   */
  apply() {
    // run all deferred actions on own properties
    this.properties.forEach(($) => {
      $._.callstack.apply();
    });

    // run all deferred actions on static properties
    this.statics.forEach(($) => {
      $._.callstack.apply();
    });

    // walk everything by descriptor
    this.origins.forEach(({ _ }) => {
      // this.base.instance(descriptor.value)._.callstack.apply();
      _.callstack.apply();
    });

    // run this node's own deferred calls
    this.callstack.apply();
  }

  /**
   * Transfers `parent`'s decorator metadata onto this node's meta-instance,
   * so a subclass ends up carrying its parent's decorator behaviour. Two
   * things happen, in order:
   *
   * 1. `parent`'s own callstack is transferred to `this.self`
   *    (`AomCallstack.transferTo`): `FIRST` calls re-run immediately in the
   *    subclass's context, `LAST`/`DELAY` calls are queued for the
   *    subclass, and calls marked constructor-parameter are dropped if the
   *    subclass has its own decorated constructor parameters.
   * 2. Every decorated property/method in `parent._.origins` is transferred
   *    to the subclass, unless the subclass already owns that property
   *    (checked both physically via `Object.hasOwn` and via the
   *    `statics`/`properties` registry maps, since instance fields have no
   *    physical presence on the prototype). Transferring a method creates a
   *    curried copy on the subclass — a *different* function with its own
   *    meta-instance, so `Child.run !== Parent.run`; `this` inside the copy
   *    is whatever the copy itself was called with (the subclass for
   *    statics, the instance for prototype methods).
   *
   * Calling `inherit()` twice with the same `parent` is a no-op the second
   * time (tracked via `inherited`) — otherwise `FIRST` calls would fire
   * again on every repeated call.
   *
   * @param parent - the parent class (or function) whose metadata to transfer
   * @returns the parent's meta-instance, e.g. for chaining further calls to `parent`'s node
   *
   * @example
   * ```ts
   * import { AomCore } from "@aom-js/core";
   *
   * class Meta extends AomCore {}
   * const Mark = (label: string) => Meta.classDecorator(($) => console.log(label));
   *
   * @Mark("parent")
   * class Base {}
   * class Controller extends Base {}
   *
   * Meta.instance(Controller)._.inherit(Base); // re-runs "parent" in Controller's context
   * ```
   */
  inherit(parent: ClassType) {
    const $parent = this.base.instance(parent);

    // a repeated inherit() call for the same parent must not re-run its FIRST queue
    if (this.inherited.has(parent)) {
      return $parent;
    }
    this.inherited.add(parent);

    // transfer the parent's own calls onto the final subclass
    $parent._.callstack.transferTo(this.self);

    const transferDescritorWithDecorators = (
      target: InstanceTarget,
      property: Property,
      source: T,
      descriptor?: PropertyDescriptor,
    ) => {
      if (descriptor && descriptor.value) {
        // currying is required here, otherwise the context of the original parent
        // class's descriptor would get overwritten
        // this is forwarded to the caller (not bound to null): for statics that's the
        // concrete class, for a prototype method the instance it was called on
        const curriedDescriptor = function (this: any, ...args: any[]) {
          return Reflect.apply(descriptor.value, this, args);
        };
        // define it
        Reflect.defineProperty(target, property, {
          ...descriptor,
          value: curriedDescriptor,
        });
      }
      const $childInstance = this.base.instance(target, property as string);
      // and here the corresponding transfer of all decorators must happen, by
      // transferring the relevant values in the callstack
      source._.callstack.transferTo($childInstance);
    };

    // console.log (this.properties);
    // transfer decorated data from static properties and methods
    $parent._.origins.forEach((origin) => {
      const $origin = origin.descriptor ? this.base.instance(origin.descriptor.value) : origin.self;
      const isClassOrigin = origin.target === $origin._.target;

      const property = $origin._.property!;

      // Transfer is blocked if the subclass already owns the property. There are two
      // checks, and both are needed: Object.hasOwn covers statics and prototype methods;
      // the AOM registry covers class fields (they don't exist on the prototype/constructor,
      // so the physical check can't see them). The reverse holds too: methods never end up
      // in the registry — instanceKey() keys them by descriptor.value and never touches the
      // statics/properties maps.
      if (
        isClassOrigin &&
        !Object.hasOwn(this.target, property) &&
        !this.root._.statics.get(property)
      ) {
        transferDescritorWithDecorators(this.target, property, $origin, origin.descriptor);
      } else if (
        !isClassOrigin &&
        !Object.hasOwn(this.target.prototype, property) &&
        !this.root._.properties.get(property)
      ) {
        // otherwise check that this is a property of the instance itself, and the corresponding transfers need to be created
        transferDescritorWithDecorators(
          this.target.prototype,
          property,
          $origin,
          origin.descriptor,
        );
      } else {
        // console.log(`same property exists ${this.target.name}.${origin.property.toString()}`);
        // errors.push(
        //   new Error(`same property exists ${this.target.name}.${origin.property.toString()}`),
        // );
      }
    });

    return $parent;
  }
}

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
    handler: AomСombinedHandler<T>,
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
   * own decorated constructor (see {@link LazyCall}).
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
