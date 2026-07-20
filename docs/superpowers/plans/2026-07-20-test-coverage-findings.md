# Находки при покрытии тестами (2026-07-20)

Дефекты, обнаруженные характеризационными тестами. Тесты помечены `it.fails`.

| # | Пакет | Описание | Тест |
|---|-------|----------|------|
| 1 | schemer | Нулевые ограничения игнорируются: truthy-проверки `params.minValue ? Min(...) : undefined` (аналогично maxValue/minLength/maxLength) в `src/defines/properties.ts` — `minValue: 0` не даёт `minimum: 0` в схеме и не вешает валидатор `Min(0)` | `render.test.ts` › «minValue: 0 должен попадать в схему…» |
