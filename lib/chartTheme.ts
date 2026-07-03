// Chart theming. lightweight-charts paints on <canvas>, so CSS variables
// can't reach it — and browsers now keep computed colors in oklch(), which
// the library's parser rejects. So each MDS theme ships an explicit hex
// palette here, mirroring the semantic tokens in app/globals.css. If a
// theme's tokens change there, update its palette here.
//
// `useThemeName()` watches <html data-theme> so a live chart re-skins the
// moment the user switches themes — no remount, zoom state preserved.

import { useEffect, useState } from 'react';
import { DEFAULT_THEME, isTheme, type Theme } from './theme';

export interface ChartPalette {
  /** Canvas + pane chrome */
  chartBg: string;
  text: string;
  textFaint: string;
  grid: string;
  border: string;
  /** Crosshair. Label ink is auto-contrast (the library picks it). */
  crosshairLine: string;
  crosshairLabelBg: string;
  /** Candles */
  bullFace: string;
  bullTop: string;
  bullSide: string;
  bullWick: string;
  bearFace: string;
  bearTop: string;
  bearSide: string;
  bearWick: string;
  /** BUY/SELL flip markers */
  markerBuy: string;
  markerSell: string;
  /** Last-price axis card. 'direction' = color by candle direction
   *  (the TradingView convention); a hex pins it to a brand color
   *  (the Bitcoin theme's gold tag — its signature). */
  priceCardBg: 'direction' | (string & {});
  priceCardInk: string;
  priceCardSubInk: string;
  /** Session/day separator stroke */
  daySep: string;
  /** Corner vignette color stop */
  vignette: string;
  /** Categorical data-viz palette (DESIGN.md D2: max 6) */
  dv1: string;
  dv2: string;
  dv3: string;
  dv4: string;
  dv5: string;
  dv6: string;
}

const TV_CANDLES = {
  bullFace: '#089981',
  bullTop: '#28b9a1',
  bullSide: '#007961',
  bullWick: '#089981',
  bearFace: '#f23645',
  bearTop: '#ff5665',
  bearSide: '#d21625',
  bearWick: '#f23645',
  markerBuy: '#28b9a1',
  markerSell: '#ff5665',
} as const;

