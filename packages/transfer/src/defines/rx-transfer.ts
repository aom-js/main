import * as rxjs from "rxjs";
import * as rxjsOperators from "rxjs/operators";
import crypto from "node:crypto";

import { AomIsolator, Transfer, TransferTimeoutError } from "./main";
import {
  TransferCallbackResponse,
  TransferMessageHeaders,
  TransferMessageSchema,
  TransferNextFunction,
  TransferCallbackHandler,
} from "./types";

/**
 * RPC core layered on top of a `Transfer`'s `publisher`/`subscriber` pair.
 *
 * Not exported from the package barrel — reachable only as the value of the public
 * `AomIsolator.rx` field (set by `\@Isolator`) or through `Transfer.prototype.restore`, which
 * creates its own instance to talk to a descriptor without a decorated class. `\@ResponseTopic`/
 * `\@CustomTopic` forward every call to `request`; executors are wired to `execHandler` by
 * `\@Executor`.
 */
export class RxTransfer {
  private transfer: Transfer;

  constructor(transfer: Transfer) {
    this.transfer = transfer;
  }

  /**
   * Ensures exactly one subscription exists on a method's reply topic. Idempotent per
   * meta-instance: repeated calls after the first are a no-op, tracked via `$.replySubscribers`.
   *
   * @param $ - Method meta-instance (or the minimal stand-in built by `Transfer.prototype.restore`) whose `replyTopic` to subscribe.
   * @returns Whether the reply topic is (now) subscribed.
   */
  initReplySubscription($: AomIsolator): boolean {
    const { topic, replyTopic } = $;
    if (!$.replySubscribers[replyTopic]) {
      this.transfer.subscriber({ topic: replyTopic, next: this.replyHandler(topic) });
      $.replySubscribers[replyTopic] = true;
    }
    return $.replySubscribers[replyTopic];
  }

  /**
   * Publishes one isolated call and, for `waitForResponse` methods, resolves with the
   * executor's answer.
   *
   * **Process key / deduplication.** The dedup key is
   * `` `${instanceTopic}_${sha256(JSON.stringify(args))}_${singletone ? "singletone" : uniqKey}` ``,
   * where `instanceTopic` already includes any one-shot `instanceId` address. So two calls
   * collapse into the same in-flight process — and share its result — only when all three
   * match: same address, same arguments (by JSON hash), and `singletone: true` on the method.
   * A non-singleton call never collapses (its key always contains a fresh `uniqKey`); a
   * singleton call to a *different* address or with *different* arguments gets its own key and
   * is not deduplicated. The address is read (and the pending one-shot `instanceId` consumed)
   * on every call, including a deduplicated one, so `Transfer.toInstance` never leaks onto an
   * unrelated later call.
   *
   * **Timeout.** `$.responseTimeout ?? transfer.responseTimeout` decides how long to wait — a
   * method's `\@TopicTimeout` always wins when set. When that value is `0`, no `setTimeout` is
   * created at all: the wait is unbounded, not just long. When it is truthy, the timer is
   * `unref()`-ed wherever the runtime supports it (Node), so it never keeps the process alive by
   * itself. The timer — and the pending `transfer.callbackMap` entry — are cleared on whichever
   * comes first: a response, an error, the timeout firing, or the caller unsubscribing.
   *
   * @param value - Call arguments, published as-is (after `JSON.stringify` for hashing; the
   *   wire payload itself is serialized by `publisher`).
   * @param $ - Method meta-instance (`AomIsolator`, or the minimal stand-in built by `Transfer.prototype.restore`).
   * @returns For `waitForResponse: true`, a `Promise` of the executor's result that rejects with
   *   the executor's error or with `TransferTimeoutError`. Otherwise, an rxjs `Subscription`
   *   whose errors are reported to `transfer.defaultErrorHandler` instead.
   */
  request(value: any[], $: AomIsolator) {
    const { topic, replyTopic } = $;

    // build the topic that folds in the pending instanceId, if this call was addressed to a
    // specific instance; done strictly before the duplicate check: instanceId is one-shot and
    // must be consumed by this exact call, and the resulting address is itself part of the process key
    const instanceTopic = $._.root.instanceTopic(topic);

    // Generate a unique key for the message
    const uniqKey = crypto.randomUUID();

    // compute a hash of the arguments
    const hash = crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

    // build the process key depending on whether this is a singleton call or not;
    // it's based on the address and the arguments the function is called with
    const topicProcessKey = `${instanceTopic}_${hash}_${$.singletone ? "singletone" : uniqKey}`;

    // set the headers, keep the original topic
    const headers: TransferMessageHeaders = {
      replyTopic,
      uniqKey,
    };
    // check whether a process already exists for this topic (relevant for singletons)
    const existsProcess = $.topicProcessMap.get(topicProcessKey);
    // if it exists, return it instead of running the procedure again
    if (existsProcess) {
      return existsProcess;
    }

    // Create an Observable to handle the messages
    const rx$ = rxjs
      .defer(async () => this.initReplySubscription($))
      .pipe(
        rxjsOperators.mergeMap(
          () =>
            new rxjs.Observable((observer) => {
              // Create the callback function for the observer
              const callback: TransferCallbackHandler = callbackObserver(observer);
              // Store the callback in the map by its unique key
              this.transfer.callbackMap.set(uniqKey, callback);
              // Publish the message to the topic; a publisher failure (sync or async) goes into the
              // error stream: unsubscribing clears the callback and the timer
              this.transfer
                .publish({ topic: instanceTopic, message: { headers, value } })
                .catch((error) => observer.error(error));
              // no response within responseTimeout — a timeout error; 0 means wait without a limit;
              // the method can override the transport's value via @TopicTimeout
              const responseTimeout = $.responseTimeout ?? this.transfer.responseTimeout;
              const timer = responseTimeout
                ? setTimeout(
                    () => observer.error(new TransferTimeoutError(instanceTopic, responseTimeout)),
                    responseTimeout,
                  )
                : undefined;
              // don't keep the process alive just for the timer to fire (Node); in browser typings
              // setTimeout returns a number with no unref — the method is only called when it exists
              (timer as unknown as { unref?: () => void })?.unref?.();
              // Cleanup function run on response, error, timeout, and unsubscribe
              return () => {
                clearTimeout(timer);
                this.transfer.callbackMap.delete(uniqKey);
              };
            }),
        ),
      );
    let result: any;
    // if the caller should wait for a response
    if ($.waitForResponse) {
      // Wait for the first value from the stream
      result = rxjs
        .firstValueFrom(rx$)
        .then((result) => {
          $.topicProcessMap.delete(topicProcessKey); // remove this run from the process map
          return result; // return the result
        })
        .catch((err) => {
          $.topicProcessMap.delete(topicProcessKey); // remove this run from the process map
          throw err; // rethrow so it can be caught at the calling level
        });
    } else {
      // Subscribe to the stream without waiting for a response: there is no one to return the
      // executor's error or a timeout to — they go to the transport's defaultErrorHandler
      result = rx$.subscribe({ error: (error) => this.transfer.reportError(error) });
      // Add a cleanup function on unsubscribe
      result.add(() => {
        $.topicProcessMap.delete(topicProcessKey); // remove this run from the process map
      });
    }

    // store the result in the process map, so it can be returned to a deduplicated call
    $.topicProcessMap.set(topicProcessKey, result);
    return result;
  }

