// Flat config для ESLint 10. Базовый набор — рекомендованные правила eslint
// и typescript-eslint без типовой проверки: она требует отдельной TS-программы
// на каждый пакет и заметно медленнее. Форматирование целиком отдано prettier —
// eslint-config-prettier идёт последним и гасит конфликтующие правила.
//
// Расширение .mjs, а не .js: корневой package.json без "type": "module",
// потому что scripts/*.js — CommonJS.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "coverage/**", ".yarn/**"],
  },

  js.configs.recommended,

  {
    languageOptions: { globals: globals.node },
  },

  {
    // правила typescript-eslint — только для TS, иначе они ругаются
    // на require() в сборочных скриптах
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
    rules: {
      // Фреймворк построен на рефлексии над декораторами: any здесь рабочий
      // инструмент, а не недосмотр. Держим предупреждением, чтобы новые случаи
      // были видны, но сборка на них не вставала.
      "@typescript-eslint/no-explicit-any": "warn",

      // ClassType = ClassConstructor | Function — это словарь ядра, «класс либо
      // что-то вызываемое». Замена на (...args: any[]) => any не выражает «класс»
      // и просто меняет одно предупреждение на другое.
      "@typescript-eslint/no-unsafe-function-type": "warn",

      // `const self = this` в фабриках декораторов обязателен: возвращаемое
      // замыкание должно сохранить контекст класса.
      "@typescript-eslint/no-this-alias": ["error", { allowedNames: ["self"] }],

      // подчёркивание — общепринятая пометка «знаю, что не используется»
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    // сборочные скрипты — CommonJS
    files: ["scripts/**/*.js"],
    languageOptions: { sourceType: "commonjs" },
  },

  prettier,
);
