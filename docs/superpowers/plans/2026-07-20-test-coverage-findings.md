# Находки при покрытии тестами (2026-07-20)

Дефекты, обнаруженные характеризационными тестами. Тесты помечены `it.fails`.

| # | Пакет | Описание | Тест |
|---|-------|----------|------|
| 1 | schemer | Нулевые ограничения игнорируются: truthy-проверки `params.minValue ? Min(...) : undefined` (аналогично maxValue/minLength/maxLength) в `src/defines/properties.ts` — `minValue: 0` не даёт `minimum: 0` в схеме и не вешает валидатор `Min(0)` | `render.test.ts` › «minValue: 0 должен попадать в схему…» |
| 2 | router | Гонка в `@This`: аргументы метода решаются конкурентно (`Promise.all` в `common/classes.ts`), а `This`-хендлер (`decorators/arguments`) делает async check-then-create по `context.state` без дедупликации — два `@This(X)` в одном методе создают два инстанса X (и дважды гоняют OnInstance-хуки) | `router-exec.test.ts` › «два @This одного класса…» |
| 3 | holder | Класс-декораторы из `@Delay` родителя не переносятся на потомка при `@Apply`: `Delay` регистрируется в фазе INSTANT, которая не сохраняется в callstack и потому не участвует в `inherit`/`transferTo` — очередь `$.queue` родителя остаётся неисполненной | `holder.test.ts` › «Delay на родителе + Apply на потомке…» |
