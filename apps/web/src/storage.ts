import { parseTheme, type Theme } from '@looks/core';

const THEMES_KEY = 'looks.themes.v1';
const PREFS_KEY = 'looks.prefs.v1';

/** Saved themes live in this browser only; export them as JSON to use them in the CLI. */
export function loadSavedThemes(): Theme[] {
  try {
    const raw = localStorage.getItem(THEMES_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.flatMap((t) => {
      try {
        return [parseTheme(t).theme];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function storeSavedThemes(themes: Theme[]): boolean {
  try {
    localStorage.setItem(THEMES_KEY, JSON.stringify(themes));
    return true;
  } catch {
    return false;
  }
}

export interface Prefs {
  theme?: string;
  open?: string[];
}

export function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Prefs;
  } catch {
    return {};
  }
}

export function storePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode etc. — prefs are only a convenience */
  }
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
