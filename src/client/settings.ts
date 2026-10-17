import { useEffect, useState } from 'react';
import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/uncial-antiqua/400.css';
import '@fontsource/medievalsharp/400.css';
import '@fontsource/almendra/400.css';
import '@fontsource/almendra/700.css';
import '@fontsource/im-fell-english/400.css';
import '@fontsource/alegreya/400.css';
import '@fontsource/alegreya/700.css';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/600.css';

// Fonts are bundled with the app (all SIL Open Font License). Browsers only download the ones in use.

type Vars = Record<string, string>;

export const THEMES: { id: string; name: string; vars: Vars }[] = [
  {
    id: 'classic',
    name: 'Classic',
    vars: { bg: '#1c1a17', panel: '#26231f', 'panel-2': '#302c27', line: '#4a443b', text: '#ece6da', muted: '#a39a8a', gold: '#c9a227', ink: '#1c1a17', field: '#15130f', p1: '#3b7dd8', p2: '#d0453b' },
  },
  {
    id: 'shire',
    name: 'The Shire',
    vars: { bg: '#e6dbbf', panel: '#f3ebd3', 'panel-2': '#e6dab9', line: '#bfae86', text: '#33291b', muted: '#6d604a', gold: '#5b7b26', ink: '#ffffff', field: '#fffaf0', p1: '#2f6fbf', p2: '#b83a30' },
  },
  {
    id: 'gondor',
    name: 'Gondor',
    vars: { bg: '#10151f', panel: '#18202d', 'panel-2': '#212b3b', line: '#3a4659', text: '#e4e8ef', muted: '#98a3b5', gold: '#c8d2e0', ink: '#10151f', field: '#0c1018', p1: '#4a8be0', p2: '#d24c40' },
  },
  {
    id: 'rohan',
    name: 'Rohan',
    vars: { bg: '#191c12', panel: '#222619', 'panel-2': '#2c3121', line: '#4a4f37', text: '#efe8d2', muted: '#a9a385', gold: '#d9a53a', ink: '#191c12', field: '#12140c', p1: '#3f7fd0', p2: '#c9473c' },
  },
  {
    id: 'rivendell',
    name: 'Rivendell',
    vars: { bg: '#12201f', panel: '#182b2a', 'panel-2': '#203736', line: '#375655', text: '#e3f0ee', muted: '#93b3ae', gold: '#9fd8c9', ink: '#12201f', field: '#0d1817', p1: '#5b93e6', p2: '#db5a4c' },
  },
  {
    id: 'mordor',
    name: 'Mordor',
    vars: { bg: '#0f0b0a', panel: '#1a1311', 'panel-2': '#241a17', line: '#4a2f27', text: '#f0e2d8', muted: '#a88d80', gold: '#e0532a', ink: '#ffffff', field: '#0a0706', p1: '#4a86d8', p2: '#c23a2e' },
  },
  {
    id: 'isengard',
    name: 'Isengard',
    vars: { bg: '#121314', panel: '#1b1d1f', 'panel-2': '#25282b', line: '#43474c', text: '#e6e8ea', muted: '#9a9fa6', gold: '#d8dcdf', ink: '#121314', field: '#0d0e0f', p1: '#4a86d8', p2: '#cf3f34' },
  },
  {
    id: 'moria',
    name: 'Moria',
    vars: { bg: '#0d0e12', panel: '#15171d', 'panel-2': '#1d2029', line: '#363b4a', text: '#e2e4ec', muted: '#959aab', gold: '#8fa6ff', ink: '#0d0e12', field: '#090a0d', p1: '#4f8fe6', p2: '#d24a3e' },
  },
  {
    id: 'erebor',
    name: 'Erebor',
    vars: { bg: '#17130e', panel: '#211b14', 'panel-2': '#2c241a', line: '#4f4230', text: '#f2e7d3', muted: '#b19f80', gold: '#e8b53c', ink: '#17130e', field: '#100d09', p1: '#3f7fd4', p2: '#c8433a' },
  },
  {
    id: 'lothlorien',
    name: 'Lothlórien',
    vars: { bg: '#1b1a10', panel: '#252317', 'panel-2': '#302d1e', line: '#545037', text: '#f4efd8', muted: '#b6ad87', gold: '#e7cf6a', ink: '#1b1a10', field: '#13120b', p1: '#4d8ade', p2: '#cc4a3d' },
  },
  {
    id: 'fangorn',
    name: 'Fangorn',
    vars: { bg: '#121a12', panel: '#19231a', 'panel-2': '#212e22', line: '#3a4f3b', text: '#e3ecdf', muted: '#97ab94', gold: '#8fc46a', ink: '#121a12', field: '#0d130d', p1: '#4d8cdc', p2: '#c94a3c' },
  },
  {
    id: 'harad',
    name: 'Harad',
    vars: { bg: '#1c120c', panel: '#271910', 'panel-2': '#332116', line: '#5a3b26', text: '#f6e6d2', muted: '#bf9d7e', gold: '#e8a33a', ink: '#1c120c', field: '#140c08', p1: '#3f80d6', p2: '#b9322a' },
  },
  {
    id: 'rhun',
    name: 'Rhûn',
    vars: { bg: '#1a0f12', panel: '#24151a', 'panel-2': '#2f1c22', line: '#56323d', text: '#f3e3e6', muted: '#b9939b', gold: '#d9a441', ink: '#1a0f12', field: '#12090c', p1: '#4985da', p2: '#c73a3a' },
  },
  {
    id: 'angmar',
    name: 'Angmar',
    vars: { bg: '#0e1216', panel: '#151b21', 'panel-2': '#1d252d', line: '#36434f', text: '#e4ebf1', muted: '#93a3b2', gold: '#9fc3e0', ink: '#0e1216', field: '#0a0d10', p1: '#4f8fe4', p2: '#cf4a40' },
  },
  {
    id: 'dol-guldur',
    name: 'Dol Guldur',
    vars: { bg: '#100e14', panel: '#18151e', 'panel-2': '#211d29', line: '#3d354b', text: '#ebe5f2', muted: '#a397b3', gold: '#7fd17a', ink: '#100e14', field: '#0b0a0e', p1: '#4d8ce2', p2: '#cd463d' },
  },
];

