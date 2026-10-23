# aom-js

`aom-js` — набор пакетов `@aom-js/*` для серверных приложений на TypeScript. Приложение пишется классами со статическими методами, а декораторы над ними описывают всё остальное: маршруты API, проверки перед обработчиком, схемы данных, документ OpenAPI и вызовы других сервисов через шину сообщений.

Документация: https://aom-js.github.io/docs/ (тексты — репозиторий [aom-js/docs](https://github.com/aom-js/docs)).

## Пакеты

- [`@aom-js/core`](https://aom-js.github.io/docs/packages/core/) — реестр мета-инстансов и фабрики декораторов с отложенным исполнением.
- [`@aom-js/schemer`](https://aom-js.github.io/docs/packages/schemer/) — класс как DTO, JSON Schema и валидатор; сборщик компонентов схем.
- [`@aom-js/router`](https://aom-js.github.io/docs/packages/router/) — карта HTTP/WS-маршрутов из классов-контроллеров и её исполнение, документ OpenAPI.
- [`@aom-js/api`](https://aom-js.github.io/docs/packages/api/) — HTTP-сервер на `node:http`, билдеры, базовые контроллеры, ответы, локализация.
- [`@aom-js/transfer`](https://aom-js.github.io/docs/packages/transfer/) — изоляторы и исполнители: RPC поверх абстрактной шины.
- [`@aom-js/codegen`](https://aom-js.github.io/docs/packages/codegen/) — генерация исходников aom-классов из дескриптора изолятора.
- [`@aom-js/holder`](https://aom-js.github.io/docs/packages/holder/) — отложенное применение сторонних декораторов на конечном потомке.
- [`@aom-js/visualizer`](https://aom-js.github.io/docs/packages/visualizer/) — граф API по дереву контроллеров в виде HTML-страницы.