  /**
   * Builds the `next` callback subscribed to a method's reply topic. Looks the incoming
   * `headers.uniqKey` up in `transfer.callbackMap` and, if a caller is still waiting, delivers
   * either an error (`headers.error: true`) or a completed result. A message without
   * `uniqKey`, or one whose `uniqKey` has no registered callback (late reply after a timeout,
   * stray message), is silently dropped.
   *
   * @param topic - Topic name passed through to the callback response for bookkeeping.
   * @returns Handler suitable for `TransferSubscribeHandlerArgs.next`.
   */
  replyHandler(topic: string): TransferNextFunction {
    return (data: TransferMessageSchema): void => {
      // Extract the value and headers from the message
      const { value, headers } = data;
      // Extract the unique key and the error flag from the headers
      const { uniqKey, error } = headers;
      // without uniqKey there's no one to address the message to
      if (!uniqKey) return;
      // Look up the callback function by its unique key
      const callback = this.transfer.callbackMap.get(uniqKey);

      // If the callback function exists
      if (callback) {
        // If the headers carry the error flag, call the callback with an error
        if (error) {
          callback({ error: value, topic });
        } else {
          // Otherwise call the callback with the successful result
          callback({ topic, value, isCompleted: true });
        }
      }
    };
  }

  /**
   * Builds the `next` callback an executor subscribes to its instance topic (see
   * `attachIsolation`). Runs `handler` with the message's `value` spread as arguments and
   * always publishes a response to `headers.replyTopic`, success or failure — that response is
   * what lets the caller's `request` clean up its timer/callback/dedup entry, which is why a
   * `\@CustomTopic` with an active executor does not leak even at `responseTimeout: 0`.
   *
   * **Trust boundary.** `value` comes straight off the bus message and is applied to `handler`
   * without checking who published it or whether it matches the method's `\@TopicSchema` (if
   * any) — verifying a message's origin at the transport level is a known gap, not a guarantee
   * this package makes; see `https://github.com/aom-js/main/issues/1`.
   *
   * **Result handling.** `handler` is invoked inside `Promise.resolve().then(...)`, so a
   * synchronous `throw` from a non-async executor is caught exactly like a rejected `Promise`.
   * An `undefined` result is replaced with `{}` before publishing — other falsy values (`0`,
   * `false`, `""`, `null`) are sent as-is.
   *
   * **Error envelope.** A thrown `Error` does not survive JSON serialization, so failures are
   * published as a plain object `{ name, message, status, data }` (non-`Error` throws become
   * `{ message: String(error) }`) with `headers.error: true`. `RxTransfer`'s `callbackObserver`
   * rebuilds an `Error` from this envelope on the calling side, carrying `name`/`status`/`data`
   * along — that's what lands in the `reject` of a `\@ResponseTopic` call or in
   * `defaultErrorHandler` for `\@CustomTopic`.
   *
   * If publishing the response itself fails, the failure goes to `transfer.reportError` instead
   * of being thrown; if the executor had also failed, its original error is attached as `cause`
   * of the reported send failure.
   *
   * @param handler - Executor implementation to run, called as `handler(...value)`.
   * @returns Handler suitable for `TransferSubscribeHandlerArgs.next`.
   */
  execHandler(handler: Function): TransferNextFunction {
    return (message: TransferMessageSchema) => {
      const { value, headers } = message;

      const { replyTopic, uniqKey } = headers;

      // run the given function, spreading the incoming arguments (they arrive as a list);
      // inside then: a synchronous throw from a non-async executor becomes an error response too
      const run = Promise.resolve()
        .then(() => Reflect.apply(handler, undefined, value))
        .then((result) => {
          // if a reply topic is set, send the result
          // falsy results (0, false, "") are legal and are sent as-is — only `undefined` is replaced,
          // because JSON.stringify drops an `undefined` property entirely, which would ship a reply
          // with no `value` key at all; a real reply still has to arrive so the caller's pending
          // entry (timer/callback/dedup) gets cleared, per the class doc above
          return (
            replyTopic &&
            this.transfer.publish({
              topic: replyTopic,
              message: {
                value: result === undefined ? {} : result,
                headers: { uniqKey, replyTopic },
              },
            })
          );
        })
        .catch((error) => {
          // on error, send it to the reply topic
          // an envelope instead of an Error object: Error does not survive the bus's JSON serialization
          const value =
            error instanceof Object
              ? {
                  name: error.name,
                  message: error.message,
                  status: Reflect.get(error, "status"),
                  data: Reflect.get(error, "data"),
                }
              : { message: String(error) };
          return (
            replyTopic &&
            this.transfer
              .publish({
                topic: replyTopic,
                message: { value, headers: { uniqKey, replyTopic, error: true } },
              })
              // the error response failed to send: attach the executor's original error to the send failure
              .catch((failure) => {
                const reported = failure instanceof Error ? failure : new Error(String(failure));
                reported.cause = error;
                throw reported;
              })
          );
        })
        // the response failed to send (publisher failure) — there's no one to return it to
        .catch((error) => this.transfer.reportError(error));
      // Transfer.stop waits for running handlers; run never rejects — it ends with catch
      const { inflight } = this.transfer;
      inflight.add(run);
      run.then(() => inflight.delete(run));
    };
  }
}

