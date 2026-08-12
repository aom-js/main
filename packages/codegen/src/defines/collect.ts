import { TransferServiceDescriptor } from "./types";
import type { StructureCollectorFunction } from "@aom-js/transfer";

/** Достаточная для сбора часть Transfer — упрощает подстановку в тестах */
export interface CollectSource {
  collectDistributions(handler: StructureCollectorFunction): void;
}

/**
 * Снапшот реестра: опрашивает шину через collectDistributions и собирает дескрипторы
 * до истечения таймаута. Завершения у опроса нет — узлы отвечают кто когда успел,
 * поэтому граница по времени. Повторные ответы по одному имени — last-write-wins,
 * как в кэше реестра. Результат отсортирован по имени — снапшот детерминирован.
 */
export function collect(
  source: CollectSource,
  timeoutMs = 3000,
): Promise<TransferServiceDescriptor[]> {
  return new Promise((resolve) => {
    const byName = new Map<string, TransferServiceDescriptor>();
    source.collectDistributions((data) => {
      const descriptors: TransferServiceDescriptor[] = Array.isArray(data.value) ? data.value : [];
      descriptors.forEach((descriptor) => byName.set(descriptor.name, descriptor));
    });
    setTimeout(() => {
      resolve([...byName.values()].sort((a, b) => a.name.localeCompare(b.name)));
    }, timeoutMs);
  });
}
