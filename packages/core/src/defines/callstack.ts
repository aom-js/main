import { ExecutionPhase, InheritPlacement } from "./types";
import type { AomCore } from "./core";
import type { AomNode } from "./node";
import type {
  AomHandler,
  AomCombinedHandler,
  AomMethodHandler,
  AomPropertyHandler,
  AomParameterHandler,
} from "./internals";

// Key change: make LazyCall more flexible via a generic interface
/** Union of every decorator handler signature a lazy call can carry. */
type LazyCallHandler<T extends AomCore> =
  | AomHandler<T>
  | AomCombinedHandler<T>
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

/**
 * Queue of {@link LazyCall}s for a single {@link ExecutionPhase}, owned by an
 * `AomCallstack`. One instance per phase is created for every node's
 * callstack; behaviour (synchronous vs `setTimeout`, immediate vs deferred)
 * is fixed at construction based on which phase it serves.
 */
export class AomCallstackQueue<T extends AomCore> {
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
export class AomCallstack<T extends AomCore> {
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
    // shortcut: a subclass's own constructor without decorated parameters isn't recognized as
    // such — the parent's will still transfer; detect via design:paramtypes if that's ever
    // needed (KI-CORE-11)
    const skipParameters = Object.values(target._.callstack.stores).some((store) =>
      store.hasParameters(),
    );
    Object.values(ExecutionPhase).forEach((type) => {
      this.stores[type].transferTo(target, skipParameters);
    });
  }
}
