import type { PluralForm } from './types.js';

const rules = new Map<string, Intl.PluralRules>();

/**
 * The form of `forms` that `count` takes in `language` (CLDR plural rules, as i18next on the
 * web): `plural('sk', 3, { one: 'úloha', few: 'úlohy', other: 'úloh' })` is `úlohy`. A form
 * the language has but `forms` lacks falls back to `other`.
 */
export function plural(
  language: string,
  count: number,
  forms: Partial<Record<PluralForm, string>> & { other: string },
): string {
  let rule = rules.get(language);
  if (!rule) {
    rule = new Intl.PluralRules(language);
    rules.set(language, rule);
  }
  return forms[rule.select(count)] ?? forms.other;
}
