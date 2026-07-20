# Test Coverage Implementation Plan (@aom-js monorepo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Покрыть все пять пакетов монорепозитория (`core`, `schemer`, `api`, `transfer`, `holder`) поведенческими (black-box) тестами через публичный API, создав страховочную сетку для последующего рефакторинга (api→router, дистрибуция изоляторов, миграция на stage-3 декораторы).

**Architecture:** Тесты — характеризационные, через публичные декораторы и классы, без привязки к внутренностям (`AomNode`, callstack) — внутренности будут переписаны при stage-3-миграции, тесты должны это пережить. HTTP не поднимается: роуты гоняются через фейковый `HttpContextValues`-объект; шина сообщений — in-memory фейк с логом публикаций. Один раннер (vitest) на весь монорепозиторий, транспиляция через SWC (обязательно: esbuild не эмитит `design:type`).

**Tech Stack:** vitest + unplugin-swc + @swc/core (legacyDecorator + decoratorMetadata), @vitest/coverage-v8. Никаких новых runtime-зависимостей.

## Global Constraints

- Тесты пишутся ТОЛЬКО через публичный API пакетов (импорт из корня пакета: `@aom-js/core` и т.д.). Запрещено импортировать внутренние файлы (`src/defines/...`) — кроме явно указанных в задачах мест.
- `@aom-js/api` переедет в `@aom-js/router`; имя api получит новый пакет с батарейками. Поэтому: тестовые сьюты называть по механикам («router: построение маршрутов»), импорт пакета — одной строкой в начале файла.
- Политика характеризационных тестов: тест зафиксировал НЕ то поведение, что ожидалось → сначала перечитать исходник; если ожидание теста неверно — исправить тест; если найден дефект кода — НЕ чинить код, пометить тест `it.fails(...)` с комментарием `// FINDING: ...` и добавить строку в `docs/superpowers/plans/2026-07-20-test-coverage-findings.md`. Починка дефектов — отдельная работа после этого плана.
- Каждый тестовый файл самодостаточен: классы объявляются внутри файла/тестов (vitest изолирует модули по файлам — глобальные WeakMap-реестры aom не пересекаются между файлами).
- Имена тестов и комментарии — на русском (язык кодовой базы).
- Node ≥ 20, yarn 1 (workspaces). Команды запускать из корня репозитория.

---

### Task 0: Тестовая инфраструктура (vitest + SWC)

**Files:**
- Modify: `package.json` (корень: devDependencies + scripts)
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Test: `packages/core/test/smoke.test.ts`

**Interfaces:**
- Produces: команда `yarn test` (все последующие задачи запускают её); алиасы `@aom-js/*` → `packages/*/src`, глобальный импорт `reflect-metadata`.

- [ ] **Step 1: Установить dev-зависимости**

```bash
yarn add -D -W vitest @vitest/coverage-v8 unplugin-swc @swc/core
```

- [ ] **Step 2: Создать `vitest.config.ts` в корне**

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import swc from "unplugin-swc";

