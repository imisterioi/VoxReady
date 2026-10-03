// Colores de la plataforma (configuración "Estilo" del administrador del cliente).
// Cada organización elige dos colores; el resto de los tonos (modo oscuro, fondos
// suaves y el color del texto sobre cada uno) se calcula a partir de ellos y se
// aplica cambiando las variables CSS definidas en src/index.css.
import { useSyncExternalStore } from 'react';

export const DEFAULT_PALETTE = { brand: '#17354F', accent: '#E0662A' };

export const PRESETS = [
  { id: 'voxready', name: 'VoxReady', brand: '#17354F', accent: '#E0662A' },
  { id: 'esmeralda', name: 'Esmeralda', brand: '#0F3D35', accent: '#0F8A6A' },
  { id: 'coral', name: 'Coral', brand: '#4A1F2E', accent: '#D9534F' },
  { id: 'violeta', name: 'Violeta', brand: '#2A2566', accent: '#6A5ACD' },
  { id: 'oceano', name: 'Océano', brand: '#0B2A4A', accent: '#1F7AE0' },
  { id: 'grafito', name: 'Grafito', brand: '#1F2328', accent: '#C9962B' },
];

const HEX_RE = /^#[0-9a-f]{6}$/i;
export const isHex = (v) => HEX_RE.test(v || '');

export function normalizePalette(p) {
  if (!p || !isHex(p.brand) || !isHex(p.accent)) return null;
  return { brand: p.brand.toUpperCase(), accent: p.accent.toUpperCase() };
}

export const samePalette = (a, b) => Boolean(a && b) && a.brand.toUpperCase() === b.brand.toUpperCase() && a.accent.toUpperCase() === b.accent.toUpperCase();

export const presetFor = (p) => PRESETS.find((x) => samePalette(x, p)) || null;

// ------------------------------------------------------------- Color

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const channels = (rgb) => rgb.join(' ');
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const INK = [15, 27, 42];
const DARK_SURFACE = [15, 21, 30];

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Texto blanco sobre el color si se lee bien (contraste ≥ 3, texto de botón); si no, oscuro
const inkOn = (rgb) => (contrast(rgb, WHITE) >= 3 ? WHITE : INK);

// Aclara u oscurece un color hasta que alcance el contraste pedido sobre un fondo
function ensureContrast(rgb, bg, target, toward) {
  for (let t = 0; t <= 1; t += 0.02) {
    const candidate = mix(rgb, toward, t);
    if (contrast(candidate, bg) >= target) return candidate;
  }
  return toward;
}

// Avisos para colores poco legibles (se muestran en la página Estilo).
// Los textos se corrigen solos; el aviso explica por qué se ven más oscuros o claros.
export function paletteWarnings(p) {
  const out = [];
  if (!normalizePalette(p)) return out;
  if (contrast(toRgb(p.accent), WHITE) < 3) out.push('El color de acento es muy claro: los textos en ese color se mostrarán más oscuros para que se puedan leer.');
  if (contrast(toRgb(p.brand), WHITE) < 4.5) out.push('El color principal es muy claro: se oscurecerá en el logo y los avatares para que tengan buen contraste.');
  return out;
}

// Tonos derivados de la paleta. Cada uso tiene su variante con contraste suficiente
// (WCAG: 4,5:1 para texto normal, 3:1 para botones y elementos gráficos):
//  --accent        botones, gráficos y barras (el color elegido)
//  --accent-fg     textos en color de acento (sobre blanco y sobre --accent-soft)
//  --accent-bright acento sobre fondos oscuros fijos (panel del login, sesión de práctica)
//  --brand         logo, avatares y elementos de marca (se oscurece si es muy claro)
//  --brand-deep    fondo oscuro del panel del login
export function paletteTokens(p) {
  const brand = ensureContrast(toRgb(p.brand), WHITE, 4.5, BLACK);
  const accent = toRgb(p.accent);
  const soft = mix(accent, WHITE, 0.88);
  const deep = ensureContrast(mix(brand, BLACK, 0.4), WHITE, 10, BLACK);

  const darkBrand = ensureContrast(mix(brand, WHITE, 0.55), DARK_SURFACE, 4.5, WHITE);
  const darkAccent = ensureContrast(mix(accent, WHITE, 0.12), DARK_SURFACE, 3, WHITE);
  const darkSoft = mix(accent, DARK_SURFACE, 0.8);

  const bright = ensureContrast(accent, deep, 4.5, WHITE);
  return {
    light: {
      brand,
      'brand-ink': inkOn(brand),
      'brand-deep': deep,
      accent,
      'accent-ink': inkOn(accent),
      'accent-soft': soft,
      'accent-fg': ensureContrast(accent, soft, 4.5, BLACK),
      'accent-bright': bright,
      c1: brand,
      c2: accent,
    },
    dark: {
      brand: darkBrand,
      'brand-ink': inkOn(darkBrand),
      accent: darkAccent,
      'accent-ink': inkOn(darkAccent),
      'accent-soft': darkSoft,
      'accent-fg': ensureContrast(darkAccent, darkSoft, 4.5, WHITE),
      'accent-bright': bright,
      c1: darkBrand,
      c2: darkAccent,
    },
  };
}

const vars = (tokens) => Object.entries(tokens).map(([k, v]) => `--${k}:${channels(v)};`).join('');

// Reglas CSS de la paleta para el modo claro y el oscuro
export function paletteCss(p) {
  const { light, dark } = paletteTokens(p);
  return `html:root{${vars(light)}}
html.dark{${vars(dark)}}`;
}

// -------------------------------------------------- Estado y aplicación
// Prioridad: borrador (página Estilo) > vista previa del header (demo) > organización.
// Los usuarios de una organización (voceros y su administrador) quedan "bloqueados":
// siempre ven la paleta que definió el administrador, sin vista previa local.

const PREVIEW_KEY = 'voxready_palette_preview';
const readPreview = () => {
  try {
    return normalizePalette(JSON.parse(localStorage.getItem(PREVIEW_KEY)));
  } catch {
    return null;
  }
};

let state = { org: null, preview: readPreview(), draft: null, locked: false };
const listeners = new Set();

export const effectivePalette = (s = state) => s.draft || (!s.locked && s.preview) || s.org || null;

function apply() {
  const palette = effectivePalette();
  let el = document.getElementById('vx-palette');
  if (!palette) return el?.remove();
  if (!el) {
    el = document.createElement('style');
    el.id = 'vx-palette';
    document.head.appendChild(el);
  }
  el.textContent = paletteCss(palette);
}

function update(patch) {
  state = { ...state, ...patch };
  apply();
  listeners.forEach((l) => l());
}

export const setOrgPalette = (p) => update({ org: normalizePalette(p) });
export const setPaletteLocked = (locked) => update({ locked: Boolean(locked) });
export const setDraftPalette = (p) => update({ draft: normalizePalette(p) });
export function setPreviewPalette(p) {
  const preview = normalizePalette(p);
  try {
    if (preview) localStorage.setItem(PREVIEW_KEY, JSON.stringify(preview));
    else localStorage.removeItem(PREVIEW_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
  update({ preview });
}

// Estado actual de la paleta (para marcar la opción activa)
export function usePalette() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

apply();
