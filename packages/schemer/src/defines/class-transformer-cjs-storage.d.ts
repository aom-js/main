// class-transformer doesn't publish a .d.ts for the cjs subpath that defaultMetadataStorage
// is imported from (a workaround for class-validator-jsonschema).
//
// The .js extension here is mandatory and isn't appended by any post-processing: this is a
// path into someone else's package, not a relative import. Without it, the ESM build fails
// at runtime.
//
// The type is taken not from class-transformer/types/*, but from the consumer's options: that
// subpath contains only a .d.ts with no matching .js and doesn't resolve in every mode.
declare module "class-transformer/cjs/storage.js" {
  type ConverterOptions = NonNullable<
    Parameters<typeof import("class-validator-jsonschema").targetConstructorToSchema>[1]
  >;

  export const defaultMetadataStorage: NonNullable<
    ConverterOptions["classTransformerMetadataStorage"]
  >;
}
