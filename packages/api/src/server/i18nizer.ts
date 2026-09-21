import { OpenApiParameterObject } from "@aom-js/router";

declare type I18nLocale = string;
declare type I18nLocaleKey = string;
declare type I18nLocaleValue = string;
declare type I18nLocalesMap = Record<I18nLocaleKey, I18nLocaleValue>;
declare type I18nLocalesRegexMap = Record<I18nLocaleKey, RegExp>;
declare type I18nLocalesStructure = Record<I18nLocale, I18nLocalesMap>;

/** Callback passed to the {@link I18nizer} constructor to register dictionaries right away. */
export declare type I18nizerInitFunction = (i18n: I18nizer) => void | Promise<void>;
/** Where {@link I18nizer.JSONSchema} documents the locale parameter as living: query string or header. */
export declare type I18nizerInPath = "query" | "header";

/**
 * Substitutes message codes (e.g. `AOM_API:ERROR_NOT_FOUND`) with localized text in an
 * already-serialized response string, based on the locale requested by the client.
 *
 * `Server` calls {@link I18nizer.localize} on the final JSON/plain-text payload just before
 * writing it, so substitution runs on the **serialized string**, not on the response object.
 * That is why the message codes chosen for `ErrorMessage`/`*Response` classes must not collide
 * with substrings that legitimately appear elsewhere in a response.
 *
 * @example
 * ```ts
 * import { Server, I18nizer, type AomServerSettings } from "@aom-js/api";
 *
 * const i18nizer = new I18nizer("en", "x-locale", "locale", {
 *   en: { "APP:GREETING": "Hello" },
 *   ru: { "APP:GREETING": "Привет" },
 * });
 *
 * const settings: AomServerSettings = { port: 3000, url: "http://localhost" };
 * new Server(settings, router, i18nizer); // Server adds its own built-in dictionaries on top
 * ```
 */
export class I18nizer {
  /** Fallback default locale read by the constructor when no explicit `defaultLocale` is given. Must be set before `new I18nizer()` is called. */
  static DEFAULT_LOCALE: I18nLocale;
  /** Default request header name carrying the desired locale, read by the constructor. Must be set before `new I18nizer()` is called. */
  static HEADER_KEY: string;
  /** Default query-string key carrying the desired locale, read by the constructor. Must be set before `new I18nizer()` is called. */
  static QUERY_KEY: string;

  private regexMap: I18nLocalesRegexMap = {};

  constructor(
    /** Default Locale */
    private defaultLocale: I18nLocale = I18nizer.DEFAULT_LOCALE,

    /** Header Key for locale value */
    private headerKey: string = I18nizer.HEADER_KEY,

    /** Query Key for locale value */
    private queryKey: string = I18nizer.QUERY_KEY,

    /** Locales Map */
    private localesStruct: I18nLocalesStructure = {},

    init?: I18nizerInitFunction,
  ) {
    if (init) {
      init(this);
    }
  }

  /**
   * Picks the locale to use for a request: query value first, then header value, then
   * `defaultLocale`, then the first locale registered in the dictionary.
   *
   * @param headers - request headers, keyed lower-case (as `Server` builds them)
   * @param query - parsed query-string values
   * @returns a locale key present in the registered dictionaries
   */
  defineLocale(
    headers: Record<string, string | string[]>,
    query: Record<string, string | string[]>,
  ): I18nLocaleKey {
    // query takes priority, headers are the fallback
    const [localeValue] = [query[this.queryKey], headers[this.headerKey.toLowerCase()]]
      .flat()
      .filter(Boolean);
    let locale: I18nLocaleKey;
    if (localeValue && this.localesStruct[localeValue]) {
      // if the locale was found and is present in the map, return it
      locale = localeValue;
    } else if (this.defaultLocale && this.localesStruct[this.defaultLocale]) {
      // otherwise try to fall back to the default locale
      locale = this.defaultLocale;
    } else {
      // otherwise take the first one in the structure
      [locale] = Object.keys(this.localesStruct);
    }

    return locale;
  }

  /** Overrides the fallback locale used by {@link defineLocale} when the request doesn't specify one. */
  setDefaultLocale(defaultLocale: I18nLocale) {
    this.defaultLocale = defaultLocale;
  }

  /** Returns the currently configured fallback locale. */
  getDefaultLocale() {
    return this.defaultLocale;
  }

  /**
   * Replaces every known message code inside `text` with its translation for `locale`.
   *
   * Runs on the already-serialized response string via a single combined regexp (codes are
   * sorted longest-first so a shorter code can't shadow a longer one that contains it). Codes
   * without a translation in the dictionary, and requests for a locale that isn't registered,
   * are returned unchanged.
   */
  localize(text: string, locale: I18nLocale): string {
    if (locale && this.localesStruct[locale]) {
      const dict = this.localesStruct[locale];
      const RE = this.regexMap[locale];
      return text.replace(RE, (code) => dict[code] ?? code);
    } else {
      return text;
    }
  }

  /** Merges every locale of `struct` into the registered dictionaries via {@link addLocalesMap}. */
  addLocalesStruct(struct: I18nLocalesStructure) {
    Object.keys(struct).forEach((locale) => {
      this.addLocalesMap(locale, struct[locale]);
    });
  }

  /**
   * Merges `map` into the dictionary for `locale` (existing codes for other calls are kept,
   * new/overlapping codes from `map` win) and rebuilds the lookup regexp for that locale.
   */
  addLocalesMap(locale: I18nLocale, map: I18nLocalesMap) {
    if (!this.localesStruct[locale]) {
      this.localesStruct[locale] = {};
    }
    this.localesStruct[locale] = { ...this.localesStruct[locale], ...map };
    //
    this.buildRegexpMap();
  }

  private buildRegexpMap() {
    const locales = Object.keys(this.localesStruct);
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    locales.forEach((locale) => {
      const dict = this.localesStruct[locale];
      const keys = Object.keys(dict).sort((a, b) => b.length - a.length);
      this.regexMap[locale] = new RegExp(keys.map(escape).join("|"), "g");
    });
  }

  /** Lists the locale keys currently registered. */
  getLocales(): I18nLocaleKey[] {
    return Object.keys(this.localesStruct);
  }

  /** Describes the locale-selecting query/header parameter for OpenAPI. */
  JSONSchema(inPath: I18nizerInPath = "query"): OpenApiParameterObject {
    return {
      name: inPath === "query" ? this.queryKey : this.headerKey,
      in: inPath,
      schema: {
        type: "string",
      },
    };
  }
}
