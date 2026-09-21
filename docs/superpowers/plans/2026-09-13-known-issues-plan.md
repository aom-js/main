# План решений по известным дефектам ядра (`main/packages`)

Источник — реестр `test/docs/known-issues.md` (ID вида `KI-<ОБЛАСТЬ>-<NN>`). Правило реестра сохраняется: исправление = тест (переворот `it.fails` или новый) + обновление записи + проверка документов, ссылающихся на ID. Решения автора от 2026-09-13 внесены.

## 1. Сделано

Реестр — `test/docs/known-issues.md`; там же код/тесты каждого ID. Ниже — коротко по пакетам, что закрыто и что добавлено новыми записями (разделы 2–6 этого документа — исходные решения, не переписывались).

- **core.** Закрыты `KI-CORE-01, 02, 06` (остаток), `07, 09, 10`. Переформулированы как особенности (поведение не менялось, уточнено описание) — `KI-CORE-03, 04, 05, 08`.
- **holder.** Закрыты `KI-HOLDER-01, 02`.
- **router.** Закрыты `KI-ROUTER-01, 03, 04, 06` (частично, путь), `07` (частично, merge), `11, 12`. Новые закрытые находки того же аудита — `KI-ROUTER-14, 15`. Новые открытые (вопрос автору) — `KI-ROUTER-16, 17, 18`. Особенности переформулированы — `KI-ROUTER-02, 05, 08, 09, 10`.
- **transfer.** Закрыты `KI-TRANSFER-01, 03, 04, 05, 07`. Новые закрытые — `KI-TRANSFER-08, 09, 10`. Новая открытая — `KI-TRANSFER-11`. Особенности — `KI-TRANSFER-02, 06`.
- **schemer.** Закрыты `KI-SCHEMER-01…06, 09` (остаток). `KI-SCHEMER-08` — словарь `SCALAR_TYPE_SCHEMAS.date` закрыт, обратное распознавание в codegen перенесено в волну codegen (см. подраздел ниже). Новая закрытая — `KI-SCHEMER-10`. Особенность — `KI-SCHEMER-07`.
- **api.** Закрыты `KI-API-02` (частично, content-type), `03, 04, 05, 06, 08, 11, 12, 13`. Решения автора — `KI-API-01` (не дефект), `KI-API-09` (легаси, оставить), `KI-API-10` (особенность целиком). Новые закрытые (аудит безопасности) — `KI-API-14, 15`. Новые открытые (вопрос автору) — `KI-API-16, 17`. Новые открытые (попутно) — `KI-API-18, 19`. Было 0 тестов пакета — стало `packages/api/test/{server,units}.test.ts`, 53 теста.
- **codegen.** Не тронут в этой волне — идёт отдельный, последний раунд аудита (часть 4b).

Проверка: `bun run test` (23 файла, 274 теста) — зелено, `it.fails` не осталось нигде (`grep -rn "it\.fails" main/packages/*/test/*.ts` — пусто).

### Волна 2026-09-21 — ответы автора на открытые вопросы

Реестр и код обновлены; ниже — только то, что изменилось относительно волны выше (разделы 1–8 ниже её не переписывают).

