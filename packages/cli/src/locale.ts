export function cliLanguage(env: Record<string, string | undefined> = process.env): 'zh' | 'en' {
  return /^(zh)(_|-|\.)/i.test(env.LC_ALL || env.LC_MESSAGES || env.LANG || '') ? 'zh' : 'en';
}
export function localized(en: string, zh: string): string { return cliLanguage() === 'zh' ? zh : en; }
