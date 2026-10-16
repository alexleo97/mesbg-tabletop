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
  grid: boolean;
}

const DEFAULTS: Settings = { theme: 'classic', headingFont: 'cinzel', bodyFont: 'system', photos: true, zones: true, grid: true };
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