- **api.** Закрыты `KI-API-16` (тело запроса — `lazy(...)`, разбор не раньше первого `@Body`, лимит `DEFAULT_BODY_LIMIT` = 1 МиБ, `@BodyOptions({ limit })` на маршруте перекрывает `AomServerSettings.bodyLimit`, `0` = без ограничения, превышение — 413, `Connection: close` при отказе по ходу чтения) и `KI-API-17` (строка от обработчика по умолчанию — `text/plain; charset=utf-8`, а не `text/html`; для HTML обработчик выставляет `Content-Type` сам). Тесты: `packages/api/test/units.test.ts` (+7, `parseJsonBody`), `packages/api/test/body-options.test.ts` (новый, 4), `packages/api/test/server.test.ts` (+9 лимиты/keep-alive/порядок с доступом, +3 `text/plain`), `packages/router/test/lazy-values.test.ts` (новый, 5).
- **router.** Закрыт `KI-ROUTER-16` (двухстадийная публикация инстанса `context.inflight` → `context.state`; чужой код, ожидающий класс, чьё создание уже идёт, либо дожидается его, либо получает `CIRCULAR_INSTANCE_ERROR` через граф встречных ожиданий `RxContext.waits`). `KI-ROUTER-17` закрыт **частично**: утечка непроверенного инстанса чужому коду снята тем же изменением, что и `KI-ROUTER-16`; дизайн-вопрос «отменять ли соседние хуки `@OnInstance` одного класса при отказе одного» остаётся открытым — решение автора: последовательный запуск сознательно отложен (см. «Вопросы автору» ниже). `KI-ROUTER-18` переквалифицирован риск → особенность (решение автора: `@Controller()` — триггер запуска хуков, наследник обязан сам его нести). Добавлена и сразу задокументирована как долг `KI-ROUTER-19` (граф `waits` держит одно ребро на ожидающую ветку). Тест: `packages/router/test/router-instance-safety.test.ts` (новый, 10).
- **transfer.** Добавлен и сразу закрыт `KI-TRANSFER-13` (`@TopicTimeout(ms)` — декоратор метода перекрывает `responseTimeout` транспорта, `0` = без ограничения; таймер ответа `unref()`-нут — не держит процесс живым). `KI-TRANSFER-11` не исправлен в ядре, но получил обход в приложении (NATS-адаптер проверяет `err` и оборачивает `next(...)` в try/catch — `test/src/config/aom/transfer.ts:18-36`). `KI-TRANSFER-12` — решение автора: защита шины остаётся долгом на будущее, не открытым вопросом текущей волны. Тесты: `packages/transfer/test/topic-timeout.test.ts` (новый, 7), `packages/transfer/test/errors.test.ts` (+1, `unref`).
- **codegen.** `KI-CODEGEN-05` (ReDoS в `$regexp`) — решение автора: фиксируется как долг вместе с `KI-TRANSFER-12`, issue `https://github.com/aom-js/main/issues/1`.

Проверка: `bunx vitest run packages/router packages/api packages/transfer` — 17 файлов, 189 тестов, зелено (2026-09-21).

### Решения координатора — автору на подтверждение

- **KI-ROUTER-07** — `OpenApi.toJSON` сливает `initData` со сгенерированным по полю, а не целиком: теги — по `name` (`packages/router/src/classes/openapi.ts:207-210`), пути — по методу внутри одного пути (`:211-215`), компоненты (`securitySchemes`, `schemas`) — по имени (`:216-228`).
- **KI-ROUTER-14** — отказ создания (конструктора или хука `@OnInstance`) запоминается в `context.pending` до конца запроса, а не сбрасывается сразу после отказа — `packages/router/src/common/classes.ts:202-207,215-220`.
- Замечание ревью core «перенести `inherited.add` в конец `inherit()`» не принято: пометка ставится в начале метода (`packages/core/src/defines/core.ts:284-287`), до рекурсивного переноса очередей и дескрипторов — так повторный вызов `inherit()` того же родителя из тела текущего вызова (реэнтерабельность) не проходит проверку `this.inherited.has(parent)` заново и не запускает перенос второй раз. Связано с `KI-CORE-07`.
- **KI-SCHEMER-08** перенесён в волну codegen: словарь `SCALAR_TYPE_SCHEMAS.date` в schemer уже приведён к форме `class-validator-jsonschema` и закрыт (`packages/schemer/src/defines/collector.ts:12-25`), но обратное распознавание этой формы в `codegen` (`inverseSchema`/`scalarNameOf`) пока не обновлено — правится вместе с остальным форматом свёртки в волне codegen (см. `KI-CODEGEN-01`).
- Решение автора «цикл конструктор ↔ хук зависает — оставить» (`KI-ROUTER-01`) распространено на зеркальный цикл: хук `@OnInstance` класса A запрашивает через `@This` класс B, а конструктор или хук класса B, в свою очередь, запрашивает класс A — запрос зависает так же, как и прямой цикл «свой конструктор ↔ свой хук». Такие зависания (обозначены координатором как P2/b, P2/c, P9/a) нашёл ревьюер конкурентности собственными пробами вне этого репозитория — в тестах пакета их нет, `grep` по `router-exec.test.ts` ничего не даёт. Связано с `KI-ROUTER-01`.
- **api:**
  - префикс пути из `settings.url` сохранён — `packages/api/src/server/http.ts:150-151`; тест `packages/api/test/server.test.ts:469-482`.
  - фрагмент `#` отбрасывается, как раньше — `http.ts:152-156`; тесты `server.test.ts:529-535,537-546`.
  - `ErrorMessage` со статусом 1xx заменяется на 500 — `http.ts:295-301`; тест `server.test.ts:573-578` (соседний тест `:580-583` подтверждает, что `SeeOtherResponse`(303) по-прежнему доходит как окончательный ответ).
  - Связано: `KI-API-03`, `KI-API-14`.