export default defineConfig({
  plugins: [
    // ВАЖНО: esbuild (дефолт vitest) не эмитит design:type — только SWC/tsc.
    swc.vite({
      jsc: {
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: "es2020",
      },
    }),
  ],
  resolve: {
    alias: {
      "@aom-js/core": resolve(__dirname, "packages/core/src"),
      "@aom-js/schemer": resolve(__dirname, "packages/schemer/src"),
      "@aom-js/api": resolve(__dirname, "packages/api/src"),
      "@aom-js/transfer": resolve(__dirname, "packages/transfer/src"),
      "@aom-js/holder": resolve(__dirname, "packages/holder/src"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/*/test/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
    },
  },
});
```

- [ ] **Step 3: Создать `vitest.setup.ts`**

```ts
import "reflect-metadata";
```

- [ ] **Step 4: Заменить сломанные корневые скрипты в `package.json`**

Текущие `test`/`lint` вызывают `yarn workspaces run test` — в пакетах нет секции `scripts`, команда падает. Заменить в корневом `package.json`:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

(остальные скрипты — `build:*`, `clean`, `prebuild`, `publish` — не трогать, они вне скоупа этого плана).

- [ ] **Step 5: Написать smoke-тест транспиляции**

`packages/core/test/smoke.test.ts` — проверяет ровно те два свойства транспилятора, на которых стоит вся кодовая база (legacy-синтаксис и эмиссия `design:type`):

```ts
import { describe, it, expect } from "vitest";

describe("smoke: транспиляция legacy-декораторов", () => {
  it("legacy property-декоратор получает (target, property)", () => {
    const seen: Array<[object, string | symbol]> = [];
    const Dec = (): PropertyDecorator => (target, property) => {
      seen.push([target, property]);
    };
    class S {
      @Dec()
      field!: string;
    }
    expect(seen).toEqual([[S.prototype, "field"]]);
  });

  it("decoratorMetadata эмитится (design:type доступен)", () => {
    const Dec = (): PropertyDecorator => () => {};
    class S {
      @Dec()
      field!: string;
    }
    expect(Reflect.getMetadata("design:type", S.prototype, "field")).toBe(String);
  });
});
```

- [ ] **Step 6: Запустить и убедиться, что тест проходит**

Run: `yarn test`
Expected: `2 passed`. Если второй тест упал — конфигурация SWC неверна (см. Step 2), чинить до зелёного.

- [ ] **Step 7: Создать файл находок**

`docs/superpowers/plans/2026-07-20-test-coverage-findings.md`:

```markdown
# Находки при покрытии тестами (2026-07-20)

Дефекты, обнаруженные характеризационными тестами. Тесты помечены `it.fails`.

| # | Пакет | Описание | Тест |
|---|-------|----------|------|
```

- [ ] **Step 8: Commit**

```bash
git add package.json yarn.lock vitest.config.ts vitest.setup.ts packages/core/test/smoke.test.ts docs/superpowers/plans/2026-07-20-test-coverage-findings.md
git commit -m "test: настроена тестовая инфраструктура vitest+swc для монорепозитория"
```

---

### Task 1: core — реестр инстансов

**Files:**
- Test: `packages/core/test/registry.test.ts`

**Interfaces:**
- Consumes: `AomCore`, `ClassInstanceMap` из `@aom-js/core`.
- Produces: паттерн `class Meta extends AomCore` — все последующие core-тесты используют собственный мета-класс-наследник, как это делают schemer/api/transfer.

- [ ] **Step 1: Написать тесты реестра**

`packages/core/test/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AomCore, ClassInstanceMap } from "@aom-js/core";

class Meta extends AomCore {
  label?: string;
}

describe("core: реестр инстансов", () => {
  it("один класс — один и тот же мета-инстанс", () => {
    class A {}
    const a1 = Meta.instance(A);
    const a2 = Meta.instance(A);
    expect(a1).toBe(a2);
    expect(a1).toBeInstanceOf(Meta);
    expect(a1._.target).toBe(A);
  });

  it("наследник получает собственный инстанс, отличный от родителя", () => {
    class A {}
    class B extends A {}
    expect(Meta.instance(B)).not.toBe(Meta.instance(A));
  });

  it("разные мета-классы ведут независимые карты", () => {
    class Other extends AomCore {}
    class A {}
    const m = Meta.instance(A);
    const o = Other.instance(A);
    expect(m).not.toBe(o);
    expect(o).toBeInstanceOf(Other);
  });

  it("статический метод ключуется по идентичности функции", () => {
    class A {
      static handler() {}
    }
    const viaProperty = Meta.instance(A, "handler");
    const viaValue = Meta.instance(A.handler);
    expect(viaProperty).toBe(viaValue);
    expect(viaProperty._.target).toBe(A);
    expect(viaProperty._.property).toBe("handler");
  });

  it("инстанс, созданный по значению функции, дополняется нодой при обращении по свойству", () => {
    class A {
      static handler() {}
    }
    const viaValue = Meta.instance(A.handler); // сначала по функции
    const viaProperty = Meta.instance(A, "handler");
    expect(viaProperty).toBe(viaValue);
    // нода заменена на корректную (см. core.ts: instance(), ветка property && target !== constructor)
    expect(viaValue._.target).toBe(A);
    expect(viaValue._.property).toBe("handler");
  });

  it("свойство инстанса попадает в карту properties корневого класса", () => {
    class A {
      field?: string;
    }
    const $field = Meta.instance(A.prototype, "field");
    const $root = Meta.instance(A);
    expect($root._.properties.get("field")).toBe($field);
    expect($field._.root).toBe($root);
  });

  it("статическое НЕ-методное свойство попадает в карту statics", () => {
    class A {
      static config?: string;
    }
    const $static = Meta.instance(A, "config");
    const $root = Meta.instance(A);
    expect($root._.statics.get("config")).toBe($static);
  });

  it("checkExists не создает инстанс", () => {
    class A {}
    expect(Meta.checkExists(A)).toBeUndefined();
    const created = Meta.instance(A);
    expect(Meta.checkExists(A)).toBe(created);
  });
});

describe("core: ClassInstanceMap", () => {
  it("типизированный get/set/has/delete по конструктору", () => {
    class Service {
      x = 1;
    }
    const map = new ClassInstanceMap();
    expect(map.has(Service)).toBe(false);
    map.set(Service, new Service());
    expect(map.has(Service)).toBe(true);
    expect(map.get(Service)!.x).toBe(1);
    map.delete(Service);
    expect(map.get(Service)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Запустить**

Run: `yarn test packages/core/test/registry.test.ts`
Expected: PASS. При падении — применить политику находок (Global Constraints).

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/registry.test.ts
git commit -m "test(core): реестр инстансов и ClassInstanceMap"
```

---

### Task 2: core — фабрики декораторов и фазы исполнения

**Files:**
- Test: `packages/core/test/phases.test.ts`

**Interfaces:**
- Consumes: `AomCore`, `ExecutionPhase` из `@aom-js/core`.
- Produces: зафиксированные инварианты фаз — INSTANT/FIRST выполняются при декорировании, LAST — при `apply()`, DELAY — асинхронно после `apply()`. Эти инварианты обязана сохранить stage-3-миграция.

- [ ] **Step 1: Написать тесты фаз**

`packages/core/test/phases.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AomCore, ExecutionPhase } from "@aom-js/core";

class Meta extends AomCore {}

describe("core: фабрики декораторов и фазы", () => {
  it("classDecorator FIRST выполняется в момент декорирования, $ указывает на класс", () => {
    const log: string[] = [];
    const Mark = (label: string) =>
      Meta.classDecorator(($) => log.push(`${label}@${$._.target.name}`));
    @Mark("cls")
    class A {}
    expect(log).toEqual(["cls@A"]);
    expect(Meta.checkExists(A)).toBeDefined();
  });

  it("methodDecorator FIRST получает дескриптор и корректный $", () => {
    let seen: { name: string; property: string; hasValue: boolean } | undefined;
    const Mark = () =>
      Meta.methodDecorator(($, descriptor) => {
        seen = {
          name: $._.target.name,
          property: String($._.property),
          hasValue: typeof descriptor.value === "function",
        };
      });
    class B {
      @Mark()
      static run() {}
    }
    expect(seen).toEqual({ name: "B", property: "run", hasValue: true });
  });

  it("LAST на методе выполняется только при apply() корневого класса", () => {
    const log: string[] = [];
    const Late = () => Meta.methodDecorator(($) => log.push("last"), ExecutionPhase.LAST);
    class C {
      @Late()
      static run() {}
    }
    expect(log).toEqual([]); // отложено
    Meta.instance(C)._.apply(); // класс разбирает очереди методов через origins
    expect(log).toEqual(["last"]);
  });

  it("порядок фаз при apply(): FIRST уже выполнен, затем LAST, затем DELAY (асинхронно)", async () => {
    const log: string[] = [];
    const Mark = (label: string, phase: ExecutionPhase) =>
      Meta.classDecorator(($) => log.push(label), phase);
    // legacy-декораторы применяются снизу вверх: delay, last, first
    @Mark("first", ExecutionPhase.FIRST)
    @Mark("last", ExecutionPhase.LAST)
    @Mark("delay", ExecutionPhase.DELAY)
    class D {}
    expect(log).toEqual(["first"]); // только FIRST сработал при декорировании
    Meta.instance(D)._.apply();
    expect(log).toEqual(["first", "last"]); // DELAY еще нет — он через setTimeout
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(["first", "last", "delay"]);
  });

  it("INSTANT выполняется немедленно и не сохраняется в очередях", () => {
    const log: string[] = [];
    const Now = () => Meta.classDecorator(($) => log.push("now"), ExecutionPhase.INSTANT);
    @Now()
    class E {}
    expect(log).toEqual(["now"]);
    Meta.instance(E)._.apply();
    expect(log).toEqual(["now"]); // повторного вызова нет
  });

  it("propertyDecorator работает на свойствах инстанса", () => {
    const log: string[] = [];
    const Prop = () =>
      Meta.propertyDecorator(($) => log.push(String($._.property)), ExecutionPhase.LAST);
    class F {
      @Prop()
      field!: string;
    }
    Meta.instance(F)._.apply();
    expect(log).toEqual(["field"]);
  });

  it("parameterDecorator получает индекс параметра, порядок стабилен по индексам", () => {
    const seen: number[] = [];
    const Param = () => Meta.parameterDecorator(($, index) => seen.push(index));
    class G {
      static run(@Param() a: string, @Param() b: string, @Param() c: string) {}
    }
    // legacy применяет параметры справа налево, но индексы приходят корректные
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it("combinedDecorator различает класс и статический метод", () => {
    const kinds: string[] = [];
    const Both = () =>
      Meta.combinedDecorator(($, descriptor) =>
        kinds.push(descriptor ? "method" : "class"),
      );
    @Both()
    class H {
      @Both()
      static run() {}
    }
    expect(kinds).toEqual(["method", "class"]); // метод декорируется раньше класса
  });
});
```

- [ ] **Step 2: Запустить**

Run: `yarn test packages/core/test/phases.test.ts`
Expected: PASS (при расхождении — политика находок).

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/phases.test.ts
git commit -m "test(core): фабрики декораторов и семантика фаз исполнения"
```

---

### Task 3: core — наследование (inherit / transferTo / каррирование)

**Files:**
- Test: `packages/core/test/inherit.test.ts`

**Interfaces:**
- Consumes: `AomCore`, `ExecutionPhase`; паттерн `Meta.instance(Child)._.inherit(Parent)` — так его вызывают `@Controller`, `@ComponentSchema`, holder.

- [ ] **Step 1: Написать тесты наследования**

`packages/core/test/inherit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AomCore, ExecutionPhase } from "@aom-js/core";

class Meta extends AomCore {}

const makeLog = () => {
  const log: string[] = [];
  const MarkClass = (l: string) =>
    Meta.classDecorator(($) => log.push(`${l}@${$._.target.name}`));
  const MarkMethod = (l: string) =>
    Meta.methodDecorator(($) => log.push(`${l}@${$._.target.name}.${String($._.property)}`));
  return { log, MarkClass, MarkMethod };
};

describe("core: наследование декораторов", () => {
  it("inherit повторяет FIRST-вызовы родителя в контексте потомка", () => {
    const { log, MarkClass } = makeLog();
    @MarkClass("cls")
    class Parent {}
    class Child extends Parent {}
    expect(log).toEqual(["cls@Parent"]);
    Meta.instance(Child)._.inherit(Parent);
    expect(log).toEqual(["cls@Parent", "cls@Child"]);
  });

  it("статический метод родителя переносится на потомка каррированной копией", () => {
    const { log, MarkMethod } = makeLog();
    class Parent {
      @MarkMethod("m")
      static run() {
        return "from-parent";
      }
    }
    class Child extends Parent {}
    Meta.instance(Child)._.inherit(Parent);
    // потомок получил СОБСТВЕННОЕ свойство (не прототипное наследование)
    expect(Object.prototype.hasOwnProperty.call(Child, "run")).toBe(true);
    expect(Child.run).not.toBe(Parent.run); // каррированная копия — иная идентичность
    expect(Child.run()).toBe("from-parent"); // поведение сохранено
    // и мета-вызов повторён в контексте потомка
    expect(log).toContain("m@Child.run");
    // у родителя ничего не изменилось
    expect(log.filter((l) => l === "m@Parent.run")).toHaveLength(1);
  });

  it("собственное переопределение потомка не затирается переносом", () => {
    const { MarkMethod } = makeLog();
    class Parent {
      @MarkMethod("m")
      static run() {
        return "parent";
      }
    }
    class Child extends Parent {
      static run() {
        return "child";
      }
    }
    Meta.instance(Child)._.inherit(Parent);
    expect(Child.run()).toBe("child");
  });

  it("отложенные LAST-вызовы родителя переносятся и выполняются при apply() потомка", () => {
    const log: string[] = [];
    const Late = (l: string) =>
      Meta.classDecorator(($) => log.push(`${l}@${$._.target.name}`), ExecutionPhase.LAST);
    @Late("late")
    class Parent {}
    class Child extends Parent {}
    Meta.instance(Child)._.inherit(Parent);
    expect(log).toEqual([]); // у родителя apply не вызывался, у потомка тоже
    Meta.instance(Child)._.apply();
    expect(log).toEqual(["late@Child"]);
  });

  it("перенос декораторов свойств инстанса: у потомка появляется собственный мета-инстанс свойства", () => {
    const Late = () => Meta.propertyDecorator(() => {}, ExecutionPhase.LAST);
    class Parent {
      @Late()
      field!: string;
    }
    class Child extends Parent {}
    Meta.instance(Child)._.inherit(Parent);
    const $childField = Meta.checkExists(Child.prototype, "field");
    const $parentField = Meta.checkExists(Parent.prototype, "field");
    expect($childField).toBeDefined();
    expect($childField).not.toBe($parentField);
  });
});
```

- [ ] **Step 2: Запустить**

Run: `yarn test packages/core/test/inherit.test.ts`
Expected: PASS (при расхождении — политика находок; этот файл — самый вероятный источник находок, внимательно сверять с `packages/core/src/defines/core.ts` перед пометкой `it.fails`).

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/inherit.test.ts
git commit -m "test(core): наследование — inherit, transferTo, каррирование дескрипторов"
```

---

### Task 4: schemer — рендер JSON Schema

**Files:**
- Test: `packages/schemer/test/render.test.ts`

**Interfaces:**
- Consumes: `ComponentSchema`, `PropertySchema`, `Schemer`, `AomSchemas` из `@aom-js/schemer`. Обёртки: `PropertySchema.String`, `.Number`, `.Boolean`, `.Date`, `.Enum`, `.Any`, `.Type` (ключи — значения enum `SchemaTypes`).
- Produces: паттерн «класс с декораторами → `new Schemer(prefix).render(Class)` → проверка структуры» — используется в Task 6 и Task 9.

- [ ] **Step 1: Написать тесты рендера**

`packages/schemer/test/render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ComponentSchema, PropertySchema, Schemer, AomSchemas } from "@aom-js/schemer";

const schemer = new Schemer("#/components/schemas/");

enum Status {
  Active = "active",
  Blocked = "blocked",
}

@ComponentSchema({ description: "Пользователь" })
class UserDto {
  @PropertySchema.String({ minLength: 2, maxLength: 50, description: "Имя" })
  name!: string;

  @PropertySchema.Number({ isOptional: true, minValue: 0 })
  age?: number;

  @PropertySchema.Boolean({ isOptional: true, default: false })
  active?: boolean;

  @PropertySchema.Enum({ value: Status, isOptional: true })
  status?: Status;
}

describe("schemer: рендер JSON Schema", () => {
  it("класс регистрируется как компонентная схема", () => {
    const $user = AomSchemas.checkExists(UserDto);
    expect($user?.isComponentSchema).toBe(true);
  });

  it("свойства рендерятся с типами и ограничениями", () => {
    const schema = schemer.render(UserDto);
    expect(schema.properties).toMatchObject({
      name: { type: "string", minLength: 2, maxLength: 50, description: "Имя" },
      age: { type: "number", minimum: 0 },
      active: { type: "boolean", default: false },
    });
    expect((schema.properties!.status as any).enum).toEqual(
      expect.arrayContaining(["active", "blocked"]),
    );
  });

  it("required содержит только обязательные свойства", () => {
    const schema = schemer.render(UserDto);
    expect(schema.required).toContain("name");
    expect(schema.required ?? []).not.toContain("age");
    expect(schema.required ?? []).not.toContain("status");
  });

  it("описание класса из ComponentSchema попадает в схему", () => {
    const schema = schemer.render(UserDto);
    expect(schema.description).toBe("Пользователь");
  });

  it("Type создает связь (connections) и $ref в рендере", () => {
    @ComponentSchema()
    class Pet {
      @PropertySchema.String({})
      nick!: string;
    }

    @ComponentSchema()
    class Owner {
      @PropertySchema.Type({ value: () => Pet })
      pet!: Pet;
    }

    const $owner = AomSchemas.checkExists(Owner)!;
    const connection = $owner.connections.get("pet");
    expect(connection).toBeTypeOf("function");
    expect(connection!()).toBe(Pet);

    const schema = schemer.render(Owner);
    expect(JSON.stringify(schema.properties!.pet)).toContain("#/components/schemas/Pet");
  });

  it("наследование: схема потомка включает свойства родителя", () => {
    @ComponentSchema()
    class BaseDto {
      @PropertySchema.String({})
      id!: string;
    }

    @ComponentSchema()
    class ExtDto extends BaseDto {
      @PropertySchema.String({})
      extra!: string;
    }

    const schema = schemer.render(ExtDto);
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["id", "extra"]),
    );
  });
});
```

- [ ] **Step 2: Запустить**

Run: `yarn test packages/schemer/test/render.test.ts`
Expected: PASS. Точные ключи вывода `class-validator-jsonschema` могут отличаться (например, `minimum` vs `exclusiveMinimum`) — сверять с фактическим выводом, ослаблять только конкретное утверждение, не весь тест.

- [ ] **Step 3: Commit**

```bash
git add packages/schemer/test/render.test.ts
git commit -m "test(schemer): рендер JSON Schema — типы, required, связи, наследование"
```

---

### Task 5: schemer — трансформация и валидация в рантайме

**Files:**
- Test: `packages/schemer/test/runtime.test.ts`

**Interfaces:**
- Consumes: `ComponentSchema`, `PropertySchema` из `@aom-js/schemer`; `plainToInstance`, `instanceToPlain` из `class-transformer`; `validateSync` из `class-validator` (это runtime-зависимости schemer, использовать их в тестах легально).

- [ ] **Step 1: Написать тесты рантайма**

`packages/schemer/test/runtime.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { plainToInstance, instanceToPlain } from "class-transformer";
import { validateSync } from "class-validator";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";

@ComponentSchema()
class FormDto {
  @PropertySchema.String({ minLength: 2 })
  name!: string;

  @PropertySchema.Number({ isOptional: true })
  age?: number;

  @PropertySchema.Boolean({ isOptional: true })
  active?: boolean;

  @PropertySchema.Date({ isOptional: true })
  born?: Date;

  @PropertySchema.Number({ isOptional: true, nullable: true })
  score?: number | null;

  @PropertySchema.String({ isOptional: true, hidden: true })
  secret?: string;
}

describe("schemer: трансформация значений", () => {
  it("Number приводит строку к числу", () => {
    const dto = plainToInstance(FormDto, { name: "ok", age: "42" });
    expect(dto.age).toBe(42);
  });

  it('Boolean понимает "true"/"false" и числа', () => {
    expect(plainToInstance(FormDto, { name: "ok", active: "true" }).active).toBe(true);
    expect(plainToInstance(FormDto, { name: "ok", active: "false" }).active).toBe(false);
    expect(plainToInstance(FormDto, { name: "ok", active: "1" }).active).toBe(true);
  });

  it("Date приводит строку к дате", () => {
    const dto = plainToInstance(FormDto, { name: "ok", born: "2020-01-02" });
    expect(dto.born).toBeInstanceOf(Date);
    expect(dto.born!.getFullYear()).toBe(2020);
  });

  it("nullable пропускает null без приведения", () => {
    const dto = plainToInstance(FormDto, { name: "ok", score: null });
    expect(dto.score).toBeNull();
  });

  it("hidden исключает свойство при сериализации", () => {
    const dto = plainToInstance(FormDto, { name: "ok", secret: "x" });
    expect(instanceToPlain(dto)).not.toHaveProperty("secret");
  });
});

describe("schemer: валидация", () => {
  it("отсутствие обязательного свойства — ошибка", () => {
    const errors = validateSync(plainToInstance(FormDto, {}));
    expect(errors.map((e) => e.property)).toContain("name");
  });

  it("нарушение minLength — ошибка", () => {
    const errors = validateSync(plainToInstance(FormDto, { name: "a" }));
    expect(errors.map((e) => e.property)).toContain("name");
  });

  it("валидный объект проходит без ошибок", () => {
    const errors = validateSync(plainToInstance(FormDto, { name: "ok", age: "5" }));
    expect(errors).toEqual([]);
  });
});

describe("schemer: защита от двойного описания", () => {
  it("два PropertySchema на одном свойстве — ошибка при декорировании класса", () => {
    expect(() => {
      @ComponentSchema()
      class Bad {
        @PropertySchema.String({})
        @PropertySchema.Number({})
        x!: unknown;
      }
      void Bad;
    }).toThrow(/already has defined schema params/);
  });
});
```

- [ ] **Step 2: Запустить**

Run: `yarn test packages/schemer/test/runtime.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/schemer/test/runtime.test.ts
git commit -m "test(schemer): трансформация, валидация и защита от двойного описания"
```

---

### Task 6: schemer — mapped-types

**Files:**
- Test: `packages/schemer/test/mapped-types.test.ts`

**Interfaces:**
- Consumes: `PickType`, `OmitType`, `PartialType`, `IntersectionType` из `@aom-js/schemer`; `Schemer`, `AomSchemas`, `ComponentSchema`, `PropertySchema`.

- [ ] **Step 1: Написать тесты mapped-types**

`packages/schemer/test/mapped-types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ComponentSchema,
  PropertySchema,
  Schemer,
  AomSchemas,
  PickType,
  OmitType,
  PartialType,
  IntersectionType,
} from "@aom-js/schemer";

const schemer = new Schemer("#/components/schemas/");

@ComponentSchema()
class SourceDto {
  @PropertySchema.String({})
  id!: string;

  @PropertySchema.String({})
  name!: string;

  @PropertySchema.Number({ isOptional: true })
  age?: number;
}

describe("schemer: mapped-types", () => {
  it("PickType оставляет только выбранные свойства", () => {
    const Picked = PickType(SourceDto, ["name"]);
    const schema = schemer.render(Picked);
    expect(Object.keys(schema.properties ?? {})).toEqual(["name"]);
  });

  it("OmitType убирает указанные свойства", () => {
    const Omitted = OmitType(SourceDto, ["id"]);
    const schema = schemer.render(Omitted);
    const keys = Object.keys(schema.properties ?? {});
    expect(keys).toEqual(expect.arrayContaining(["name", "age"]));
    expect(keys).not.toContain("id");
  });

  it("PartialType делает все свойства необязательными", () => {
    const Part = PartialType(SourceDto);
    const schema = schemer.render(Part);
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["id", "name", "age"]),
    );
    expect(schema.required ?? []).toEqual([]);
  });

  it("IntersectionType объединяет свойства двух схем", () => {
    @ComponentSchema()
    class ExtraDto {
      @PropertySchema.Boolean({})
      flag!: boolean;
    }
    const Combined = IntersectionType(SourceDto, ExtraDto);
    const schema = schemer.render(Combined);
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["id", "name", "age", "flag"]),
    );
  });

  it("производный класс сам зарегистрирован как компонентная схема", () => {
    const Picked = PickType(SourceDto, ["name"]);
    expect(AomSchemas.checkExists(Picked)?.isComponentSchema).toBe(true);
  });

  it("PickType от не-компонента — ошибка", () => {
    class Plain {}
    expect(() => PickType(Plain as any, [] as any)).toThrow(/not ComponentSchema/);
  });
});
```

- [ ] **Step 2: Запустить**

Run: `yarn test packages/schemer/test/mapped-types.test.ts`
Expected: PASS. Если `PartialType` не очищает `required` — политика находок.

- [ ] **Step 3: Commit**

```bash
git add packages/schemer/test/mapped-types.test.ts
git commit -m "test(schemer): mapped-types — Pick/Omit/Partial/Intersection"
```

---

### Task 7: router (api) — построение маршрутов

**Files:**
- Test: `packages/api/test/router-build.test.ts`

**Interfaces:**
- Consumes: `Controller`, `Get`, `Post`, `Delete`, `Bridge`, `Middleware`, `Nextpoint`, `Router`, `OpenApi` из `@aom-js/api`.
- Produces: хелпер `makeDocs()` (пустой OpenApi для конструктора Router) — используется в Task 8, 9.

- [ ] **Step 1: Написать тесты построения**

`packages/api/test/router-build.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Controller, Get, Post, Delete, Bridge, Middleware, Router, OpenApi } from "@aom-js/api";

const makeDocs = () => new OpenApi({ openapi: "3.1.0", info: { title: "t", version: "1" } });

describe("router: построение маршрутов", () => {
  it("эндпоинты контроллера превращаются в маршруты с методом и путём", () => {
    @Controller()
    class App {
      @Get("/hello")
      static async hello() {}

      @Post("/items")
      static async create() {}

      @Delete("/items/remove")
      static async remove() {}
    }
    const router = new Router(App, makeDocs());
    const table = router.routes.map((r) => `${r.method} ${r.path}`);
    expect(table).toEqual(
      expect.arrayContaining(["get /hello", "post /items", "delete /items/remove"]),
    );
    expect(table).toHaveLength(3);
  });

  it("Bridge монтирует вложенный контроллер под префиксом, включая вложенность в два уровня", () => {
    @Controller()
    class Leaf {
      @Get("/item")
      static async item() {}
    }

    @Controller()
    @Bridge("/leaf", Leaf)
    class Mid {
      @Get()
      static async index() {}
    }

    @Controller()
    @Bridge("/mid", Mid)
    class Root {
      @Get()
      static async home() {}
    }

    const router = new Router(Root, makeDocs());
    const table = router.routes.map((r) => `${r.method} ${r.path}`);
    expect(table).toEqual(
      expect.arrayContaining(["get /", "get /mid", "get /mid/leaf/item"]),
    );
  });

  it("наследник контроллера получает маршруты родителя", () => {
    @Controller()
    class BaseApi {
      @Get("/base")
      static async base() {}
    }

    @Controller()
    class ChildApi extends BaseApi {
      @Get("/own")
      static async own() {}
    }

    const router = new Router(ChildApi, makeDocs());
    const table = router.routes.map((r) => `${r.method} ${r.path}`);
    expect(table).toEqual(expect.arrayContaining(["get /base", "get /own"]));
  });

  it("конфликтующие роли метода — ошибка определения", () => {
    expect(() => {
      class Bad {
        @Middleware()
        @Get()
        static async both() {}
      }
      void Bad;
    }).toThrow("MIDDLEWARE_DEFINE_ERROR");
  });

  it("Endpoint поверх Middleware — ошибка определения", () => {
    expect(() => {
      class Bad {
        @Get()
        @Middleware()
        static async both() {}
      }
      void Bad;
    }).toThrow("ENDPOINT_DEFINE_ERROR");
  });
});
```

- [ ] **Step 2: Запустить**

Run: `yarn test packages/api/test/router-build.test.ts`
Expected: PASS. ВАЖНО: `@Controller()` всегда верхний декоратор класса (он INSTANT и разбирает очередь LAST-декораторов вроде `@Bridge`/`@Before`, накопленную нижними) — если тест с иным порядком падает, это не дефект, это инвариант порядка; зафиксировать его комментарием.

- [ ] **Step 3: Commit**

```bash
git add packages/api/test/router-build.test.ts
git commit -m "test(router): построение маршрутов — эндпоинты, бриджи, наследование, гарды ролей"
```

---

### Task 8: router (api) — исполнение запроса

**Files:**
- Test: `packages/api/test/router-exec.test.ts`

**Interfaces:**
- Consumes: всё из Task 7 плюс `Before`, `Query`, `Body`, `Params`, `Headers`, `Err`, `This`, `State`, `OnInstance`; тип `HttpContextValues` из `@aom-js/api`.
- Produces: хелперы `makeContext(partial)` и `call(router, method, path, ctx)` — переиспользуются в Task 13.

- [ ] **Step 1: Написать тесты исполнения**

`packages/api/test/router-exec.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  Controller, Get, Middleware, Before, Router, OpenApi,
  Query, Body, Err, This, OnInstance, HttpContextValues,
} from "@aom-js/api";

const makeDocs = () => new OpenApi({ openapi: "3.1.0", info: { title: "t", version: "1" } });

const makeContext = (partial: Partial<HttpContextValues> = {}): HttpContextValues => ({
  ctx: {}, req: {}, res: {}, body: {}, files: {}, query: {},
  params: {}, cookies: {}, headers: {}, session: {},
  ...partial,
});

async function call(router: Router, method: string, path: string, ctx: HttpContextValues) {
  const route = router.routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`route not found: ${method} ${path}`);
  return route.apply(ctx);
}

describe("router: исполнение запроса", () => {
  it("миддлвари выполняются до эндпоинта; undefined продолжает цепочку; результат эндпоинта — ответ", async () => {
    const calls: string[] = [];

    class Guard {
      @Middleware()
      static async check() {
        calls.push("guard"); // возвращает undefined — цепочка продолжается
      }
    }

    @Controller()
    @Before(Guard.check)
    class App {
      @Get("/hello")
      static async hello(@Query("name") name: string) {
        calls.push("endpoint");
        return `hi ${name}`;
      }
    }

    const router = new Router(App, makeDocs());
    const result = await call(router, "get", "/hello", makeContext({ query: { name: "aom" } }));
    expect(result).toBe("hi aom");
    expect(calls).toEqual(["guard", "endpoint"]);
  });

  it("миддлварь, вернувшая значение, перехватывает ответ — эндпоинт не вызывается", async () => {
    const calls: string[] = [];

    class Blocker {
      @Middleware()
      static async block() {
        return { denied: true };
      }
    }

    @Controller()
    @Before(Blocker.block)
    class App {
      @Get("/secure")
      static async secure() {
        calls.push("endpoint");
        return "secret";
      }
    }

    const router = new Router(App, makeDocs());
    const result = await call(router, "get", "/secure", makeContext());
    expect(result).toEqual({ denied: true });
    expect(calls).toEqual([]);
  });

  it("возврат экземпляра Error приводит к reject", async () => {
    @Controller()
    class App {
      @Get("/fail")
      static async fail(@Err() err: (message: string, status?: number) => Error) {
        return err("boom", 418);
      }
    }
    const router = new Router(App, makeDocs());
    await expect(call(router, "get", "/fail", makeContext())).rejects.toMatchObject({
      message: "boom",
      status: 418,
    });
  });

  it("выброшенное исключение приводит к reject", async () => {
    @Controller()
    class App {
      @Get("/throw")
      static async explode() {
        throw new Error("crashed");
      }
    }
    const router = new Router(App, makeDocs());
    await expect(call(router, "get", "/throw", makeContext())).rejects.toThrow("crashed");
  });

  it("Body и Query извлекают значения по ключу и целиком", async () => {
    @Controller()
    class App {
      @Get("/echo")
      static async echo(@Body() body: unknown, @Query("q") q: string) {
        return { body, q };
      }
    }
    const router = new Router(App, makeDocs());
    const result = await call(
      router, "get", "/echo",
      makeContext({ body: { a: 1 }, query: { q: "x" } }),
    );
    expect(result).toEqual({ body: { a: 1 }, q: "x" });
  });

  it("This создает инстанс с аргументами конструктора и хуком OnInstance, кеширует в state запроса", async () => {
    const hookLog: string[] = [];

    class Session {
      who: string;
      constructor(@Query("user") user: string) {
        this.who = user;
      }

      @OnInstance()
      static async init(@This() self: Session) {
        hookLog.push(`init:${self.who}`);
      }
    }

    @Controller()
    class App {
      @Get("/me")
      static async me(@This(Session) a: Session, @This(Session) b: Session) {
        return { who: a.who, same: a === b };
      }
    }

    const router = new Router(App, makeDocs());
    const first = await call(router, "get", "/me", makeContext({ query: { user: "alice" } }));
    expect(first).toEqual({ who: "alice", same: true }); // один инстанс на запрос
    expect(hookLog).toEqual(["init:alice"]); // хук вызван однократно

    const second = await call(router, "get", "/me", makeContext({ query: { user: "bob" } }));
    expect(second).toEqual({ who: "bob", same: true }); // новый запрос — новый инстанс
  });
});
```

- [ ] **Step 2: Запустить**

Run: `yarn test packages/api/test/router-exec.test.ts`
Expected: PASS (при расхождении — политика находок).

- [ ] **Step 3: Commit**

```bash
git add packages/api/test/router-exec.test.ts
git commit -m "test(router): исполнение — протокол undefined, перехват, ошибки, аргументы, This/OnInstance"
```

---

### Task 9: api — генерация OpenAPI

**Files:**
- Test: `packages/api/test/openapi.test.ts`

**Interfaces:**
- Consumes: `Controller`, `Get`, `Post`, `Router`, `OpenApi`, `Title`, `Description`, `Responses`, `RequestBody`, `PathParameters`, `Security`, `Params`, `Body` из `@aom-js/api`; `ComponentSchema`, `PropertySchema` из `@aom-js/schemer`.

- [ ] **Step 1: Написать тесты генерации**

`packages/api/test/openapi.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  Controller, Get, Post, Router, OpenApi,
  Title, Description, Responses, RequestBody, PathParameters, Security,
  Params, Body,
} from "@aom-js/api";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";

@ComponentSchema()
class ItemDto {
  @PropertySchema.String({})
  title!: string;
}

describe("api: генерация OpenAPI", () => {
  const build = () => {
    @Controller()
    class Shop {
      @Get("/items")
      @Title("Список")
      @Description("Все позиции")
      @Responses({ status: 200, schema: ItemDto, description: "ok", isArray: true })
      static async list() {
        return [];
      }

      @Post("/items")
      @RequestBody({ schema: ItemDto })
      @Responses({ status: 201, schema: ItemDto, description: "created" })
      @Security({ type: "http", scheme: "bearer" })
      static async create(@Body() body: unknown) {
        return body;
      }

      @Get("/item/item_id")
      @PathParameters({ item_id: { name: "id", schema: { type: "string" } } })
      static async one(@Params("id") id: string) {
        return { id };
      }
    }

    const docs = new OpenApi({ openapi: "3.1.0", info: { title: "t", version: "1" } });
    new Router(Shop, docs);
    return docs.toJSON();
  };

  it("операции получают operationId, summary и description", () => {
    const json = build();
    expect(json.paths["/items"].get).toMatchObject({
      operationId: "Shop_list",
      summary: "Список",
      description: "Все позиции",
    });
  });

  it("Responses с компонентной схемой дают $ref и массивную обертку", () => {
    const json = build();
    const schema = json.paths["/items"].get.responses["200"].content["application/json"].schema;
    expect(schema).toEqual({ type: "array", items: { $ref: "#/components/schemas/ItemDto" } });
  });

  it("компонент попадает в components.schemas один раз", () => {
    const json = build();
    expect(json.components.schemas.ItemDto).toMatchObject({
      properties: { title: { type: "string" } },
    });
  });

  it("RequestBody рендерится с $ref", () => {
    const json = build();
    expect(json.paths["/items"].post.requestBody.content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/ItemDto",
    });
  });

  it("PathParameters заменяют сегмент пути на {name} и добавляют параметр", () => {
    const json = build();
    const operation = json.paths["/item/{id}"].get;
    expect(operation).toBeDefined();
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", in: "path", required: true }),
      ]),
    );
  });

  it("Security регистрирует схему безопасности и привязывает её к операции", () => {
    const json = build();
    expect(json.paths["/items"].post.security).toEqual([{ Shop: [] }]);
    expect(json.components.securitySchemes.Shop).toMatchObject({ scheme: "bearer" });
  });
});
```

- [ ] **Step 2: Запустить**

Run: `yarn test packages/api/test/openapi.test.ts`
Expected: PASS (при расхождении — политика находок; структуру фактического JSON смотреть через `console.log(JSON.stringify(json, null, 2))` временно).

- [ ] **Step 3: Commit**

```bash
git add packages/api/test/openapi.test.ts
git commit -m "test(api): генерация OpenAPI — операции, $ref-компоненты, path-параметры, security"
```

---

### Task 10: transfer — RPC поверх in-memory шины

**Files:**
- Create: `packages/transfer/test/memory-bus.ts`
- Test: `packages/transfer/test/rpc.test.ts`

**Interfaces:**
- Consumes: `Transfer`, `Isolator`, `ResponseTopic`, `CustomTopic`, `Executor` из `@aom-js/transfer`.
- Produces: класс `MemoryBus` (`publisher`, `subscriber`, лог `published: Array<{topic: string; message: any}>`) — используется в Task 11.

- [ ] **Step 1: Создать in-memory шину**

`packages/transfer/test/memory-bus.ts`:

```ts
// Фейковая шина: доставка асинхронная (макротаск), как у реальных брокеров.
type BusMessage = { topic: string; message: any };
type BusSubscription = { topic: string; next: (message: any) => void; queue?: boolean };

export class MemoryBus {
  readonly published: BusMessage[] = [];

  private subs: BusSubscription[] = [];

  subscriber = (sub: BusSubscription) => {
    this.subs.push(sub);
  };

  publisher = ({ topic, message }: BusMessage) => {
    this.published.push({ topic, message });
    setTimeout(() => {
      this.subs.filter((s) => s.topic === topic).forEach((s) => s.next(message));
    });
  };

  topicCount(topic: string) {
    return this.published.filter((p) => p.topic === topic).length;
  }
}

export const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
```

- [ ] **Step 2: Написать тесты RPC**

`packages/transfer/test/rpc.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Transfer, Isolator, ResponseTopic, CustomTopic, Executor } from "@aom-js/transfer";
import { MemoryBus, tick } from "./memory-bus";

const bus = new MemoryBus();
const node = new Transfer({
  instanceName: "test-node",
  instanceKey: "k1",
  publisher: bus.publisher,
  subscriber: bus.subscriber,
});

const fired: string[] = [];

@Isolator(node)
class MathService {
  @ResponseTopic()
  static async sum(a: number, b: number): Promise<number> {
    return undefined as never; // тело изолятора не выполняется — интерфейс
  }

  @ResponseTopic()
  static async boom(): Promise<void> {
    return undefined as never;
  }

  @ResponseTopic(true)
  static async slow(x: number): Promise<number> {
    return undefined as never;
  }

  @CustomTopic()
  static async fire(msg: string): Promise<unknown> {
    return undefined;
  }
}

@Executor()
class MathExecutor extends MathService {
  static async sum(a: number, b: number) {
    return a + b;
  }

  static async boom(): Promise<void> {
    throw new Error("executor failed");
  }

  static async slow(x: number) {
    await tick(20);
    return x * 2;
  }

  static async fire(msg: string) {
    fired.push(msg);
  }
}

describe("transfer: RPC поверх шины", () => {
  it("вызов изолированного метода публикует сообщение и возвращает результат исполнителя", async () => {
    await expect(MathService.sum(2, 3)).resolves.toBe(5);
    expect(bus.topicCount("MathService.sum")).toBe(1);
    // ответ ушел в reply-топик с ключами инстанса
    expect(
      bus.published.some((p) => p.topic === "reply_MathService.sum_k1_test-node"),
    ).toBe(true);
  });

  it("ошибка исполнителя доставляется вызывающему как reject", async () => {
    await expect(MathService.boom()).rejects.toThrow("executor failed");
  });

  it("синглтон дедуплицирует параллельные вызовы с одинаковыми аргументами", async () => {
    const before = bus.topicCount("MathService.slow");
    const [r1, r2] = await Promise.all([MathService.slow(4), MathService.slow(4)]);
    expect(r1).toBe(8);
    expect(r2).toBe(8);
    expect(bus.topicCount("MathService.slow") - before).toBe(1); // одна публикация
  });

  it("синглтон с разными аргументами публикует отдельно", async () => {
    const before = bus.topicCount("MathService.slow");
    await Promise.all([MathService.slow(1), MathService.slow(2)]);
    expect(bus.topicCount("MathService.slow") - before).toBe(2);
  });

  it("CustomTopic не ждёт ответа, но исполнитель получает сообщение", async () => {
    await MathService.fire("hello");
    await tick(10);
    expect(fired).toContain("hello");
  });
});
```

- [ ] **Step 3: Запустить**

Run: `yarn test packages/transfer/test/rpc.test.ts`
Expected: PASS, кроме известного дефекта: `execHandler` шлёт `result || {}` — falsy-результаты (`0`, `false`, `""`, `null`) превращаются в `{}`. Если тест на такой случай будет добавлен — только как `it.fails` + строка в findings. В базовых тестах выше falsy-результатов нет.

- [ ] **Step 4: Commit**

```bash
git add packages/transfer/test/memory-bus.ts packages/transfer/test/rpc.test.ts
git commit -m "test(transfer): RPC-роундтрип, ошибки, синглтон-дедупликация, CustomTopic"
```

---

### Task 11: transfer — адресация инстансов и реестр распределений

**Files:**
- Test: `packages/transfer/test/distribution.test.ts`

**Interfaces:**
- Consumes: `Transfer`, `Isolator`, `ResponseTopic`, `Executor`, `IsDistributed` из `@aom-js/transfer`; `MemoryBus`, `tick` из `./memory-bus` (Task 10).

- [ ] **Step 1: Написать тесты адресации и реестра**

`packages/transfer/test/distribution.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Transfer, Isolator, ResponseTopic, Executor, IsDistributed } from "@aom-js/transfer";
import { MemoryBus, tick } from "./memory-bus";

const bus = new MemoryBus();
const nodeA = new Transfer({
  instanceName: "node-a",
  instanceKey: "a1",
  publisher: bus.publisher,
  subscriber: bus.subscriber,
});
const nodeB = new Transfer({
  instanceName: "node-b",
  instanceKey: "b1",
  publisher: bus.publisher,
  subscriber: bus.subscriber,
});

describe("transfer: адресация конкретного инстанса", () => {
  @Isolator(nodeA)
  class Worker {
    @ResponseTopic()
    static async whoami(): Promise<string> {
      return undefined as never;
    }
  }

  @Executor("w1")
  class WorkerOne extends Worker {
    static async whoami() {
      return "w1";
    }
  }

  it("toInstance направляет вызов в топик с суффиксом инстанса", async () => {
    const result = await Transfer.toInstance(Worker, "w1").whoami();
    expect(result).toBe("w1");
    expect(bus.topicCount("Worker.whoami_w1")).toBe(1);
    expect(bus.topicCount("Worker.whoami")).toBe(0); // безадресный топик не использовался
  });
});

describe("transfer: реестр распределенных схем", () => {
  @Isolator(nodeA)
  @IsDistributed()
  class DistService {
    @ResponseTopic()
    static async ping(): Promise<string> {
      return undefined as never;
    }
  }

  it("IsDistributed регистрирует класс в registryMap своего транспорта", () => {
    expect(nodeA.registryMap.get(DistService)).toBe("DistService");
  });

  it("collectDistributions опрашивает другие ноды и получает их схемы", async () => {
    const received: any[] = [];
    nodeB.collectDistributions((data) => received.push(data));
    await tick(10);
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].instance).toMatchObject({
      instanceName: "node-a",
      instanceKey: "a1",
    });
  });

  it("нода не отвечает сама себе на запрос реестра", async () => {
    const received: any[] = [];
    nodeA.collectDistributions((data) => received.push(data));
    await tick(10);
    // ответ мог прийти только от nodeB (у которой реестр пуст) — но не от самой nodeA
    expect(received.every((r) => r.instance.instanceName !== "node-a")).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить**

Run: `yarn test packages/transfer/test/distribution.test.ts`
Expected: PASS. Известное состояние: значение схемы в реестре — просто имя класса, а `registryMap.entries()` передается итератором (несериализуемо для реальной шины) — это незавершенная функциональность (план п.2 роадмапа), тесты фиксируют текущее поведение и будут расширяться вместе с ней.

- [ ] **Step 3: Commit**

```bash
git add packages/transfer/test/distribution.test.ts
git commit -m "test(transfer): адресация инстансов и реестр распределений"
```

---

### Task 12: holder — отложенное применение сторонних декораторов

**Files:**
- Test: `packages/holder/test/holder.test.ts`

**Interfaces:**
- Consumes: `Hold`, `Delay`, `Apply` из `@aom-js/holder`.

- [ ] **Step 1: Написать тесты holder**

`packages/holder/test/holder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Hold, Delay, Apply } from "@aom-js/holder";

describe("holder: отложенное применение декораторов при наследовании", () => {
  it("Hold на свойстве родителя + Apply на потомке применяет декоратор к потомку", () => {
    const applied: string[] = [];
    const Spy =
      (label: string): PropertyDecorator =>
      (target, property) => {
        applied.push(`${label}:${(target as any).constructor.name}.${String(property)}`);
      };

    class HeldBase {
      @Hold(Spy("a"))
      field!: string;
    }

    @Apply()
    class HeldChild extends HeldBase {}
    void HeldChild;

    expect(applied).toEqual(["a:HeldChild.field"]);
  });

  it("Apply применяет переданные ему декораторы класса к самому классу", () => {
    const applied: string[] = [];
    const ClassSpy =
      (label: string): ClassDecorator =>
      (target) => {
        applied.push(`${label}:${target.name}`);
      };

    @Apply(ClassSpy("cls"))
    class Applied {}
    void Applied;

    expect(applied).toEqual(["cls:Applied"]);
  });

  it("Delay на родителе + Apply на потомке переносит класс-декораторы родителя", () => {
    // ВНИМАНИЕ: вероятная находка. Delay работает в фазе INSTANT, которая не
    // сохраняется в callstack, поэтому очередь класс-декораторов родителя может
    // не переноситься при наследовании. Если тест падает — пометить it.fails
    // и записать в findings (holder — черновик 0.0.1).
    const applied: string[] = [];
    const ClassSpy =
      (label: string): ClassDecorator =>
      (target) => {
        applied.push(`${label}:${target.name}`);
      };

    @Delay(ClassSpy("cls"))
    class DelayedBase {}

    @Apply()
    class DelayedChild extends DelayedBase {}
    void DelayedChild;

    expect(applied).toEqual(["cls:DelayedChild"]);
  });

  it("несколько Hold-декораторов применяются в сохраненном порядке", () => {
    const applied: string[] = [];
    const Spy =
      (label: string): PropertyDecorator =>
      () => {
        applied.push(label);
      };

    class MultiBase {
      @Hold(Spy("first"), Spy("second"))
      field!: string;
    }

    @Apply()
    class MultiChild extends MultiBase {}
    void MultiChild;

    expect(applied).toEqual(expect.arrayContaining(["first", "second"]));
  });
});
```

- [ ] **Step 2: Запустить**

Run: `yarn test packages/holder/test/holder.test.ts`
Expected: PASS (holder — версии 0.0.1, вероятность находок высокая; политика находок).

- [ ] **Step 3: Commit**

```bash
git add packages/holder/test/holder.test.ts
git commit -m "test(holder): Hold/Delay/Apply — отложенное применение при наследовании"
```

---

### Task 13: интеграционный сквозной тест

**Files:**
- Test: `packages/api/test/integration.test.ts`

**Interfaces:**
- Consumes: всё из Task 4, 8, 9 — контроллер + компонентная схема + валидация тела + OpenAPI из одного набора метаданных.

- [ ] **Step 1: Написать сквозной тест**

`packages/api/test/integration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  Controller, Post, Router, OpenApi,
  Body, Err, RequestBody, Responses, HttpContextValues,
} from "@aom-js/api";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";

@ComponentSchema({ description: "Заказ" })
class OrderDto {
  @PropertySchema.String({ minLength: 3 })
  product!: string;

  @PropertySchema.Number({ minValue: 1 })
  qty!: number;
}

@Controller()
class OrdersApi {
  @Post("/orders")
  @RequestBody({ schema: OrderDto })
  @Responses({ status: 201, schema: OrderDto, description: "created" })
  static async create(
    @Body() body: unknown,
    @Err() err: (message: string, status?: number) => Error,
  ) {
    const order = plainToInstance(OrderDto, body);
    const errors = validateSync(order);
    if (errors.length) return err("validation failed", 400);
    return order;
  }
}

const makeContext = (body: unknown): HttpContextValues => ({
  ctx: {}, req: {}, res: {}, body, files: {}, query: {},
  params: {}, cookies: {}, headers: {}, session: {},
});

describe("интеграция: контроллер + схема + валидация + OpenAPI из одних метаданных", () => {
  const docs = new OpenApi({ openapi: "3.1.0", info: { title: "orders", version: "1" } });
  const router = new Router(OrdersApi, docs);
  const route = router.routes.find((r) => r.method === "post" && r.path === "/orders")!;

  it("валидное тело: трансформация и ответ", async () => {
    const result = await route.apply(makeContext({ product: "book", qty: "2" }));
    expect(result).toBeInstanceOf(OrderDto);
    expect(result.qty).toBe(2); // строка приведена к числу той же схемой
  });

  it("невалидное тело: reject со статусом 400", async () => {
    await expect(route.apply(makeContext({ product: "x" }))).rejects.toMatchObject({
      message: "validation failed",
      status: 400,
    });
  });

  it("та же схема отражена в OpenAPI как $ref-компонент", () => {
    const json = docs.toJSON();
    expect(json.paths["/orders"].post.requestBody.content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/OrderDto",
    });
    expect(json.components.schemas.OrderDto).toMatchObject({
      description: "Заказ",
      properties: { product: { type: "string", minLength: 3 } },
    });
  });
});
```

- [ ] **Step 2: Запустить весь набор и снять покрытие**

Run: `yarn test:coverage`
Expected: все файлы PASS (кроме помеченных `it.fails`); в сводке покрытия `packages/core/src` ≥ 80% строк, остальные пакеты ≥ 60%. Если сильно ниже — посмотреть незатронутые файлы в отчёте и решить: мёртвый код (запись в findings) или пробел в плане (добавить тест в соответствующий файл задачи).

- [ ] **Step 3: Commit**

```bash
git add packages/api/test/integration.test.ts
git commit -m "test: интеграционный сквозной тест — контроллер, схема, валидация, OpenAPI"
```

---

## Что план сознательно НЕ покрывает (и почему)

- **WebSocketPoint, Marker/UseMarker, Nextpoint/Next/Run, DelayRefStack, теги OpenAPI (REPLACE/MERGE)** — второй эшелон: добавлять тесты в существующие файлы задач 7–9 по мере работы с этими механиками. Не блокирует страховочную сетку.
- **Реальные HTTP-адаптеры (koa/express)** — появятся вместе с новым пакетом `@aom-js/api` (батарейки); тестировать их сейчас не на чем.
- **Кросс-процессный transfer** — требует реальной шины; in-memory шина покрывает протокол, не транспорт.
- **CI-workflow** — отдельная задача после стабилизации `yarn test`.
