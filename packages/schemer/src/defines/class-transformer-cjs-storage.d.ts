// class-transformer не публикует .d.ts для cjs-подпути, из которого берётся
// defaultMetadataStorage (обходной путь для class-validator-jsonschema).
//
// Расширение .js здесь обязательно и постобработкой не дописывается: это путь в чужой
// пакет, а не относительный импорт. Без него ESM-вывод падает в рантайме.
//
// Тип берём не из class-transformer/types/*, а из опций потребителя: тот подпуть
// содержит только .d.ts без парных .js и резолвится не во всех режимах.
declare module "class-transformer/cjs/storage.js" {
  type ConverterOptions = NonNullable<
    Parameters<typeof import("class-validator-jsonschema").targetConstructorToSchema>[1]
  >;

  export const defaultMetadataStorage: NonNullable<
    ConverterOptions["classTransformerMetadataStorage"]
  >;
}