- **transfer:** у `Transfer` два новых публичных метода — `publish(args)` (`packages/transfer/src/defines/main.ts:160-162`) и `reportError(error)` (`:168-172`, сбой самого `defaultErrorHandler` не роняет процесс). Использует `RxTransfer` — `rx-transfer.ts:78-80` (`publish`, сбой — в поток ошибки запроса), `:114,247,250,263-264` (`reportError` для ошибок без адресата: подписка без ожидания ответа, ошибки протокола реестра). Связано: `KI-TRANSFER-08, 09, 10`.

### Вопросы автору (открытое)

Отвечено автором 2026-09-21 (снято из этого списка, детали — волна 2026-09-21 выше и `test/docs/known-issues.md`):

- `responseTimeout` общий для `@ResponseTopic`/`@CustomTopic` — отвечено механизмом `@TopicTimeout(ms)` (`KI-TRANSFER-13`): метод перекрывает таймаут транспорта точечно. В приложении `test/src/modules/files/isolators/files.ts` (`@ResponseTopic(true)`, конвертация) и `test/src/modules/tickets/isolators/tickets.ts` (`@CustomTopic(true)`) декоратор пока не применён — это уже не вопрос к ядру, а задача для приложения (поднять таймаут конкретным долгим методам через `@TopicTimeout`, не трогая дефолт остальных).
- `KI-TRANSFER-11` — механизм в ядре не менялся (дефект остаётся), но обход в приложении реализован: NATS-адаптер проверяет `err` колбэка и оборачивает `next(...)` в try/catch (`test/src/config/aom/transfer.ts:18-36`).
- `KI-API-16`, `KI-API-17` — закрыты кодом, см. волну выше.
- `KI-ROUTER-16` — закрыт кодом. `KI-ROUTER-18` — решение автора: особенность, не дефект.
- Таймер ответа без `unref()` — исправлено (`KI-TRANSFER-13`).
- Доверие к шине (`KI-TRANSFER-12`) и ReDoS в `$regexp` (`KI-CODEGEN-05`) — решение автора: оба фиксируются как долг на будущее, не как открытые вопросы текущей волны; отслеживаются issue `https://github.com/aom-js/main/issues/1`.

Остаётся открытым:

- `KI-ROUTER-17` (частично, только эта часть) — хуки `@OnInstance` одного и того же класса по-прежнему идут через `Promise.all`; при отказе одного хука стоит ли отменять/не запускать остальные, или независимость хуков — часть контракта? Решение автора: переход на последовательный запуск сознательно отложен — цена: суммарное время выполнения вместо максимума, плюс ловушка «хуки потомка регистрируются раньше унаследованного хука родителя» (собственные декораторы метода потомка отрабатывают до `@Controller()`, который запускает `inherit()` и добавляет хук родителя в `instanceHooks` последним).
- Кандидаты на шаблон «наследовать только прямого родителя»: `@This`/`@OnInstance` в router (`KI-ROUTER-18`, оставлено особенностью) и `Delay`/`Apply` в holder (`packages/holder/src/decorators.ts:20-29` — `AomHolder.checkExists(parent)` смотрит только на прямого родителя; если у него самого нет `@Delay`/`@Apply`, очередь более дальнего предка не поднимается). Готовый образец рекурсивного подъёма через недекорированного родителя уже есть в `Controller()` (`packages/router/src/decorators/controllers/index.ts:10-19`) — можно взять за шаблон.
- `KI-ROUTER-19` (новая, долг) — граф встречных ожиданий `RxContext.waits` держит одно ребро на ветку; ветка, параллельно ждущая создания двух разных классов, теряет первое ожидание при регистрации второго.
- `.serena/` — не в `.gitignore` (проверено: `grep -n serena main/.gitignore` — пусто; каталог сейчас untracked).
- Коммит — только по просьбе автора.

## 2. core и holder

