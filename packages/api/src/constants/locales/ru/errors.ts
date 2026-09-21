import * as errors from "../../messages/errors";
import { checkLocales } from "../../../functions";

/**
 * Russian translations for every message code in `constants/messages/errors.ts`, keyed by the
 * code itself. Merged into a `Server`'s `I18nizer` automatically by `Server`'s constructor.
 */
const locales = {
  [errors.ERROR_MESSAGE]: "Сообщение об ошибке",
  [errors.ERROR_NOT_FOUND]: "Данные не найдены",
  [errors.ERROR_WRONG_PARAMS]: "Неверные параметры",
  [errors.ERROR_WRONG_DATA]: "Неверные данные",
  [errors.ERROR_ACCESS_DENY]: "Доступ запрещен",
  [errors.ERROR_AUTH_REQUIRED]: "Требуется авторизация",
  [errors.ERROR_CONFLICT]: "Конфликт данных",
  [errors.ERROR_ID]: "Некорректный ID",
  [errors.ERROR_DATA_NOT_EXISTS]: "Данные не существуют",
  [errors.ERROR_QUERY_SEARCH]: "Ошибка поиска",
  [errors.WRONG_ROUTE_EXTENDS]: "Некорректное наследование роутов",
  [errors.PATH_NOT_FOUND]: "Адрес не найден",
  [errors.WRONG_DATA_CONTAINMENT]: "Некорректный состав значений",
  [errors.REQUIRED_DATA_MISSING]: "Отсутствуют требуемые параметры",
  [errors.SEE_OTHER_RESPONSE]: "Используется другой источник",
  [errors.API_COMMON_ERROR]: "Общая ошибка",
  [errors.ERROR_DATA_LOCKED]: "Данные заблокированы",
  [errors.ERROR_WRONG_DEPENDENCY]: "Ошибка зависимости данных",
  [errors.ERROR_PAYLOAD_TOO_LARGE]: "Тело запроса превышает допустимый размер",
  [errors.PAYMENT_REQUIRED]: "Требуется оплата",
  [errors.SERVER_ERROR]: "Ошибка сервера",
  [errors.API_ERROR_CODE]: "Код ошибки",
  [errors.API_ERROR_MESSAGE]: "Текст ошибки",
  [errors.API_ERROR_DETAILS]: "Детали ошибки",
  [errors.API_ERROR_303_SEE_OTHER]: "Используется другой источник",
  [errors.API_ERROR_500_SERVER_ERROR]: "Ошибка сервера",
  [errors.API_ERROR_400_WRONG_DATA]: "Неверные данные",
  [errors.API_ERROR_401_AUTH_REQUIRED]: "Требуется авторизация",
  [errors.API_ERROR_402_PAYMENT_REQUIRED]: "Требуется оплата",
  [errors.API_ERROR_403_ACCESS_DENY]: "Доступ запрещен",
  [errors.API_ERROR_404_NOT_FOUND]: "Данные не найдены",
  [errors.API_ERROR_409_CONFLICT]: "Конфликт данных",
  [errors.API_ERROR_413_PAYLOAD_TOO_LARGE]: "Тело запроса превышает допустимый размер",
  [errors.API_ERROR_423_DATA_LOCKED]: "Данные заблокированы",
  [errors.API_ERROR_424_WRONG_DEPENDENCY]: "Ошибка зависимости данных",
  [errors.COMPONENT_SCHEMA_NOT_DEFINED]: "Схема компонента не определена",
  [errors.COMPONENT_SCHEMA_ONLY_PROPERTY_REQUIRED]: "Требуется ровно одно свойство схемы",
};

// label is only for diagnostic output; import.meta would break the cjs build
checkLocales("locales/ru/errors", errors, locales);
export default locales;
