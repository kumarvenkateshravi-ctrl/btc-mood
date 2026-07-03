/**
 * Chart smoke tests — Playwright Component Testing.
 *
 * Locks the current Chart.tsx behavior as a contract so the three remaining
 * core-effect extractions (useChartHost, useCandleData, useIndicatorStack)
 * can be verified without a manual browser click-through.
 *
 * Uses ChartHarness (a test wrapper) that exposes callback invocations via
 * DOM data attributes — readable via page.locator(), avoiding window/iframe
 * context ambiguity in Playwright CT.
 */
import { test, expect } from '@playwright/experimental-ct-react';
import hooksConfig from './hooks';
import { ChartHarness } from './ChartHarness';
import { CUSTOM_INDICATORS } from '../../lib/customIndicatorsLibrary';
import type { Candle } from '../../lib/types';

// ─── Mock data ───────────────────────────────────────────────

function makeCandles(count = 200, intervalSec = 300, startPrice = 100_000): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - count * intervalSec;
  for (let i = 0; i < count; i++) {
    const time = startTime + i * intervalSec;
    const drift = Math.sin(i * 0.25) * 350 + Math.cos(i * 0.11) * 150;
    const open = price;
    const close = Math.max(1, price + drift);
    const wick = Math.abs(Math.sin(i * 0.7)) * 80 + 20;
    const high = Math.max(open, close) + wick;
    const low = Math.max(1, Math.min(open, close) - wick);
    const volume = 500 + Math.abs(Math.sin(i * 0.4)) * 300;
    candles.push({ time, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

const CANDLES = makeCandles();
const rsiDef = CUSTOM_INDICATORS.find((d) => d.id === 'rsi')!;
const rsiResult = rsiDef.compute(CANDLES, { id: 'rsi' });

// ─── Helpers ─────────────────────────────────────────────────

async function mountHarness(
  mount: (c: React.JSX.Element, o?: { hooksConfig?: unknown }) => Promise<any>,
  props: Record<string, unknown> = {},
) {
  return await mount(
    <ChartHarness candles={CANDLES} {...props} />,
    { hooksConfig },
  );
}

/** Read a data attribute from the hidden test-state div. */
async function readState(page: import('@playwright/test').Page, attr: string): Promise<string> {
  const el = page.getByTestId('test-state');
  return await el.getAttribute(attr) ?? '';
}

/** Poll a data attribute until it matches a predicate. */
async function waitForState(
  page: import('@playwright/test').Page,
  attr: string,
  predicate: (v: string) => boolean,
  timeout = 15_000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const val = await readState(page, attr);
    if (predicate(val)) return val;
    await page.waitForTimeout(200);
  }
  const final = await readState(page, attr);
  throw new Error(`waitForState timed out: ${attr}="${final}" did not satisfy predicate after ${timeout}ms`);
}

// ─── Tests ───────────────────────────────────────────────────

test.describe('Chart smoke', () => {

  // ── 1. Chart renders candles + canvas exists ──────────────
  test('renders a canvas and the OHLC strip', async ({ page, mount }) => {
    await mountHarness(mount);
    await page.waitForTimeout(1000);

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);

    const strip = page.locator('[aria-label="Chart OHLCV"]');
    await expect(strip).toBeVisible();
  });

  // ── 2. onReady fires ──────────────────────────────────────
  test('onReady fires (ChartApi is initialized)', async ({ page, mount }) => {
    await mountHarness(mount);
    await waitForState(page, 'data-api-ready', (v) => v === 'true');
  });

  // ── 3. Buy / Sell buttons fire onQuickTrade ───────────────
  test('Buy and Sell buttons fire onQuickTrade', async ({ page, mount }) => {
    await mountHarness(mount);
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: /Buy/ }).first().click();
    await page.getByRole('button', { name: /Sell/ }).first().click();

    await waitForState(page, 'data-quick-trade', (v) => v === 'buy,sell');
  });

  // ── 4. Right-click fires onChartContextMenu with a price ──
  test('right-click fires onChartContextMenu with a price', async ({ page, mount }) => {
    await mountHarness(mount);
    await page.waitForTimeout(500);

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    await page.mouse.click(box!.x + 200, box!.y + 200, { button: 'right' });

    await waitForState(page, 'data-ctx-price', (v) => v !== '' && Number(v) > 0, 10_000);
    const px = await readState(page, 'data-ctx-price');
    const cx = await readState(page, 'data-ctx-x');
    const cy = await readState(page, 'data-ctx-y');
    expect(Number(px)).toBeGreaterThan(0);
    expect(Number(cx)).toBeGreaterThan(0);
    expect(Number(cy)).toBeGreaterThan(0);
  });

  // ── 5. onLoadOlder fires when range.from < 10 ─────────────
  test('onLoadOlder fires when scrolled to the left edge', async ({ page, mount }) => {
    await mountHarness(mount, { candles: CANDLES.slice(0, 15) });
    await waitForState(page, 'data-load-older', (v) => Number(v) >= 1);
  });

  // ── 6. Oscillator indicator renders + legend shows name ───
  test('RSI oscillator renders without crash and legend shows name', async ({ page, mount }) => {
    await mountHarness(mount, {
      activeIndicatorIds: ['rsi'],
      indicatorResults: [{ key: 'rsi', result: rsiResult }],
    });
    await page.waitForTimeout(1000);

    await expect(page.locator('text=RSI').first()).toBeVisible({ timeout: 5_000 });
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    // A separate-pane indicator creates a second pane (extra canvas).
    const canvasCount = await page.locator('canvas').count();
    expect(canvasCount).toBeGreaterThanOrEqual(2);
  });

  // ── 7. Theme switch preserves zoom ────────────────────────
  test('theme switch preserves the visible logical range', async ({ page, mount }) => {
    await mountHarness(mount);
    await waitForState(page, 'data-api-ready', (v) => v === 'true');

    // Snapshot the range before theme switch (click via JS — button is off-screen).
    await page.getByTestId('snapshot-range').evaluate((el: HTMLButtonElement) => el.click());
    await waitForState(page, 'data-range', (v) => v !== '' && v !== 'null');
    const rangeBefore = await readState(page, 'data-range');

    // Switch to Bitcoin theme (triggers useThemeName's MutationObserver).
    // The harness component runs inside the CT page/iframe — set the attribute
    // on the document that the component's MutationObserver watches.
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'bitcoin');
    });
    await page.waitForTimeout(1500);

    // Snapshot the range after theme switch.
    await page.getByTestId('snapshot-range').evaluate((el: HTMLButtonElement) => el.click());
    await page.waitForTimeout(500);
    const rangeAfter = await readState(page, 'data-range');

    expect(rangeAfter).not.toBe('');
    expect(rangeAfter).not.toBe('null');
    const [fromBefore, toBefore] = rangeBefore.split(',').map(Number);
    const [fromAfter, toAfter] = rangeAfter.split(',').map(Number);
    expect(fromAfter).toBeCloseTo(fromBefore, 1);
    expect(toAfter).toBeCloseTo(toBefore, 1);
  });

  // ── 8. Crosshair hover updates the OHLC strip ─────────────
  test('hovering the chart updates the OHLC strip from — to values', async ({ page, mount }) => {
    await mountHarness(mount);
    await page.waitForTimeout(500);

    const strip = page.locator('[aria-label="Chart OHLCV"]');
    await expect(strip).toContainText('—');

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    await page.mouse.move(box!.x + 250, box!.y + 200);
    await page.waitForTimeout(500);

    const text = await strip.textContent();
    expect(text).not.toContain('—');
  });
});
