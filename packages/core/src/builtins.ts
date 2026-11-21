import cyberpunk from '../themes/cyberpunk.json';
import gta6 from '../themes/gta6.json';
import { parseTheme } from './theme.js';
import type { Theme } from './types.js';

/** Themes that ship with looks. User themes with the same name take precedence. */
export const BUILTIN_THEMES: Theme[] = [gta6, cyberpunk].map((t) => parseTheme(t).theme);

export function findBuiltin(name: string): Theme | undefined {
  return BUILTIN_THEMES.find((t) => t.name.toLowerCase() === name.toLowerCase());
}
