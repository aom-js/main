// Сквозной тест codegen (KI-CODEGEN-01), подзадача #5:
// docs/superpowers/plans/2026-09-14-codegen-folding-design.md (разделы 3, 5, 6, 9, 10, 11).
// Классы фикстуры → распределённый дескриптор (folding при декорировании) → emitService →
// файлы в __generated__ → import() сгенерированного schemas.ts → foldSchemas(сгенерированные
// классы) должен совпасть с descriptor.schemas; JSON Schema (render) каждого компонента —
// тоже должна совпасть между исходником и сгенерированным кодом.
//
// Риск коллизии имён: исходные и сгенерированные классы носят одинаковые имена (BaseEntity,
// NodeA, ...) и одновременно живут в одном процессе. class-validator хранит метаданные в Map,
// ключ — сам конструктор (объект), а не строка с именем, и обходит реальную цепочку прототипов
// (instanceof), поэтому render()/foldSchemas() одного явно переданного класса не видят метаданные
// другого класса с тем же именем. Дополнительно к этому анализу — по требованию задания — эталон
// (originalRenders) снимается ДО import() сгенерированного модуля, а не после.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ClassType } from "@aom-js/core";
import { Schemer, foldSchemas } from "@aom-js/schemer";
import { emitService } from "@aom-js/codegen";
import { transfer } from "./fixtures/roundtrip-service";
import * as Fixture from "./fixtures/roundtrip-service";

const schemer = new Schemer("#/components/schemas/");
const config = { transferImport: "@/config/aom/transfer" };

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = path.join(TEST_DIR, "__generated__", "roundtrip-service");

const descriptor = transfer.registryMap.get("RoundtripService")!;
const originalSchemas = descriptor.schemas!;
// имена компонентов — источник истины: то, что реально попало в дескриптор при декорировании
const componentNames = Object.keys(originalSchemas.components).sort();

function classesByName(mod: Record<string, unknown>, names: string[]): ClassType[] {
  return names.map((name) => {
    const cls = mod[name];
    if (typeof cls !== "function") {
      throw new Error(`roundtrip: "${name}" не экспортирован модулем как класс`);
    }
    return cls as ClassType;
  });
}

function renderByName(mod: Record<string, unknown>, names: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  classesByName(mod, names).forEach((cls, i) => {
    result[names[i]] = schemer.render(cls);
  });
  return result;
}

// эталон снят до генерации и до import() сгенерированного модуля
const originalRenders = renderByName(Fixture as unknown as Record<string, unknown>, componentNames);

describe("codegen: сквозной тест — классы → дескриптор → генерация → import() → свёртка", () => {
  it("дескриптор несёт schemas формата 1 со всеми классами фикстуры (extends, mapped, циклы Type)", () => {
    expect(descriptor.name).toBe("RoundtripService");
    expect(originalSchemas.format).toBe(1);
    expect(componentNames).toEqual([
      "BaseEntity",
      "ChildEntity",
      "IntersectedDto",
      "MixBase",
      "MixExtra",
      "NodeA",
      "NodeB",
      "PartialDto",
      "PickedDto",
      "TaskDto",
    ]);
    expect(Object.keys(originalSchemas.enums).sort()).toEqual(["TaskDtoPriorities", "TaskStatus"]);
  });

  it("генерация идемпотентна: повторный emitService на том же дескрипторе даёт тот же исходник", () => {
    const first = emitService(descriptor, config);
    const second = emitService(descriptor, config);
    expect(second.files).toEqual(first.files);
  });

  it("непереносимый декоратор (Transform) молча пропадает при свёртке ChildEntity.note", () => {
    expect(originalSchemas.components.ChildEntity.properties.note.params.decorators).toEqual([]);
  });

  it("сгенерированные классы после import(): foldSchemas и render совпадают с исходными", async () => {
    const service = emitService(descriptor, config);

    // очищаем перед записью — второй прогон не должен видеть файлы от первого
    fs.rmSync(GENERATED_DIR, { recursive: true, force: true });
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
    service.files.forEach((file) => {
      fs.writeFileSync(path.join(GENERATED_DIR, file.path), file.source);
    });

    const generatedModule = (await import(
      pathToFileURL(path.join(GENERATED_DIR, "schemas.ts")).href
    )) as Record<string, unknown>;

    const generatedClasses = classesByName(generatedModule, componentNames);
    const generatedSchemas = foldSchemas(generatedClasses);
    expect(generatedSchemas).toEqual(originalSchemas);

    const generatedRenders = renderByName(generatedModule, componentNames);
    expect(generatedRenders).toEqual(originalRenders);
  });
});