| ID | Решение | Проверка |
|---|---|---|
| KI-CORE-03 | Особенность, фазу DELAY оставить. Исправить описание: ошибка в DELAY не теряется, а роняет процесс (проба в bun и node). | — |
| KI-CORE-05 | Копия метода пробрасывает `this`: `function (...args) { return Reflect.apply(descriptor.value, this, args) }`. Сейчас роутер вызывает эндпоинт с `this = класс` (`router/src/common/classes.ts:363-367`), а унаследованная копия отдаёт оригиналу `null`. `Child.run !== Parent.run` оставить — это даёт потомку свой мета-инстанс. | `inherit.test.ts`: унаследованный статик видит `this = потомок`, прототипный — экземпляр |
| KI-CORE-06 (остаток) | Удалить `AomNode.currentProperty`, неиспользуемый `core/src/constants/errors.ts`, лишние импорты в `functions.ts`. | tsc + тесты |
| KI-CORE-07 | В `AomNode` — `WeakSet` унаследованных родителей; повторный `inherit` возвращает `$parent` без переноса. | `inherit.test.ts`: двойной `inherit` не повторяет FIRST |
| KI-CORE-08 | Особенность: ветка с созданием инстанса в `checkExists` не достигается — все вызовы передают один аргумент-класс. | — |
| KI-CORE-09 | Закрыт автором. Осталось: запись в реестре; сверить тип `AomMethodHandler` (обещает `PropertyDescriptor \| void`). | — |
| KI-HOLDER-01 | Корень в holder: `@Delay` сам не переносит очередь класс-декораторов родителя. В `Delay` перед `inherit`: `$.queue.unshift(...(AomHolder.checkExists(parent)?.queue ?? []))`; не дублировать очередь при повторном вызове `Delay` из `Apply`. | перевернуть `it.fails` в `holder.test.ts:42`; трёхуровневый случай |
| KI-HOLDER-02 | Readme переписан в `4d7a5be` (уже в HEAD) — закрыть запись; удалить мёртвый `errors` в `Delay`. | — |

## 3. api

| ID | Решение | Риск для приложения |
|---|---|---|
| KI-API-01 | **Не дефект** (решение автора): шаблон параметра встраивается в регулярное выражение пути (`http.ts:44-49`), несовпадение даёт `null` из `match` → 404. Снять запись. | — |
| KI-API-02 | `content-type` сравнивать по части до `;` (`charset` — стандартный параметр). Битый JSON → 400 `ERROR_WRONG_DATA` вместо 500 `{}`. Multipart — особенность. | нет |
| KI-API-03 | Один `catch` в `Server`: `ErrorMessage` — как есть; ошибка с числовым `status` → `ErrorMessage`; иначе `ServerErrorResponse`, текст исключения клиенту не отдаётся. 404 — с JSON-типом. Поток: тип по умолчанию `application/octet-stream`; ошибка потока (нет файла) → 500 или `res.destroy` — сейчас она роняет процесс и вешает запрос. | тело 500 — код ошибки вместо `{}` |
| KI-API-04 | Сравнивать `Object.values(source)` с `Object.keys(target)`; дописать ru/en-переводы для 19 кодов без перевода. | у приложения своя копия `checkLocales` с той же ошибкой |
| KI-API-05 | `description ?? this.description ?? ""` (сейчас в OpenAPI всегда `""`). | нет |
| KI-API-06 | Опечатка `432` → `423`; `ERROR_DATA_LOCKED` и `ERROR_WRONG_DEPENDENCY` для описаний 423/424. | нет |
| KI-API-08 | `Allow-Headers` — отражать `access-control-request-headers`; `Origin: *` оставить. | нет |
| KI-API-09 | Оставить: SSE появится отдельной задачей. | — |
| KI-API-10 | **Особенность целиком** (решение автора): нет пароля — доступ открыт; `listen` в конструкторе и общий `routesAmount` — тоже особенности. | — |
| KI-API-11 / KI-TEST-03 | Алиас `@aom-js/api` в `vitest.config.ts` + `packages/api/test/{server,units}.test.ts` (сервер на `port: 0`). | нет |
| KI-API-12 | Сначала искать маршрут; 204 на `OPTIONS` — только если маршрута нет. | нет |
| KI-API-13 | `?.find` вместо деструктуризации; не нашлось — слой не пройден, без исключения. | нет |

Попутно (в реестр — новыми записями): `Logger` считает ошибкой любой статус ≠ 200 (`logger.ts:65-70`); `.` в шаблоне пути совпадает с любым символом (`http.ts:38,54`).

## 4. transfer

