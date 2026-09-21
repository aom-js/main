import { TransferServiceDescriptor } from "./types";

/** Result of comparing a live registry snapshot against a generated `manifest.json`. */
export interface CheckResult {
  /** Descriptors whose live hash no longer matches the hash recorded at generation time. */
  drifted: TransferServiceDescriptor[];
  /** Descriptors present in the snapshot but not yet generated (no entry in the manifest). */
  missing: TransferServiceDescriptor[];
  /** Service names present in the manifest but gone from the live snapshot. */
  removed: string[];
}

/**
 * Pure comparison between a registry snapshot and a generated `manifest.json` — no file system
 * access, no `process.exit` (both are the CLI's `checkCommand`'s job). Intended to be run in CI to
 * catch generated clients drifting from the live contract.
 *
 * @param descriptors - a live snapshot of service descriptors, e.g. from `collect`
 * @param manifest - `{ serviceName: hash }`, as written by the CLI's `generate` command
 * @returns which services drifted, are missing from the manifest, or were removed from the snapshot
 *
 * @example
 * ```ts
 * import { diffManifest } from "@aom-js/codegen";
 *
 * const { drifted, missing, removed } = diffManifest(descriptors, manifest);
 * if (drifted.length || missing.length || removed.length) {
 *   throw new Error("generated clients are out of date — run `aom-codegen generate`");
 * }
 * ```
 */
export function diffManifest(
  descriptors: TransferServiceDescriptor[],
  manifest: Record<string, string>,
): CheckResult {
  const drifted = descriptors.filter((d) => manifest[d.name] && manifest[d.name] !== d.hash);
  const missing = descriptors.filter((d) => !manifest[d.name]);
  const removed = Object.keys(manifest).filter((name) => !descriptors.some((d) => d.name === name));
  return { drifted, missing, removed };
}
