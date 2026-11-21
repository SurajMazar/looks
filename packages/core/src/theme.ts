import { CONTROL_BY_PATH, clampToControl, pruneSettings } from './controls.js';
import type { CurvePoints, Settings, Theme } from './types.js';

/** Words the CLI uses as commands, so they can't be theme names. */
export const RESERVED_NAMES = [
  'apply',
  'list',
  'ls',
  'show',
  'save',
  'new',
  'edit',
  'rm',
  'remove',
  'delete',
  'export',
  'path',
  'keys',
  'help',
  'version',
] as const;

export const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function checkThemeName(name: string): string | null {
  if (!NAME_PATTERN.test(name)) {
    return `Theme names may use letters, numbers, ".", "_" and "-" (max 64 chars), and must start with a letter or number: "${name}"`;
  }
  if ((RESERVED_NAMES as readonly string[]).includes(name.toLowerCase())) {
    return `"${name}" is a command name; pick another theme name.`;
  }
  return null;
}

export interface ParsedTheme {
  theme: Theme;
  warnings: string[];
}

const CURVE_KEYS = ['rgb', 'red', 'green', 'blue'];

function parseCurve(v: unknown, key: string, warnings: string[]): CurvePoints | undefined {
  if (!Array.isArray(v)) {
    warnings.push(`curve.${key} must be a list of [x, y] points; ignored.`);
    return undefined;
  }
  const pts: CurvePoints = [];
  for (const p of v) {
    if (Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      pts.push([Math.min(255, Math.max(0, p[0])), Math.min(255, Math.max(0, p[1]))]);
    } else {
      warnings.push(`curve.${key} has a bad point ${JSON.stringify(p)}; ignored.`);
    }
  }
  return pts.length >= 2 ? pts : undefined;
}

/** Validates settings: unknown keys are dropped (with a warning), numbers are clamped. */
export function parseSettings(raw: unknown, warnings: string[] = []): Settings {
  const walk = (obj: unknown, prefix: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      warnings.push(`${prefix || 'settings'} should be an object; ignored.`);
      return out;
    }
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (path === 'curve') {
        const curve: Record<string, CurvePoints> = {};
        if (v && typeof v === 'object') {
          for (const [ck, cv] of Object.entries(v as Record<string, unknown>)) {
            if (!CURVE_KEYS.includes(ck)) {
              warnings.push(`Unknown curve "${ck}" (use rgb, red, green, blue); ignored.`);
              continue;
            }
            const pts = parseCurve(cv, ck, warnings);
            if (pts) curve[ck] = pts;
          }
        }
        out.curve = curve;
        continue;
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = walk(v, path);
        continue;
      }
      const ctl = CONTROL_BY_PATH.get(path);
      if (!ctl) {
        warnings.push(`Unknown setting "${path}"; ignored.`);
        continue;
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        warnings.push(`"${path}" must be a number; ignored.`);
        continue;
      }
      const clamped = clampToControl(ctl, v);
      if (clamped !== v) warnings.push(`"${path}" = ${v} is outside ${ctl.min}..${ctl.max}; clamped to ${clamped}.`);
      out[k] = clamped;
    }
    return out;
  };
  return pruneSettings(walk(raw, '') as Settings);
}

/** Parses a theme from JSON text or an already-parsed object. */
export function parseTheme(input: unknown, fallbackName = 'untitled'): ParsedTheme {
  const warnings: string[] = [];
  let raw = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      throw new Error(`Not valid JSON: ${(e as Error).message}`);
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('A theme must be a JSON object.');
  const obj = raw as Record<string, unknown>;
  // Accept either { name, settings: {...} } or a bare settings object.
  const hasSettings = obj.settings && typeof obj.settings === 'object';
  const settingsRaw = hasSettings ? obj.settings : Object.fromEntries(
    Object.entries(obj).filter(([k]) => !['name', 'description', 'notes', 'author', 'source', '$schema'].includes(k)),
  );
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const theme: Theme = {
    name: str(obj.name) ?? fallbackName,
    description: str(obj.description),
    notes: str(obj.notes),
    author: str(obj.author),
    source: str(obj.source),
    settings: parseSettings(settingsRaw, warnings),
  };
  for (const k of ['description', 'notes', 'author', 'source'] as const) if (!theme[k]) delete theme[k];
  return { theme, warnings };
}

/** Pretty JSON for a theme file, with keys in a stable order. */
export function themeToJson(theme: Theme): string {
  const ordered: Record<string, unknown> = { name: theme.name };
  if (theme.description) ordered.description = theme.description;
  if (theme.notes) ordered.notes = theme.notes;
  if (theme.author) ordered.author = theme.author;
  if (theme.source) ordered.source = theme.source;
  ordered.settings = pruneSettings(theme.settings);
  return JSON.stringify(ordered, null, 2)
    .replace(/\[\n\s+(-?\d+(?:\.\d+)?),\n\s+(-?\d+(?:\.\d+)?)\n\s+\]/g, '[$1, $2]') + '\n';
}

/** Deep-merges `over` onto `base` (curves are replaced, not merged). */
export function mergeSettings(base: Settings, over: Settings): Settings {
  const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...a };
    for (const [k, v] of Object.entries(b)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'curve' && a[k] && typeof a[k] === 'object') {
        out[k] = merge(a[k] as Record<string, unknown>, v as Record<string, unknown>);
      } else {
        out[k] = JSON.parse(JSON.stringify(v));
      }
    }
    return out;
  };
  return merge(base as Record<string, unknown>, over as Record<string, unknown>) as Settings;
}
