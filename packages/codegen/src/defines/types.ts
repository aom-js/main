import type { TransferServiceDescriptor } from "@aom-js/transfer";

/** Generator configuration — where a generated `isolator.ts` imports its `Transfer` instance from. */
export declare interface CodegenConfig {
  /** Module specifier of the configured `Transfer` instance; imported verbatim by generated isolators. */
  transferImport: string;

  /** Export name to import from `transferImport`; defaults to the default export. */
  transferExportName?: string;
}

/** One generated file: its path relative to the service's output directory, and its source text. */
export declare interface EmittedFile {
  path: string;
  source: string;
}

/** Result of generating one service. */
export declare interface EmittedService {
  /** Service name — verbatim the isolator class name (topics are derived from it; do not rename after generation). */
  name: string;

  /** sha256 of the contract, embedded in the generated module for drift checks (see `diffManifest`). */
  hash: string;

  files: EmittedFile[];
}

export type { TransferServiceDescriptor };
