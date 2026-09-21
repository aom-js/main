import * as errors from "../../messages/errors";
import { checkLocales } from "../../../functions";

/**
 * English translations for every message code in `constants/messages/errors.ts`, keyed by the
 * code itself. Merged into a `Server`'s `I18nizer` automatically by `Server`'s constructor.
 */
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
  [errors.ERROR_DATA_LOCKED]: "Data is locked",
  [errors.ERROR_WRONG_DEPENDENCY]: "Wrong data dependency",
  [errors.ERROR_PAYLOAD_TOO_LARGE]: "Payload too large",
  [errors.PAYMENT_REQUIRED]: "Payment required",
  [errors.SERVER_ERROR]: "Server error",
  [errors.API_ERROR_CODE]: "Error code",
  [errors.API_ERROR_MESSAGE]: "Error text",
  [errors.API_ERROR_DETAILS]: "Error details",
  [errors.API_ERROR_303_SEE_OTHER]: "See other source",
  [errors.API_ERROR_500_SERVER_ERROR]: "Server error",
  [errors.API_ERROR_400_WRONG_DATA]: "Wrong data",
  [errors.API_ERROR_401_AUTH_REQUIRED]: "Auth required",
  [errors.API_ERROR_402_PAYMENT_REQUIRED]: "Payment required",
  [errors.API_ERROR_403_ACCESS_DENY]: "Access deny",
  [errors.API_ERROR_404_NOT_FOUND]: "Data not found",
  [errors.API_ERROR_409_CONFLICT]: "Data conflict",
  [errors.API_ERROR_413_PAYLOAD_TOO_LARGE]: "Payload too large",
  [errors.API_ERROR_423_DATA_LOCKED]: "Data is locked",
  [errors.API_ERROR_424_WRONG_DEPENDENCY]: "Wrong data dependency",
  [errors.COMPONENT_SCHEMA_NOT_DEFINED]: "Component schema not defined",
  [errors.COMPONENT_SCHEMA_ONLY_PROPERTY_REQUIRED]: "Exactly one schema property required",
};

// label is only for diagnostic output; import.meta would break the cjs build
checkLocales("locales/en/errors", errors, locales);
export default locales;