const SYSTEM = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const HEADING_FONTS: { id: string; name: string; css: string }[] = [
  { id: 'cinzel', name: 'Cinzel (carved stone)', css: "'Cinzel', Georgia, serif" },
  { id: 'uncial', name: 'Uncial Antiqua (ancient script)', css: "'Uncial Antiqua', Georgia, serif" },
  { id: 'medieval', name: 'MedievalSharp (scribe)', css: "'MedievalSharp', Georgia, serif" },
  { id: 'almendra', name: 'Almendra (calligraphy)', css: "'Almendra', Georgia, serif" },
  { id: 'fell', name: 'IM Fell English (old book)', css: "'IM Fell English', Georgia, serif" },
  { id: 'system', name: 'Plain', css: SYSTEM },
];

export const BODY_FONTS: { id: string; name: string; css: string }[] = [
  { id: 'system', name: 'Plain (easiest to read)', css: SYSTEM },
  { id: 'alegreya', name: 'Alegreya (storybook)', css: "'Alegreya', Georgia, serif" },
  { id: 'garamond', name: 'EB Garamond (classic book)', css: "'EB Garamond', Georgia, serif" },
  { id: 'fell', name: 'IM Fell English (old book)', css: "'IM Fell English', Georgia, serif" },
  { id: 'almendra', name: 'Almendra (calligraphy)', css: "'Almendra', Georgia, serif" },
];

export interface Settings {
  theme: string;
  headingFont: string;
  bodyFont: string;
  photos: boolean;
  zones: boolean;
  deployment: boolean;
  grid: boolean;
  /** Unit names shown under each model on the table. */
  names: boolean;
  /** Moves glide, dice tumble, and wounds, deaths and shots show on the table. */
  animations: boolean;
}

const DEFAULTS: Settings = { theme: 'classic', headingFont: 'cinzel', bodyFont: 'system', photos: true, zones: true, deployment: true, grid: true, names: false, animations: true };
const KEY = 'mesbg-tabletop:settings';

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

function apply(s: Settings) {
  const root = document.documentElement;
  const theme = THEMES.find(t => t.id === s.theme) ?? THEMES[0];
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(`--${k}`, v);
  root.style.setProperty('--p1-soft', `${theme.vars.p1}55`);
  root.style.setProperty('--p2-soft', `${theme.vars.p2}55`);
  root.style.setProperty('--font-head', (HEADING_FONTS.find(f => f.id === s.headingFont) ?? HEADING_FONTS[0]).css);
  root.style.setProperty('--font-body', (BODY_FONTS.find(f => f.id === s.bodyFont) ?? BODY_FONTS[0]).css);
  root.classList.toggle('no-anim', !s.animations);
  root.style.colorScheme = s.theme === 'shire' ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.vars.panel);
}

/** This viewer's display preferences. They live in the browser and don't affect the other player. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);
  useEffect(() => {
    apply(settings);
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // Storage unavailable; settings last for this visit only.
    }
  }, [settings]);
  const update = (patch: Partial<Settings>) => setSettings(s => ({ ...s, ...patch }));
  return [settings, update] as const;
}
