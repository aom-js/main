import * as errors from "../../messages/errors";
import { checkLocales } from "../../../functions";

const locales = {
  [errors.ERROR_MESSAGE]: "Error message",
  [errors.ERROR_NOT_FOUND]: "Data not found",
  [errors.ERROR_WRONG_PARAMS]: "Wrong params",
  [errors.ERROR_WRONG_DATA]: "Wrong data",
  [errors.ERROR_ACCESS_DENY]: "Access deny",
  [errors.ERROR_AUTH_REQUIRED]: "Auth required",
  [errors.ERROR_CONFLICT]: "Data conflict",
  [errors.ERROR_ID]: "Wrong ID",
  [errors.ERROR_DATA_NOT_EXISTS]: "Data not exists",
  [errors.ERROR_QUERY_SEARCH]: "Query search error",
  [errors.WRONG_ROUTE_EXTENDS]: "Wrong routes extends",
  [errors.PATH_NOT_FOUND]: "Path not found",
  [errors.WRONG_DATA_CONTAINMENT]: "Wrong data containment",
  [errors.REQUIRED_DATA_MISSING]: "Required data missing",
  [errors.SEE_OTHER_RESPONSE]: "See other source",
  [errors.API_COMMON_ERROR]: "Common error",
};

// метка только для диагностического вывода; import.meta закрыл бы cjs-сборку
checkLocales("locales/en/errors", errors, locales);
export default locales;
