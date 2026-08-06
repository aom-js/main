import { difference } from "es-toolkit/compat";

export function checkLocales(
  hint: string,
  source: Record<string, string>,
  target: Record<string, string>,
) {
  const sourceKeys = Object.keys(source);
  const targetKeys = Object.keys(target);

  const keysDiff = difference(sourceKeys, targetKeys);
  if (keysDiff.length) {
    console.log(`locales difference ${hint}`, keysDiff);
  }
}