export const CHART_PALETTES: Record<Theme, ChartPalette> = {
  /* Obsidian Indigo — the :root default (previous hardcoded values). */
  obsidian: {
    chartBg: '#11151f',
    text: '#d1d4dc',
    textFaint: '#7b88a0',
    grid: 'rgba(209, 212, 220, 0.06)', // --ink at 6%
    border: '#2a3247',
    crosshairLine: '#7b88a0',
    crosshairLabelBg: '#11151f',
    ...TV_CANDLES,
    priceCardBg: 'direction',
    priceCardInk: '#ffffff',
    priceCardSubInk: 'rgba(255, 255, 255, 0.8)',
    daySep: 'rgba(82, 133, 195, 0.70)',
    vignette: 'rgba(10, 14, 22, 0.45)',
    dv1: '#5aa2e6', dv2: '#b7a8f5', dv3: '#089981', dv4: '#f0b90b', dv5: '#f23645', dv6: '#3e6ef5',
  },

  /* CryptoVision — neutral charcoal, lavender accent. */
  cryptovision: {
    chartBg: '#131316',
    text: '#d4d4d8',
    textFaint: '#85858d',
    grid: 'rgba(212, 212, 216, 0.06)', // --ink at 6%
    border: '#2f2f35',
    crosshairLine: '#85858d',
    crosshairLabelBg: '#131316',
    ...TV_CANDLES,
    priceCardBg: 'direction',
    priceCardInk: '#ffffff',
    priceCardSubInk: 'rgba(255, 255, 255, 0.8)',
    daySep: 'rgba(183, 168, 245, 0.40)',
    vignette: 'rgba(8, 8, 10, 0.45)',
    dv1: '#b7a8f5', dv2: '#5aa2e6', dv3: '#00d68f', dv4: '#f0b90b', dv5: '#ff5570', dv6: '#3e6ef5',
  },

  /* Cobalt — navy canvas, royal-blue accent. */
  cobalt: {
    chartBg: '#161d2c',
    text: '#d6dced',
    textFaint: '#7f8aa3',
    grid: 'rgba(214, 220, 237, 0.06)', // --ink at 6%
    border: '#2e3a52',
    crosshairLine: '#7f8aa3',
    crosshairLabelBg: '#161d2c',
    ...TV_CANDLES,
    priceCardBg: 'direction',
    priceCardInk: '#ffffff',
    priceCardSubInk: 'rgba(255, 255, 255, 0.8)',
    daySep: 'rgba(62, 110, 245, 0.45)',
    vignette: 'rgba(6, 10, 18, 0.45)',
    dv1: '#3e6ef5', dv2: '#b7a8f5', dv3: '#00d68f', dv4: '#f0b90b', dv5: '#ff5570', dv6: '#5aa2e6',
  },

  /* Bitcoin — warm charcoal, vibrant signal greens, and the theme's
     signature: a GOLD last-price tag + gold crosshair labels, matching
     the reference design this theme is built from. */
  bitcoin: {
    chartBg: '#16130e',
    text: '#d6cfc0',
    textFaint: '#8a8272',
    grid: 'rgba(214, 207, 192, 0.06)', // --ink at 6%
    border: '#363023',
    crosshairLine: '#8a8272',
    crosshairLabelBg: '#16130e',
    bullFace: '#00b882',
    bullTop: '#00d68f',
    bullSide: '#008f63',
    bullWick: '#00b882',
    bearFace: '#ff3b5c',
    bearTop: '#ff5570',
    bearSide: '#d62a48',
    bearWick: '#ff3b5c',
    markerBuy: '#00d68f',
    markerSell: '#ff5570',
    priceCardBg: '#f0b90b',
    priceCardInk: '#1a1508',
    priceCardSubInk: 'rgba(26, 21, 8, 0.72)',
    daySep: 'rgba(240, 185, 11, 0.30)',
    vignette: 'rgba(10, 8, 5, 0.45)',
    dv1: '#f0b90b', dv2: '#3e6ef5', dv3: '#b7a8f5', dv4: '#00d68f', dv5: '#ff5570', dv6: '#5aa2e6',
  },

  /* Material Dark — flipped scheme (lighter canvas, darker cards),
     Android-style purple + teal accents. */
  material: {
    chartBg: '#11212D',
    text: '#B0B0B0',
    textFaint: '#808080',
    grid: 'rgba(255, 255, 255, 0.06)',
    border: '#243A4A',
    crosshairLine: '#808080',
    crosshairLabelBg: '#11212D',
    ...TV_CANDLES,
    priceCardBg: 'direction',
    priceCardInk: '#ffffff',
    priceCardSubInk: 'rgba(255, 255, 255, 0.8)',
    daySep: 'rgba(187, 134, 252, 0.40)',
    vignette: 'rgba(4, 12, 18, 0.45)',
    dv1: '#BB86FC', dv2: '#80CBC4', dv3: '#089981', dv4: '#f0b90b', dv5: '#f23645', dv6: '#3e6ef5',
  },

  /* Lorento — deep slate, soft radii, vibrant violet accent. */
  lorento: {
    chartBg: '#1A1C20',
    text: '#c6c9d1',
    textFaint: '#5C5F6A',
    grid: 'rgba(255, 255, 255, 0.05)',
    border: '#33353E',
    crosshairLine: '#8F939E',
    crosshairLabelBg: '#111317',
    ...TV_CANDLES,
    priceCardBg: 'direction',
    priceCardInk: '#ffffff',
    priceCardSubInk: 'rgba(255, 255, 255, 0.8)',
    daySep: 'rgba(103, 90, 255, 0.40)',
    vignette: 'rgba(8, 9, 12, 0.45)',
    dv1: '#675AFF', dv2: '#8378FF', dv3: '#089981', dv4: '#f0b90b', dv5: '#f23645', dv6: '#5aa2e6',
  },
};

export function getChartPalette(theme: Theme): ChartPalette {
  return CHART_PALETTES[theme] ?? CHART_PALETTES[DEFAULT_THEME];
}

/** The active MDS theme, live. Reads <html data-theme> and re-renders on
 *  change via MutationObserver (theme switching happens outside React). */
export function useThemeName(): Theme {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => {
      const t = el.getAttribute('data-theme');
      setTheme(isTheme(t) ? t : DEFAULT_THEME);
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return theme;
}
