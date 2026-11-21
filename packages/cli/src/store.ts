import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { BUILTIN_THEMES, findBuiltin, parseTheme, parseXmp, themeToJson, type Theme } from '@looks/core';

/** Where user themes live: $LOOKS_HOME/themes, else $XDG_CONFIG_HOME/looks/themes, else ~/.config/looks/themes. */
export function themesDir(): string {
  if (process.env.LOOKS_HOME) return join(resolve(process.env.LOOKS_HOME), 'themes');
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'looks', 'themes');
}

export function userThemePath(name: string): string {
  return join(themesDir(), `${name.toLowerCase()}.json`);
}

export interface LoadedTheme {
  theme: Theme;
  origin: 'user' | 'builtin' | 'file';
  path?: string;
  warnings: string[];
}

/** Reads a theme from a .json or Lightroom .xmp file. */
export function readThemeFile(path: string, fallbackName: string): { theme: Theme; warnings: string[] } {
  const text = readFileSync(path, 'utf8');
  if (extname(path).toLowerCase() === '.xmp' || /^\s*<(\?xml|x:xmpmeta)/.test(text)) return parseXmp(text, fallbackName);
  return parseTheme(text, fallbackName);
}

export function listUserThemes(): Array<{ name: string; path: string; theme?: Theme; error?: string }> {
  const dir = themesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .sort()
    .map((f) => {
      const path = join(dir, f);
      const name = f.slice(0, -5);
      try {
        const { theme } = readThemeFile(path, name);
        return { name, path, theme: { ...theme, name } };
      } catch (e) {
        return { name, path, error: (e as Error).message };
      }
    });
}

/**
 * Finds a theme by name (user themes first, then built-ins), or loads it
 * directly when `ref` is a path to a .json / .xmp file.
 */
export function loadTheme(ref: string): LoadedTheme {
  const looksLikeFile = /\.(json|xmp)$/i.test(ref) || ref.includes('/') || ref.includes('\\');
  if (looksLikeFile && existsSync(ref)) {
    const base = ref.replace(/^.*[\\/]/, '').replace(/\.(json|xmp)$/i, '');
    const { theme, warnings } = readThemeFile(ref, base);
    return { theme, origin: 'file', path: resolve(ref), warnings };
  }
  const path = userThemePath(ref);
  if (existsSync(path)) {
    const { theme, warnings } = readThemeFile(path, ref);
    return { theme: { ...theme, name: ref.toLowerCase() }, origin: 'user', path, warnings };
  }
  const builtin = findBuiltin(ref);
  if (builtin) return { theme: builtin, origin: 'builtin', warnings: [] };
  const names = [...BUILTIN_THEMES.map((t) => t.name), ...listUserThemes().map((t) => t.name)];
  const hint = names.length ? ` Available: ${[...new Set(names)].sort().join(', ')}.` : '';
  throw new Error(`No theme called "${ref}".${hint} Run "looks list" to see them all.`);
}

export function saveUserTheme(theme: Theme): string {
  const dir = themesDir();
  mkdirSync(dir, { recursive: true });
  const path = userThemePath(theme.name);
  writeFileSync(path, themeToJson(theme));
  return path;
}

export function removeUserTheme(name: string): string {
  const path = userThemePath(name);
  if (!existsSync(path)) {
    if (findBuiltin(name)) throw new Error(`"${name}" is a built-in theme and can't be removed.`);
    throw new Error(`No saved theme called "${name}".`);
  }
  rmSync(path);
  return path;
}
