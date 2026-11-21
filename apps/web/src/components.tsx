import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  CONTROL_BY_PATH,
  getValue,
  GRADE_REGIONS,
  MIXER_COLORS,
  type Control,
  type GradeRegion,
  type MixerColor,
  type Settings,
} from '@looks/core';

export type SetValue = (path: string, value: number) => void;

function fmt(ctl: Control, v: number): string {
  const decimals = ctl.step < 1 ? (ctl.step < 0.1 ? 2 : 1) : 0;
  const s = v.toFixed(decimals);
  const signed = ctl.min < 0 && v > 0 ? `+${s}` : s;
  return ctl.unit === '°' ? `${signed}°` : signed;
}

export function Slider({
  path,
  settings,
  onChange,
  track,
  label,
}: {
  path: string;
  settings: Settings;
  onChange: SetValue;
  track?: string;
  label?: string;
}) {
  const ctl = CONTROL_BY_PATH.get(path)!;
  const value = getValue(settings, path) ?? ctl.default;
  const pos = ((value - ctl.min) / (ctl.max - ctl.min)) * 100;
  const zero = ctl.min < 0 ? ((0 - ctl.min) / (ctl.max - ctl.min)) * 100 : 0;
  const changed = value !== ctl.default;
  const style = {
    '--pos': `${pos}%`,
    '--from': `${Math.min(pos, zero)}%`,
    '--to': `${Math.max(pos, zero)}%`,
    ...(track ? { '--track': track } : {}),
  } as CSSProperties;
  const id = `s-${path.replace(/\./g, '-')}`;
  return (
    <div className={`slider${track ? ' slider--track' : ''}${changed ? ' is-changed' : ''}`} style={style}>
      <div className="slider__row">
        <label htmlFor={id} title="Double-click the slider to reset">
          {label ?? ctl.label}
        </label>
        <output htmlFor={id}>{fmt(ctl, value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={ctl.min}
        max={ctl.max}
        step={ctl.step}
        value={value}
        onChange={(e) => onChange(path, Number(e.target.value))}
        onDoubleClick={() => onChange(path, ctl.default)}
      />
    </div>
  );
}

export function Section({
  id,
  title,
  open,
  onToggle,
  changed = 0,
  onReset,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: (id: string, open: boolean) => void;
  /** How many sliders in this panel differ from their defaults. */
  changed?: number;
  onReset?: () => void;
  children: ReactNode;
}) {
  return (
    <details className="section" open={open} onToggle={(e) => onToggle(id, (e.target as HTMLDetailsElement).open)}>
      <summary>
        <span>{title}</span>
        {changed > 0 && (
          <span className="section__meta">
            <span className="count" title={`${changed} setting${changed === 1 ? '' : 's'} changed`}>
              {changed}
            </span>
            {onReset && (
              <button
                type="button"
                className="icon-btn"
                title={`Reset ${title}`}
                aria-label={`Reset ${title}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onReset();
                }}
              >
                <IconReset />
              </button>
            )}
          </span>
        )}
      </summary>
      <div className="section__body">{children}</div>
    </details>
  );
}

export function SubHead({ children }: { children: ReactNode }) {
  return <h4 className="sub">{children}</h4>;
}

const svg = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const IconReset = () => (
  <svg {...svg}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
  </svg>
);

export const IconImage = () => (
  <svg {...svg}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="9" cy="10" r="2" />
    <path d="M21 16l-5-5-9 9" />
  </svg>
);

export const IconDownload = () => (
  <svg {...svg}>
    <path d="M12 4v11" />
    <path d="M7 10l5 5 5-5" />
    <path d="M5 20h14" />
  </svg>
);

export const IconChevron = () => (
  <svg {...svg} width={12} height={12} strokeWidth={2.5}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/** Approximate display hues (HSL degrees) for each Color Mixer band. */
const BAND_HUE: Record<MixerColor, number> = {
  red: 2,
  orange: 28,
  yellow: 52,
  green: 122,
  aqua: 184,
  blue: 218,
  purple: 262,
  magenta: 312,
};

export function MixerPanel({ settings, onChange }: { settings: Settings; onChange: SetValue }) {
  const [band, setBand] = useState<MixerColor>('red');
  const i = MIXER_COLORS.indexOf(band);
  const h = BAND_HUE[band];
  const prev = BAND_HUE[MIXER_COLORS[(i + 7) % 8]];
  const next = BAND_HUE[MIXER_COLORS[(i + 1) % 8]];
  const wrapNext = next < h ? next + 360 : next;
  const wrapPrev = prev > h ? prev - 360 : prev;
  return (
    <div className="mixer">
      <div className="mixer__dots" role="tablist" aria-label="Colour band">
        {MIXER_COLORS.map((c) => {
          const touched = ['hue', 'sat', 'lum'].some((k) => (getValue(settings, `mixer.${c}.${k}`) ?? 0) !== 0);
          return (
            <button
              key={c}
              role="tab"
              aria-selected={c === band}
              aria-label={c}
              title={c}
              className={`dot${c === band ? ' is-active' : ''}${touched ? ' is-touched' : ''}`}
              style={{ '--dot': `hsl(${BAND_HUE[c]} 70% 55%)` } as CSSProperties}
              onClick={() => setBand(c)}
            />
          );
        })}
      </div>
      <Slider
        path={`mixer.${band}.hue`}
        label="Hue"
        settings={settings}
        onChange={onChange}
        track={`linear-gradient(90deg, hsl(${wrapPrev} 75% 55%), hsl(${h} 75% 55%), hsl(${wrapNext} 75% 55%))`}
      />
      <Slider
        path={`mixer.${band}.sat`}
        label="Saturation"
        settings={settings}
        onChange={onChange}
        track={`linear-gradient(90deg, hsl(${h} 0% 50%), hsl(${h} 90% 52%))`}
      />
      <Slider
        path={`mixer.${band}.lum`}
        label="Luminance"
        settings={settings}
        onChange={onChange}
        track={`linear-gradient(90deg, hsl(${h} 60% 10%), hsl(${h} 60% 50%), hsl(${h} 70% 88%))`}
      />
    </div>
  );
}

function ColorWheel({ hue, sat, onChange }: { hue: number; sat: number; onChange: (hue: number, sat: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pick = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    let h = (Math.atan2(-y, x) * 180) / Math.PI;
    if (h < 0) h += 360;
    const s = Math.min(1, Math.hypot(x, y) / (r.width / 2));
    onChange(Math.round(h) % 360, Math.round(s * 100));
  };
  const rad = (hue * Math.PI) / 180;
  const left = 50 + Math.cos(rad) * (sat / 100) * 50;
  const top = 50 - Math.sin(rad) * (sat / 100) * 50;
  return (
    <div
      ref={ref}
      className="wheel"
      role="slider"
      aria-label="Hue and saturation"
      aria-valuetext={`Hue ${hue}°, saturation ${sat}`}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e);
      }}
      onDoubleClick={() => onChange(hue, 0)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft') onChange((hue + 360 - step) % 360, sat);
        else if (e.key === 'ArrowRight') onChange((hue + step) % 360, sat);
        else if (e.key === 'ArrowUp') onChange(hue, Math.min(100, sat + step));
        else if (e.key === 'ArrowDown') onChange(hue, Math.max(0, sat - step));
        else return;
        e.preventDefault();
      }}
    >
      <span className="wheel__puck" style={{ left: `${left}%`, top: `${top}%` }} />
    </div>
  );
}

const REGION_LABEL: Record<GradeRegion, string> = {
  shadows: 'Shadows',
  midtones: 'Midtones',
  highlights: 'Highlights',
  global: 'Global',
};

export function GradingPanel({ settings, onChange }: { settings: Settings; onChange: SetValue }) {
  const [region, setRegion] = useState<GradeRegion>('shadows');
  const hue = getValue(settings, `grading.${region}.hue`) ?? 0;
  const sat = getValue(settings, `grading.${region}.sat`) ?? 0;
  return (
    <div className="grading">
      <div className="seg" role="tablist" aria-label="Tonal range">
        {GRADE_REGIONS.map((r) => {
          const s = getValue(settings, `grading.${r}.sat`) ?? 0;
          const h = getValue(settings, `grading.${r}.hue`) ?? 0;
          return (
            <button key={r} role="tab" aria-selected={r === region} className={r === region ? 'is-active' : ''} onClick={() => setRegion(r)}>
              <i style={{ background: s ? `hsl(${h} ${40 + s * 0.6}% 55%)` : 'transparent' }} />
              {REGION_LABEL[r]}
            </button>
          );
        })}
      </div>
      <ColorWheel
        hue={hue}
        sat={sat}
        onChange={(h, s) => {
          onChange(`grading.${region}.hue`, h);
          onChange(`grading.${region}.sat`, s);
        }}
      />
      <div className="grading__readout">
        <span>
          Hue <b>{hue}°</b>
        </span>
        <span>
          Saturation <b>{sat}</b>
        </span>
      </div>
      <Slider path={`grading.${region}.lum`} label="Luminance" settings={settings} onChange={onChange} />
      <Slider path="grading.blending" settings={settings} onChange={onChange} />
      <Slider path="grading.balance" settings={settings} onChange={onChange} />
    </div>
  );
}