| ID | Решение | Риск для приложения |
|---|---|---|
| KI-TRANSFER-01 | Таймаут ответа в `RxTransfer.request`: `new Transfer({ responseTimeout })`, по умолчанию 30 000 мс, `0` выключает. `@ResponseTopic` отклоняет Promise с `TransferTimeoutError`; запись в `callbackMap` удаляется — это лечит и второй симптом: singleton-`@CustomTopic` без исполнителя сейчас навсегда склеивает все следующие вызовы. | `POST /request` без исполнителя вернёт ошибку через 30 с |
| KI-TRANSFER-02 | Удалить вызов тела изолятора после ответа и поле `originDescriptorValue`; возврат `Subscription` — особенность. | тела изоляторов в приложении пустые |
| KI-TRANSFER-03 | Ключ процесса строить из `instanceTopic`, вычисленного до проверки на повтор. Поправить «Последствия»: параллельные вызовы к разным исполнителям склеиваются, адрес `toInstance` переходит на следующий чужой вызов. | `toInstance` пока не используется |
| KI-TRANSFER-04 | Удалить `registry.ts` и его экспорт; `RxTransfer` оставить внутренним. | нет |
| KI-TRANSFER-05 | Опция `new Transfer({ defaultErrorHandler })`; не задана — ошибки логируются (`console.error`). В неё идут ошибки подписок `@CustomTopic` и таймауты из KI-TRANSFER-01. Глобальную заплатку `rxjs.config.onUnhandledError` удалить. | нет |
| KI-TRANSFER-06 | Особенность: у одноимённых классов совпадают и топики. В readme — правило «имена распределённых классов уникальны на шине». | — |
| KI-TRANSFER-07 | `@Isolator` и `@Executor` — явно фаза INSTANT (сейчас стоит FIRST по умолчанию, хотя `@Isolator` вызывает `$._.apply()`, то есть агрегатор). Распределённость — второй опцией: `@Isolator(transfer, { distributed: true })`; объект опций — место для будущих расширений. `@IsDistributed` удалить — зависимость от порядка декораторов исчезает. Попутно: `docs/isolators.md:203`. | `@IsDistributed` приложением не используется |

## 5. schemer и codegen

| ID | Решение | Риск для приложения |
|---|---|---|
| KI-SCHEMER-01 | `params.x ? …` → `params.x != null ? …` (4 места); перевернуть `it.fails` в `render.test.ts:79`. | `Pager.offset` получит `minimum: 0` |
| KI-SCHEMER-02 | `IsNullable()` при `nullable: true` в `Number`. | нет |
| KI-SCHEMER-03 | `...params.decorators` в `Date` и `Type`. | нет |
| KI-SCHEMER-04 | `{ each: params.isArray }` для `Min/Max/MinLength/MaxLength/MinDate/MaxDate`. | нет |
| KI-SCHEMER-05 | `readOnly` в схеме у `Enum/Date/Type`; `pattern` → `Matches(...)` у `String`. | 12 полей-связей получат `readOnly: true` (поля ответов) |
| KI-SCHEMER-06 | `const { name, decorators, ...schema } = params; JSONSchema(schema)`; `name` удалить из типа параметров. | нет |
| KI-SCHEMER-07 | **Особенность** (решение автора): mapped-types возвращают абстрактные анонимные классы, которые и должны перезаписываться. Поправить текст записи. | — |
| KI-SCHEMER-08 | **Формат — тот, что даёт class-validator** (решение автора: типы не форсируем, всё совместимо с class-validator). `IsDate` рендерится как `oneOf: [{format: date}, {format: date-time}]` — привести к нему словарь `SCALAR_TYPE_SCHEMAS.date` (чтобы `@TopicSchema("date")` и `PropertySchema.Date` совпадали), а codegen распознаёт эту форму (`scalarNameOf`). **Перенесено в волну codegen:** словарь и распознавание меняются вместе, иначе в промежутке ломается codegen. | OpenAPI приложения не меняется |
| KI-SCHEMER-09 (остаток) | Удалить поле `AomSchemas.schemer` (`module.ts:14`), массив `errors` в `ComponentSchema` (`decorators.ts:20,42`) и закомментированный код. | нет |
| KI-CODEGEN-01 | **Решение автора:** обратный разбор JSON Schema (`inverse.ts`) заменяется собственным форматом свёртки/развёртки — `PropertySchema.*` сохраняются со своими параметрами и восстанавливаются как есть. Проект формата согласован — `2026-09-14-codegen-folding-design.md`. Тест identity: классы → формат → код → `import()` → формат, `toEqual`. | codegen приложением не используется |
| KI-CODEGEN-02 | `chmod 0o755` для `bin` в `post-build.js`; `check` сообщает об удалённых сервисах и выходит с кодом 1; `serviceDirName("HTTPService") → "http-service"`. Перенесено в волну codegen (те же файлы). | нет |
| KI-CODEGEN-03 (новая) | Сгенерированный `schemas.ts` падает при импорте (`Cannot access 'Q' before initialization`), если `Type`-свойство ссылается на класс ниже — из-за `design:type`. Решение: `type Ref<T> = T;` и `Ref<X>` для таких свойств. Входит в формат codegen (волна codegen). | нет |

