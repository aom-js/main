import type { TransferServiceDescriptor } from "@aom-js/transfer";

/** Конфигурация генератора */
export declare interface CodegenConfig {
  /** module specifier сконфигурированного Transfer — его импортируют сгенерированные изоляторы */
  transferImport: string;

  /** имя экспорта в модуле transferImport; по умолчанию — default */
  transferExportName?: string;
}

/** Один сгенерированный файл: путь относительно каталога сервиса и исходник */
export declare interface EmittedFile {
  path: string;
  source: string;
}

/** Результат генерации одного сервиса */
export declare interface EmittedService {
  /** имя сервиса — дословно имя класса изолятора (топики выводятся из имени, не переименовывать) */
  name: string;

  /** sha256 контракта, зашитый в сгенерированный модуль для сверки дрейфа */
  hash: string;

  files: EmittedFile[];
}

export type { TransferServiceDescriptor };
