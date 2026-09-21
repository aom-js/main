import { TransferServiceDescriptor } from "./types";
import type { StructureCollectorFunction } from "@aom-js/transfer";

/** The minimal slice of a configured `Transfer` needed by `collect` — makes it easy to substitute a fake in tests. */
export interface CollectSource {
  collectDistributions(handler: StructureCollectorFunction): void;
}

/**
 * Takes a snapshot of the distribution registry: polls the bus via `collectDistributions` and
 * collects descriptors until `timeoutMs` elapses. There is no natural end to the poll — nodes answer
 * whenever they get to it — so the timeout is the only termination signal. Repeated answers for the
 * same service name are last-write-wins, mirroring how the live registry cache behaves. The result is
 * sorted by name, so the same live registry always yields the same snapshot regardless of answer order.
 *
 * @param source - the part of a configured `Transfer` needed to poll the bus
 * @param timeoutMs - how long to wait for answers before resolving (default 3000)
 * @returns descriptors collected before the timeout, sorted by `name`
 *
 * @example
 * ```ts
 * import { collect } from "@aom-js/codegen";
 * import { transfer } from "./config/aom/transfer";
 *
 * const descriptors = await collect(transfer, 3000);
 * // one entry per distributed service currently visible on the bus
 * ```
 */
export function collect(
  source: CollectSource,
  timeoutMs = 3000,
): Promise<TransferServiceDescriptor[]> {
  return new Promise((resolve) => {
    const byName = new Map<string, TransferServiceDescriptor>();
    source.collectDistributions((data) => {
      const descriptors: TransferServiceDescriptor[] = Array.isArray(data.value) ? data.value : [];
      // data from the bus: one broken node (name isn't a string) shouldn't take down the whole snapshot —
      // drop such an entry here rather than crash later on .sort() below
      descriptors
        .filter((descriptor) => typeof descriptor?.name === "string")
        .forEach((descriptor) => byName.set(descriptor.name, descriptor));
    });
    setTimeout(() => {
      resolve([...byName.values()].sort((a, b) => a.name.localeCompare(b.name)));
    }, timeoutMs);
  });
}
