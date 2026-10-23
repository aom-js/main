# `@aom-js/codegen`

Пакет решает обратную задачу к дистрибуции изоляторов: транспорт (`@aom-js/transfer`) публикует по шине сериализуемый контракт сервиса (`TransferServiceDescriptor`), а `@aom-js/codegen` превращает его обратно в исходники TypeScript — DTO с `@ComponentSchema`/`@PropertySchema.*` и класс-изолятор с `@Isolator`/`@ResponseTopic`/`@CustomTopic`/`@IsQueue`/`@TopicSchema`. Потребитель получает типизированного клиента чужого сервиса, не импортируя его исходники.

Документация: https://aom-js.github.io/docs/packages/codegen/

```bash
npm install @aom-js/codegen
```
