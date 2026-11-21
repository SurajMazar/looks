import bleach from '../themes/bleach-1000-year-blood-war.json';
import cyberpunk from '../themes/cyberpunk.json';
import dandandan from '../themes/dandandan.json';
import gta6 from '../themes/gta6.json';
import mushokuTensei from '../themes/mushoku-tensei.json';
import soloLeveling from '../themes/solo-leveling.json';
import tokyoGhoul from '../themes/tokyo-ghoul.json';
import { parseTheme } from './theme.js';
import type { Theme } from './types.js';

/** Themes that ship with looks. User themes with the same name take precedence. */
export const BUILTIN_THEMES: Theme[] = [gta6, cyberpunk, soloLeveling, dandandan, mushokuTensei, tokyoGhoul, bleach].map((t) => parseTheme(t).theme);

export function findBuiltin(name: string): Theme | undefined {
  return BUILTIN_THEMES.find((t) => t.name.toLowerCase() === name.toLowerCase());
}
