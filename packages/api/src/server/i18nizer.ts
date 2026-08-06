import { OpenApiParameterObject } from "@aom-js/router";

declare type I18nLocale = string;
declare type I18nLocaleKey = string;
declare type I18nLocaleValue = string;
declare type I18nLocalesMap = Record<I18nLocaleKey, I18nLocaleValue>;
declare type I18nLocalesRegexMap = Record<I18nLocaleKey, RegExp>;
declare type I18nLocalesStructure = Record<I18nLocale, I18nLocalesMap>;

export declare type I18nizerInitFunction = (i18n: I18nizer) => void | Promise<void>;
export declare type I18nizerInPath = 'query' | 'header';

export class I18nizer {

  static DEFAULT_LOCALE: I18nLocale;
  static HEADER_KEY: string;
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

    init?: I18nizerInitFunction
  ) {

    if (init) {
      init(this);
    }
  }

  defineLocale(headers: Record<string, string | string[]>, query: Record<string, string | string[]>): I18nLocaleKey {
    // приоритет в query, по остаточному принципу в headers
    const [localeValue] = [query[this.queryKey], headers[this.headerKey.toLowerCase()]].flat().filter(Boolean);
    let locale: I18nLocaleKey;
    if (localeValue && this.localesStruct[localeValue]) {
      // если локаль найдена, и она есть в карте, то вернём ее
      locale = localeValue;
    } else if (this.defaultLocale && this.localesStruct[this.defaultLocale]) {
      // иначе попробуем вернуть локаль по умолчанию
      locale = this.defaultLocale;
    } else {
      // иначе берём первую в структуре
      [locale] = Object.keys(this.localesStruct);
    }

    return locale;
  }

  setDefaultLocale(defaultLocale: I18nLocale) {
    this.defaultLocale = defaultLocale;
  }

  getDefaultLocale() {
    return this.defaultLocale;
  }

  localize(text: string, locale: I18nLocale): string {
    if (locale && this.localesStruct[locale]) {
      const dict = this.localesStruct[locale];
      const RE = this.regexMap[locale];
      return text.replace(RE, (code) => dict[code] ?? code);
    } else {
      return text;
    }
  }

  addLocalesStruct(struct: I18nLocalesStructure) {
    Object.keys(struct).forEach(locale => {
      this.addLocalesMap(locale, struct[locale]);
    })
  }

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
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    locales.forEach(locale => {
      const dict = this.localesStruct[locale];
      const keys = Object.keys(dict).sort((a, b) => b.length - a.length);
      this.regexMap[locale] = new RegExp(keys.map(escape).join('|'), 'g');
    });
  }

  getLocales(): I18nLocaleKey[] {
    return Object.keys(this.localesStruct);
  }

  JSONSchema(inPath: I18nizerInPath = 'query'): OpenApiParameterObject {
    return {
      name: inPath === 'query' ? this.queryKey : this.headerKey,
      in: inPath,
      schema: {
        type: "string",
      },
    }
  }

}
