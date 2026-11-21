import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  BUILTIN_THEMES,
  checkThemeName,
  parseTheme,
  parseXmp,
  setValue,
  themeToJson,
  toXmp,
  type Settings,
  type Theme,
  isHeif,
} from '@looks/core';
import { GradingPanel, MixerPanel, Section, Slider, type SetValue } from './components';
import { Renderer, type Loaded } from './renderer';
import { download, loadPrefs, loadSavedThemes, storePrefs, storeSavedThemes } from './storage';

const REPO = 'https://github.com/SurajMazar/looks';
const DEFAULT_OPEN = ['look', 'light', 'color', 'mixer', 'grading'];

interface Photo {
  name: string;
  width: number;
  height: number;
  previewW: number;
  previewH: number;
}

const same = (a: Settings, b: Settings) => JSON.stringify(a) === JSON.stringify(b);
const stemOf = (name: string) => name.replace(/\.[^.]+$/, '') || 'photo';

export default function App() {
  const prefs = useMemo(loadPrefs, []);
  const [saved, setSaved] = useState<Theme[]>(loadSavedThemes);
  const allThemes = useMemo(() => {
    const mine = new Set(saved.map((t) => t.name));
    return [...BUILTIN_THEMES.filter((t) => !mine.has(t.name)), ...saved];
  }, [saved]);
  const initial = allThemes.find((t) => t.name === prefs.theme) ?? BUILTIN_THEMES[0];

  const [base, setBase] = useState<Theme>(initial);
  const [settings, setSettings] = useState<Settings>(initial.settings);
  const [strength, setStrength] = useState(100);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [split, setSplit] = useState(50);
  const [open, setOpen] = useState<string[]>(prefs.open ?? DEFAULT_OPEN);
  const [toast, setToast] = useState<{ text: string; kind?: 'error' } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [saving, setSaving] = useState<null | { name: string; description: string }>(null);
  const [dragging, setDragging] = useState(false);
  const [format, setFormat] = useState<'image/jpeg' | 'image/png' | 'image/webp'>('image/jpeg');

  const afterRef = useRef<HTMLCanvasElement>(null);
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const themeFileRef = useRef<HTMLInputElement>(null);
  const [fit, setFit] = useState({ w: 0, h: 0 });

  const dirty = !same(settings, base.settings);
  const isSaved = saved.some((t) => t.name === base.name);

  const notify = useCallback((text: string, kind?: 'error') => {
    setToast({ text, kind });
    window.clearTimeout((notify as unknown as { t?: number }).t);
    (notify as unknown as { t?: number }).t = window.setTimeout(() => setToast(null), kind === 'error' ? 6000 : 3000);
  }, []);

  const renderer = useMemo(
    () =>
      new Renderer(
        (f) => {
          const c = afterRef.current;
          if (c) {
            if (c.width !== f.width || c.height !== f.height) {
              c.width = f.width;
              c.height = f.height;
            }
            c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(f.rgba), f.width, f.height), 0, 0);
          }
          setRenderMs(Math.round(f.ms));
          setRendering(false);
        },
        (message) => {
          setRendering(false);
          notify(message, 'error');
        },
      ),
    [notify],
  );

  // Re-render the preview whenever the look changes.
  useEffect(() => {
    if (!photo) return;
    setRendering(true);
    renderer.render(settings, strength / 100);
  }, [photo, settings, strength, renderer]);

  useEffect(() => storePrefs({ theme: base.name, open }), [base.name, open]);

  // Fit the photo inside the stage, keeping its aspect ratio.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !photo) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const ar = photo.previewW / photo.previewH;
      const w = Math.min(width, height * ar);
      setFit({ w: Math.floor(w), h: Math.floor(w / ar) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [photo]);

  const openFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      const heifName = /\.(heic|heif|hif)$/i.test(file.name) || /image\/hei[cf]/.test(file.type);
      if (!file.type.startsWith('image/') && !heifName && !/\.(avif|webp|jpe?g|png|gif|bmp|tiff?)$/i.test(file.name)) {
        notify(`${file.name} isn't an image.`, 'error');
        return;
      }
      setOpening(file.name);
      try {
        let loaded: Loaded;
        try {
          // Fast path: the browser decodes it (Safari handles HEIC natively).
          const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
          loaded = await renderer.load(bitmap);
        } catch (nativeErr) {
          // Chrome/Firefox can't decode HEIC: hand the bytes to libheif in the worker.
          const bytes = await file.arrayBuffer();
          if (!isHeif(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 64)))) throw nativeErr;
          loaded = await renderer.load(bytes);
        }
        const c = beforeRef.current!;
        c.width = loaded.previewW;
        c.height = loaded.previewH;
        c.getContext('2d')!.drawImage(loaded.before, 0, 0);
        loaded.before.close();
        setPhoto({ name: file.name, width: loaded.width, height: loaded.height, previewW: loaded.previewW, previewH: loaded.previewH });
        setSplit(50);
      } catch (e) {
        const detail = (e as Error)?.message;
        notify(`Couldn't open ${file.name}${detail && !/decode|source image/i.test(detail) ? `: ${detail}` : ''}. Try a JPEG, PNG, WebP or HEIC.`, 'error');
      } finally {
        setOpening(null);
      }
    },
    [renderer, notify],
  );

  // Paste and drag & drop anywhere.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      if (item) openFile(item.getAsFile());
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === '\\') setSplit((s) => (s === 100 ? 0 : 100));
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
  }, [openFile]);

  const change: SetValue = useCallback((path, value) => setSettings((s) => setValue(s, path, value)), []);
  const toggle = useCallback((id: string, isOpen: boolean) => {
    setOpen((o) => (isOpen ? [...new Set([...o, id])] : o.filter((x) => x !== id)));
  }, []);

  const pickTheme = (t: Theme) => {
    if (dirty && !window.confirm(`Discard your changes to “${base.name}”?`)) return;
    setBase(t);
    setSettings(t.settings);
  };

  const persist = (next: Theme[]) => {
    setSaved(next);
    if (!storeSavedThemes(next)) notify("Couldn't save in this browser (storage is blocked). Export the theme as a file instead.", 'error');
  };

  const commitSave = () => {
    if (!saving) return;
    const name = saving.name.trim().toLowerCase();
    const problem = checkThemeName(name);
    if (problem) return notify(problem, 'error');
    const builtin = BUILTIN_THEMES.some((t) => t.name === name);
    const exists = saved.some((t) => t.name === name);
    if ((builtin || exists) && name !== base.name && !window.confirm(`Replace “${name}”?`)) return;
    const theme: Theme = { name, description: saving.description.trim() || undefined, settings };
    if (!theme.description) delete theme.description;
    persist([...saved.filter((t) => t.name !== name), theme].sort((a, b) => a.name.localeCompare(b.name)));
    setBase(theme);
    setSaving(null);
    notify(`Saved “${name}”. Download it to use it in the terminal.`);
  };

  const removeTheme = () => {
    if (!isSaved || !window.confirm(`Delete your theme “${base.name}” from this browser?`)) return;
    persist(saved.filter((t) => t.name !== base.name));
    const fallback = BUILTIN_THEMES.find((t) => t.name === base.name) ?? BUILTIN_THEMES[0];
    setBase(fallback);
    setSettings(fallback.settings);
  };

  const importTheme = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const fallback = stemOf(file.name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
      const { theme, warnings } = /\.xmp$/i.test(file.name) || text.trimStart().startsWith('<') ? parseXmp(text, fallback) : parseTheme(text, fallback);
      setBase({ ...theme, settings: {} });
      setSettings(theme.settings);
      setSaving({ name: theme.name, description: theme.description ?? '' });
      notify(warnings.length ? `Imported with ${warnings.length} warning(s): ${warnings[0]}` : `Imported “${theme.name}”. Name it and save.`, warnings.length ? 'error' : undefined);
    } catch (e) {
      notify(`Couldn't import ${file.name}: ${(e as Error).message}`, 'error');
    }
  };

  const current: Theme = { ...base, settings };
  const exportJson = () => download(new Blob([themeToJson(current)], { type: 'application/json' }), `${current.name}.json`);
  const exportXmp = () => download(new Blob([toXmp(current)], { type: 'application/rdf+xml' }), `${current.name}.xmp`);

  const exportPhoto = async () => {
    if (!photo) return;
    setExporting(true);
    try {
      const blob = await renderer.exportFull(settings, strength / 100, format, 0.92);
      const ext = format === 'image/png' ? 'png' : format === 'image/webp' ? 'webp' : 'jpg';
      download(blob, `${stemOf(photo.name)}-${current.name}.${ext}`);
    } catch (e) {
      notify(`Export failed: ${(e as Error).message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const dragSplit = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setSplit(Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)) * 10) / 10);
  };

  const cli = `looks save ${current.name} ${current.name}.json\nlooks ${current.name} photo.jpg`;

  return (
    <div
      className={`app${dragging ? ' is-dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && /\.(json|xmp)$/i.test(file.name)) importTheme(file);
        else openFile(file);
      }}
    >
      <header className="bar">
        <a className="brand" href={REPO} target="_blank" rel="noreferrer" title="looks on GitHub">
          <img src="./favicon.svg" alt="" width={26} height={26} />
          <span>looks</span>
        </a>
        <span className="bar__tag">Lightroom-style looks, applied in your browser</span>
        <div className="bar__actions">
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Open photo
          </button>
          <div className="btn-group">
            <select aria-label="Export format" value={format} onChange={(e) => setFormat(e.target.value as typeof format)} disabled={!photo}>
              <option value="image/jpeg">JPEG</option>
              <option value="image/png">PNG</option>
              <option value="image/webp">WebP</option>
            </select>
            <button className="btn btn--primary" onClick={exportPhoto} disabled={!photo || exporting}>
              {exporting ? 'Exporting…' : 'Download'}
            </button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*,.heic,.heif,.hif" hidden onChange={(e) => (openFile(e.target.files?.[0]), (e.target.value = ''))} />
        <input ref={themeFileRef} type="file" accept=".json,.xmp,application/json" hidden onChange={(e) => (importTheme(e.target.files?.[0]), (e.target.value = ''))} />
      </header>

      <main className="stage" ref={stageRef}>
        {opening && (
          <div className="opening" role="status">
            <span className="spinner" aria-hidden="true" />
            Opening {opening}…
          </div>
        )}
        {!photo && !opening && (
          <button className="drop" onClick={() => fileRef.current?.click()}>
            <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
              <rect x="5" y="9" width="38" height="30" rx="5" fill="none" stroke="currentColor" strokeWidth="2.5" />
              <circle cx="17" cy="19" r="4" fill="currentColor" />
              <path d="M8 36l11-11 8 8 5-5 9 9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
            </svg>
            <strong>Drop a photo here</strong>
            <span>JPEG, PNG, WebP or HEIC · click to choose, or paste</span>
            <small>Everything runs on your device. Photos are never uploaded.</small>
          </button>
        )}
        <div
          className="frame"
          hidden={!photo}
          style={{ width: fit.w, height: fit.h } as CSSProperties}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            dragSplit(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) dragSplit(e);
          }}
        >
          <canvas ref={afterRef} className="frame__img" aria-label="Edited photo" />
          <canvas ref={beforeRef} className="frame__img frame__before" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} aria-label="Original photo" />
          <div className="frame__divider" style={{ left: `${split}%` }}>
            <span />
          </div>
          {split > 8 && <span className="frame__label frame__label--l">Before</span>}
          {split < 92 && <span className="frame__label frame__label--r">After</span>}
        </div>
        {photo && (
          <div className="stage__info">
            <span>{photo.name}</span>
            <span>
              {photo.width}×{photo.height}
            </span>
            <span>{rendering ? 'rendering…' : renderMs !== null ? `preview ${renderMs} ms` : ''}</span>
            <span className="stage__hint">drag to compare · \ toggles</span>
          </div>
        )}
      </main>

      <aside className="panel">
        <Section id="look" title="Look" open={open.includes('look')} onToggle={toggle}>
          <div className="looks">
            {allThemes.map((t) => (
              <button key={t.name} className={`chip${t.name === base.name ? ' is-active' : ''}`} onClick={() => pickTheme(t)} title={t.description}>
                {t.name}
                {saved.some((s) => s.name === t.name) && <i aria-label="saved by you" />}
              </button>
            ))}
            <button className="chip chip--ghost" onClick={() => themeFileRef.current?.click()} title="Import a .json theme or a Lightroom .xmp preset">
              + Import
            </button>
          </div>
          <div className="look-head">
            <div>
              <strong>{base.name}</strong>
              {dirty && <span className="badge">edited</span>}
              {base.description && <p>{base.description}</p>}
              {base.notes && <p className="muted">{base.notes}</p>}
            </div>
          </div>
          <div className="slider strength" style={{ '--pos': `${strength}%`, '--from': '0%', '--to': `${strength}%` } as CSSProperties}>
            <div className="slider__row">
              <label htmlFor="strength">Strength</label>
              <output htmlFor="strength">{strength}%</output>
            </div>
            <input id="strength" type="range" min={0} max={100} value={strength} onChange={(e) => setStrength(Number(e.target.value))} onDoubleClick={() => setStrength(100)} />
          </div>

          {saving ? (
            <form
              className="save-form"
              onSubmit={(e) => {
                e.preventDefault();
                commitSave();
              }}
            >
              <label>
                Theme name
                <input autoFocus onFocus={(e) => e.target.select()} value={saving.name} onChange={(e) => setSaving({ ...saving, name: e.target.value })} placeholder="e.g. miami-night" maxLength={64} />
              </label>
              <label>
                Description <span className="muted">(optional)</span>
                <input value={saving.description} onChange={(e) => setSaving({ ...saving, description: e.target.value })} placeholder="What does it look like?" />
              </label>
              <div className="row">
                <button type="submit" className="btn btn--primary">
                  Save theme
                </button>
                <button type="button" className="btn" onClick={() => setSaving(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="row wrap">
              <button className="btn btn--primary" onClick={() =>
                  setSaving(
                    isSaved || !dirty
                      ? { name: base.name, description: base.description ?? '' }
                      : { name: `${base.name}-mine`, description: `Based on ${base.name}.` },
                  )
                }>
                {isSaved && dirty ? 'Save changes' : 'Save as theme'}
              </button>
              <button className="btn" disabled={!dirty} onClick={() => setSettings(base.settings)}>
                Reset
              </button>
              <button className="btn" onClick={exportJson} title="Download as JSON (works with the looks CLI)">
                .json
              </button>
              <button className="btn" onClick={exportXmp} title="Download as a Lightroom preset">
                .xmp
              </button>
              {isSaved && (
                <button className="btn btn--danger" onClick={removeTheme}>
                  Delete
                </button>
              )}
            </div>
          )}
        </Section>

        <Section id="light" title="Light" open={open.includes('light')} onToggle={toggle}>
          {['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'].map((p) => (
            <Slider key={p} path={p} settings={settings} onChange={change} />
          ))}
        </Section>

        <Section id="color" title="Color" open={open.includes('color')} onToggle={toggle}>
          <Slider path="temp" settings={settings} onChange={change} track="linear-gradient(90deg, #3d7bd8, #9aa0a6, #e3b83f)" />
          <Slider path="tint" settings={settings} onChange={change} track="linear-gradient(90deg, #43a047, #9aa0a6, #c84fc8)" />
          <Slider path="vibrance" settings={settings} onChange={change} />
          <Slider path="saturation" settings={settings} onChange={change} />
        </Section>

        <Section id="mixer" title="Color Mixer" open={open.includes('mixer')} onToggle={toggle}>
          <MixerPanel settings={settings} onChange={change} />
        </Section>

        <Section id="grading" title="Color Grading" open={open.includes('grading')} onToggle={toggle}>
          <GradingPanel settings={settings} onChange={change} />
        </Section>

        <Section id="effects" title="Effects" open={open.includes('effects')} onToggle={toggle}>
          {['texture', 'clarity', 'dehaze', 'vignette.amount', 'vignette.midpoint', 'vignette.feather', 'vignette.roundness', 'grain.amount', 'grain.size', 'grain.roughness'].map((p) => (
            <Slider key={p} path={p} settings={settings} onChange={change} />
          ))}
        </Section>

        <Section id="curve" title="Tone Curve" open={open.includes('curve')} onToggle={toggle}>
          {['parametric.highlights', 'parametric.lights', 'parametric.darks', 'parametric.shadows'].map((p) => (
            <Slider key={p} path={p} settings={settings} onChange={change} />
          ))}
          {settings.curve && <p className="muted small">This theme also has a point curve ({Object.keys(settings.curve).join(', ')}), applied as-is.</p>}
        </Section>

        <Section id="detail" title="Detail" open={open.includes('detail')} onToggle={toggle}>
          {['sharpening.amount', 'sharpening.radius', 'sharpening.detail', 'sharpening.masking', 'noiseReduction.luminance', 'noiseReduction.color'].map((p) => (
            <Slider key={p} path={p} settings={settings} onChange={change} />
          ))}
          <p className="muted small">Sharpening and noise reduction work at full size, so they show in the download more than in the preview.</p>
        </Section>

        <Section id="cli" title="Use it in the terminal" open={open.includes('cli')} onToggle={toggle}>
          <p className="small">
            Download the <b>.json</b>, then with the{' '}
            <a href={REPO} target="_blank" rel="noreferrer">
              looks CLI
            </a>
            :
          </p>
          <pre className="code">{cli}</pre>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(cli).then(() => notify('Copied'))}>
            Copy commands
          </button>
        </Section>
      </aside>

      {toast && (
        <div className={`toast${toast.kind === 'error' ? ' toast--error' : ''}`} role="status">
          {toast.text}
        </div>
      )}
      {dragging && <div className="dropzone-overlay">Drop a photo, or a .json / .xmp theme</div>}
    </div>
  );
}