/**
 * Adapts a `TransferCallbackHandler` to an rxjs `Observer`: an error envelope becomes
 * `observer.error`, a completed value becomes `observer.next` followed by `observer.complete`.
 * Used by `RxTransfer.request` as the callback registered in `transfer.callbackMap`.
 *
 * @param observer - rxjs observer driving the `Observable` returned to the caller of `request`.
 * @returns `TransferCallbackHandler` to register for one pending call.
 */
function callbackObserver(observer: rxjs.Observer<unknown>) {
  /**
   * Rebuilds an `Error` from the envelope that crossed the bus — the counterpart of the
   * `{name, message, status, data}` envelope `RxTransfer.execHandler` publishes on failure.
   *
   * @param err - Error envelope (or an already-`Error` value, passed through unchanged).
   * @param topic - Unused; kept for symmetry with `serializeResponse`.
   * @returns An `Error` with `name`/`status`/`data` restored from the envelope, when present.
   */
  const serializeError = (err: any, topic: string) => {
    if (err instanceof Error) return err;
    const restored = new Error(err?.message ?? String(err));
    if (err && typeof err === "object") {
      const { name, status, data } = err;
      if (name) restored.name = name;
      Object.assign(restored, { status, data });
    }
    return restored;
  };

  /** Pass-through hook for a successful response value; currently returns it unchanged. */
  const serializeResponse = (response: any, topic: string) => {
    // console.log("do serialize response", response);
    return response;
  };

  // Return the result-handling function
  return (result: TransferCallbackResponse) => {
    //
    const { error, value, topic, isCompleted } = result;

    // Handle the different kinds of results
    if (error) {
      return observer.error(serializeError(error, topic));
    } else if (isCompleted) {
      observer.next(serializeResponse(value, topic));
      return observer.complete();
    }
    observer.next(serializeResponse(value, topic));
    return null;
  };
}
