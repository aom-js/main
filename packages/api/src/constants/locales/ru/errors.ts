import * as errors from "../../messages/errors";
import { checkLocales } from "../../../functions";

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
};

checkLocales(import.meta.filename, errors, locales);
export default locales;
