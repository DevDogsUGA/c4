// The nine starter templates and the one file each designates as "the file
// a student edits." Kept here (not shipped to students) so materialize.ts
// can enforce the overlay rule: a sample may replace ONLY this file, plus
// add new files.

export const TEMPLATES = {
  python: 'bot.py',
  node: 'bot.js',
  typescript: 'bot.ts',
  java: 'Bot.java',
  go: 'bot.go',
  csharp: 'Bot.cs',
  cpp: 'bot.cpp',
  c: 'bot.c',
  rust: 'src/bot.rs',
} as const;

export type TemplateName = keyof typeof TEMPLATES;

export const TEMPLATE_NAMES = Object.keys(TEMPLATES) as TemplateName[];

export function isTemplateName(value: string): value is TemplateName {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, value);
}

export function designatedBotFile(template: TemplateName): string {
  return TEMPLATES[template];
}
