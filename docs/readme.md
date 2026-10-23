# Документация ядра `@aom-js`

Как читать: сначала архитектура, затем пакеты в порядке зависимостей (`core` → `schemer` → `router` → `api`), рецепты — по мере надобности.

## Ядро целиком

- [`architecture.md`](architecture.md) — пакеты и их зависимости, модель метаданных, как router строит и исполняет маршруты, сборка, как приложение потребляет ядро, как менять ядро.
- [`testing.md`](testing.md) — тестирование приложения на ядре: что ядро выгружает о цепочках маршрутов, общие правила цепочки, дамп.
- [`publishing.md`](publishing.md) — выпуск в npm: одна версия на все пакеты, какую цифру поднимать, `bun run release`.

## Пакеты

- [`core`](../packages/core/readme.md) — реестр мета-инстансов, фазы, наследование, `resolveFor`.
- [`schemer`](../packages/schemer/readme.md) — `@ComponentSchema`, `PropertySchema.*`, mapped-types, рендер и свёртка схем.
- [`router`](../packages/router/readme.md) — контроллеры, курсоры, `@This`/`@OnInstance`, ссылки, маркеры, OpenAPI.
- [`api`](../packages/api/readme.md) — `Server`, билдеры, доступ, авторизация, ответы, `I18nizer`, SSE и WebSocket.
- [`transfer`](../packages/transfer/readme.md) — изоляторы, исполнители, RPC, дескрипторы и реестр.
- [`codegen`](../packages/codegen/readme.md) — генерация классов из дескриптора, CLI, граница безопасности.
- [`holder`](../packages/holder/readme.md) — `Hold`/`Delay`/`Apply`.
- [`visualizer`](../packages/visualizer/readme.md) — граф API и его страница.

## Рецепты

- [`cookbook/`](cookbook/readme.md) — как писать прикладной код: `@This` и жизненный цикл объектов, ленивое тело запроса и лимиты, изоляторы.