## 6. router

| ID | Решение | Риск для приложения |
|---|---|---|
| KI-ROUTER-01 | В `instanceWithHooks` класть в `context.state` промис создания, а экземпляр — сразу после `Reflect.construct`, до хуков. Хендлер `This` не менять. Цикл «конструктор ↔ хук» зависает (решение автора: так и оставить). Перевернуть `it.fails` в `router-exec.test.ts:211`. | `Orgs.Create` получит один `DBData` |
| KI-ROUTER-02 / 05 / 08 / 09 / 10 | Особенности, оставить; у 10 переформулировать (`ThisRef` от маршрута не зависит, «контекст первого» — только у `RouteRef`); открытый вопрос по 02 закрыть. | — |
| KI-ROUTER-03 | Курсоры в `AomRoute` создавать заново, общие не мутировать. `RouteRef` без эндпоинта в `realizeDelay` → `ROUTE_REF_DELAY_ERROR` вместо TypeError. | нет |
| KI-ROUTER-04 | Не отбрасывать молча — бросать `USE_MIDDLEWARE_DEFINE_ERROR`. | 0 отброшенных ссылок в приложении |
| KI-ROUTER-06 | `WebSocketPoint(path = "/")`; отсутствие в OpenAPI — особенность. | нет |
| KI-ROUTER-07 | `toJSON` сливает `initData` со сгенерированным (при совпадении побеждает сгенерированное); ключ `securitySchemes` по имени класса — особенность. | нет |
| KI-ROUTER-11 | Закрыт автором. | — |
| KI-ROUTER-12 | Удалить поле `parametersHandlers`. | нет |
| KI-ROUTER-13 | Корень в ядре — перенесено в `KI-CORE-10` и исправлено (раздел 1). | — |

## 7. Не дефекты (итог)

- **Особенности:** KI-CORE-03, 04, 08; KI-API-01, KI-API-10, multipart в KI-API-02; KI-ROUTER-02, 05, 08, 09, 10 и половины 06/07; KI-TRANSFER-02 (кроме вызова тела), KI-TRANSFER-06; KI-SCHEMER-07. Добавлена 2026-09-21: KI-ROUTER-18 (решение автора: `@Controller()` — триггер запуска хуков, наследник обязан сам его нести).
- **Долг на будущее (не дефект, не закрывается этой волной):** KI-TRANSFER-12 (защита шины — подлинность отправителя реестра), KI-CODEGEN-05 (ReDoS в `$regexp`) — оба issue `https://github.com/aom-js/main/issues/1`; KI-ROUTER-19 (граф встречных ожиданий держит одно ребро на ветку).
- **Легаси, оставить:** KI-API-09.
- **Легаси, удалить:** KI-TRANSFER-04, KI-ROUTER-12, остатки KI-SCHEMER-09 и KI-CORE-06.

## 8. Порядок работ

1. **Этап 1 (запущен 2026-09-14), параллельно по пакетам** (общих файлов нет): core+holder; router (01, 03, 04, 06, 07, 12); schemer (01–06, 09) и параметр `enumName` у `PropertySchema.Enum`; transfer (01–05, 07, включая перевод codegen с `@IsDistributed` на опцию `@Isolator`); api — алиас в `vitest.config.ts`, затем 02–06, 08, 12, 13.
2. **Волна codegen** по `2026-09-14-codegen-folding-design.md` (раздел 11), вместе с KI-SCHEMER-08, KI-CODEGEN-02, KI-CODEGEN-03.
3. **Замыкание:** записи реестра и readme; `bun run build` (приложение работает на `dist`); тесты приложения (`test/unit/routes-map.test.ts` — сборка OpenAPI).

Проверка каждого этапа — `bun run test` в `main` (тесты transfer таймингозависимы — гонять 2–3 раза) и ревью; KI-ROUTER-01 ревьюить отдельно (конкурентность).

## 9. Открытые вопросы

Нет. Формат codegen согласован автором 2026-09-14 — `2026-09-14-codegen-folding-design.md` (решения — его раздел 9).
