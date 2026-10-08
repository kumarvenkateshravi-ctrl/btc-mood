// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DrawingLayer from './DrawingLayer';
import type { ChartApi } from './Chart';
import {
  __resetDrawingsForTest,
  addDrawing,
  getDrawings,
  redo,
  undo,
  type Drawing,
  type DrawingType,
  type Tool,
} from '@/lib/drawings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_KEY = 'btc-mood:drawings:v1';
const api: ChartApi = {
  fitContent: vi.fn(),
  timeToX: (time) => time,
  priceToY: (price) => price,
  xToTime: (x) => x,
  yToPrice: (y) => y,
  candleAtX: () => null,
  logicalAt: (x) => x,
  subscribe: () => () => {},
  setVisibleLogicalRange: vi.fn(),
  getVisibleLogicalRange: () => null,
  setCrosshairTime: vi.fn(),
  subscribeLogicalRange: () => () => {},
  subscribeCrosshairTime: () => () => {},
};

const pointer = (
  type: string,
  x: number,
  y: number,
  options: { pointerId?: number; pointerType?: string; isPrimary?: boolean } = {},
) => new PointerEvent(type, {
  bubbles: true,
  cancelable: true,
  button: 0,
  buttons: type === 'pointerup' ? 0 : 1,
  clientX: x,
  clientY: y,
  pointerId: options.pointerId ?? 1,
  pointerType: options.pointerType ?? 'mouse',
  isPrimary: options.isPrimary ?? true,
});

interface MountedLayer {
  host: HTMLDivElement;
  root: Root;
  svg: SVGSVGElement;
  used: ReturnType<typeof vi.fn>;
  render: (tool: Tool, symbol?: string, context?: string) => Promise<void>;
  unmount: () => Promise<void>;
}

interface LayerOptions {
  chartApi?: ChartApi;
  color?: string;
  magnet?: boolean;
  locked?: boolean;
}

async function mountLayer(tool: Tool, symbol = 'BTCUSDT', options: LayerOptions = {}): Promise<MountedLayer> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const used = vi.fn();
  const render = async (nextTool: Tool, nextSymbol = symbol, context = `${nextSymbol}:5m:live`) => {
    await act(async () => {
      root.render(
        <DrawingLayer
          api={options.chartApi ?? api}
          symbol={nextSymbol}
          tool={nextTool}
          color={options.color ?? '#5aa2e6'}
          magnet={options.magnet ?? false}
          locked={options.locked ?? false}
          hidden={false}
          width={500}
          height={300}
          revision={1}
          creationContextKey={context}
          onToolUsed={used}
        />,
      );
    });
    const svg = host.querySelector<SVGSVGElement>('[data-testid="drawing-layer"]');
    if (!svg) throw new Error('drawing layer did not render');
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 500, bottom: 300, width: 500, height: 300, toJSON: () => ({}) }),
    });
  };
  await render(tool, symbol);
  return {
    host,
    root,
    svg: host.querySelector('[data-testid="drawing-layer"]')!,
    used,
    render,
    unmount: async () => { await act(async () => root.unmount()); host.remove(); },
  };
}

async function dispatch(target: EventTarget, event: Event): Promise<void> {
  await act(async () => { target.dispatchEvent(event); });
}

async function clickAnchor(svg: SVGSVGElement, x: number, y: number, pointerType = 'mouse'): Promise<void> {
  await dispatch(svg, pointer('pointerdown', x, y, { pointerType }));
  await dispatch(svg, pointer('pointerup', x, y, { pointerType }));
}

beforeEach(() => __resetDrawingsForTest());

describe('DrawingLayer shared anchor creation', () => {
  it.each([
    ['trendline', 'line'],
    ['ray', 'line'],
    ['rectangle', 'rect'],
    ['fib', 'line'],
    ['measure', 'rect'],
  ] as const)('%s uses click, release, preview, click, release and persists once', async (tool, _shape) => {
    const layer = await mountLayer(tool);
    await clickAnchor(layer.svg, 20, 40);
    expect(getDrawings('BTCUSDT')).toHaveLength(0);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(layer.host.querySelector('[data-testid="drawing-creation-hint"]')).not.toBeNull();

    await dispatch(layer.svg, pointer('pointermove', 120, 160));
    expect(layer.svg.dataset.creationPhase).toBe('previewing');
    expect(getDrawings('BTCUSDT')).toHaveLength(0);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    await clickAnchor(layer.svg, 120, 160);
    expect(getDrawings('BTCUSDT')).toMatchObject([{ type: tool, points: [{ time: 20, price: 40 }, { time: 120, price: 160 }] }]);
    expect(layer.used).toHaveBeenCalledOnce();
    undo('BTCUSDT');
    expect(getDrawings('BTCUSDT')).toHaveLength(0);
    redo('BTCUSDT');
    expect(getDrawings('BTCUSDT')).toHaveLength(1);
    await layer.unmount();
  });

  it('horizontal line commits from one click without pointer movement', async () => {
    const layer = await mountLayer('horizontal');
    await clickAnchor(layer.svg, 30, 90);
    expect(getDrawings('BTCUSDT')).toMatchObject([{ type: 'horizontal', points: [{ time: 30, price: 90 }] }]);
    expect(layer.used).toHaveBeenCalledOnce();
    await layer.unmount();
  });

  it('text uses one placement click and persists only after editor submission', async () => {
    const layer = await mountLayer('text');
    await clickAnchor(layer.svg, 70, 80);
    expect(getDrawings('BTCUSDT')).toHaveLength(0);
    const input = layer.host.querySelector<HTMLInputElement>('[aria-label="Drawing text"]')!;
    expect(input).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Breakout');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const form = layer.host.querySelector<HTMLFormElement>('[data-testid="drawing-text-editor"]')!;
    await dispatch(form, new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    expect(getDrawings('BTCUSDT')).toMatchObject([{ type: 'text', text: 'Breakout', points: [{ time: 70, price: 80 }] }]);
    await layer.unmount();
  });

  it('touch uses tap anchors and multi-touch cannot commit', async () => {
    const layer = await mountLayer('rectangle');
    await clickAnchor(layer.svg, 25, 35, 'touch');
    await clickAnchor(layer.svg, 125, 135, 'touch');
    expect(getDrawings('BTCUSDT')).toHaveLength(1);
    await layer.unmount();

    __resetDrawingsForTest();
    const pinch = await mountLayer('rectangle');
    await dispatch(pinch.svg, pointer('pointerdown', 20, 30, { pointerId: 1, pointerType: 'touch', isPrimary: true }));
    await dispatch(pinch.svg, pointer('pointerdown', 80, 90, { pointerId: 2, pointerType: 'touch', isPrimary: false }));
    await dispatch(pinch.svg, pointer('pointerup', 80, 90, { pointerId: 2, pointerType: 'touch', isPrimary: false }));
    await dispatch(pinch.svg, pointer('pointerup', 20, 30, { pointerId: 1, pointerType: 'touch', isPrimary: true }));
    expect(getDrawings('BTCUSDT')).toHaveLength(0);
    await pinch.unmount();
  });

  it.each([
    ['horizontal', 1],
    ['trendline', 2],
    ['ray', 2],
    ['rectangle', 2],
    ['fib', 2],
    ['measure', 2],
  ] as const)('%s supports the registered tap-anchor flow', async (tool, anchors) => {
    const layer = await mountLayer(tool);
    await clickAnchor(layer.svg, 20, 40, 'touch');
    if (anchors === 2) await clickAnchor(layer.svg, 120, 160, 'touch');
    expect(getDrawings('BTCUSDT')).toMatchObject([{ type: tool }]);
    await layer.unmount();
  });

  it('text placement opens its editor from a touch tap', async () => {
    const layer = await mountLayer('text');
    await clickAnchor(layer.svg, 70, 80, 'touch');
    expect(layer.host.querySelector('[data-testid="drawing-text-editor"]')).not.toBeNull();
    expect(getDrawings('BTCUSDT')).toHaveLength(0);
    await layer.unmount();
  });

  it('Escape, tool change, symbol change, and unmount discard unfinished drafts', async () => {
    const layer = await mountLayer('rectangle');
    await clickAnchor(layer.svg, 20, 40);
    await dispatch(window, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(getDrawings('BTCUSDT')).toHaveLength(0);
    expect(layer.host.querySelector('[data-testid="drawing-creation-hint"]')).toBeNull();

    await clickAnchor(layer.svg, 30, 50);
    await layer.render('fib');
    expect(getDrawings('BTCUSDT')).toHaveLength(0);
    expect(layer.svg.dataset.creationPhase).toBe('armed');

    await clickAnchor(layer.svg, 40, 60);
    await layer.render('fib', 'BTCUSDT', 'BTCUSDT:15m:live');
    expect(getDrawings('BTCUSDT')).toHaveLength(0);
    expect(layer.svg.dataset.creationPhase).toBe('armed');

    await clickAnchor(layer.svg, 45, 65);
    await layer.render('fib', 'ETHUSDT', 'ETHUSDT:5m:live');
    expect(getDrawings('BTCUSDT')).toHaveLength(0);
    expect(getDrawings('ETHUSDT')).toHaveLength(0);

    await clickAnchor(layer.svg, 50, 70);
    await layer.unmount();
    expect(getDrawings('ETHUSDT')).toHaveLength(0);
  });

  it('the compact Cancel action discards a touch draft and exits drawing ownership', async () => {
    const layer = await mountLayer('rectangle');
    await clickAnchor(layer.svg, 25, 35, 'touch');
    const cancel = layer.host.querySelector<HTMLButtonElement>('[data-testid="drawing-creation-hint"] button')!;
    await act(async () => cancel.click());
    expect(getDrawings('BTCUSDT')).toHaveLength(0);
    expect(layer.host.querySelector('[data-testid="drawing-creation-hint"]')).toBeNull();
    expect(layer.used).toHaveBeenCalledOnce();
    await layer.unmount();
  });

  it('right-click cancels an unfinished drawing', async () => {
    const layer = await mountLayer('fib');
    await clickAnchor(layer.svg, 25, 35);
    await dispatch(layer.svg, new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(getDrawings('BTCUSDT')).toHaveLength(0);
    expect(layer.used).toHaveBeenCalledOnce();
    await layer.unmount();
  });

  it('rejects zero-size geometry without history or persistence writes', async () => {
    const layer = await mountLayer('trendline');
    await clickAnchor(layer.svg, 40, 60);
    await clickAnchor(layer.svg, 40, 60);
    expect(getDrawings('BTCUSDT')).toHaveLength(0);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(layer.svg.dataset.creationPhase).toBe('anchor-placement');
    await layer.unmount();
  });

  it('uses the existing magnet resolver for preview and committed anchors', async () => {
    const snappingApi: ChartApi = {
      ...api,
      candleAtX: () => ({ time: 20, open: 40, high: 80, low: 20, close: 60, volume: 1 }),
    };
    const layer = await mountLayer('trendline', 'BTCUSDT', { chartApi: snappingApi, magnet: true });
    await clickAnchor(layer.svg, 20, 43);
    await dispatch(layer.svg, pointer('pointermove', 120, 76));
    expect(getDrawings('BTCUSDT')).toHaveLength(0);
    await clickAnchor(layer.svg, 120, 76);
    expect(getDrawings('BTCUSDT')[0].points).toEqual([
      { time: 20, price: 40 },
      { time: 120, price: 80 },
    ]);
    await layer.unmount();
  });
});

describe('DrawingLayer editing regression', () => {
  it('keeps delete, undo, and redo as one committed-drawing history action', async () => {
    addDrawing('BTCUSDT', { id: 'delete-me', type: 'horizontal', points: [{ time: 20, price: 40 }], color: '#5aa2e6' });
    const layer = await mountLayer('cursor');
    const target = layer.host.querySelector('line[stroke="transparent"]')!;
    await dispatch(target, pointer('pointerdown', 20, 40));
    await dispatch(window, pointer('pointerup', 20, 40));
    await dispatch(window, new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(getDrawings('BTCUSDT')).toHaveLength(0);
    undo('BTCUSDT');
    expect(getDrawings('BTCUSDT')).toHaveLength(1);
    redo('BTCUSDT');
    expect(getDrawings('BTCUSDT')).toHaveLength(0);
    await layer.unmount();
  });

  it('preserves drawing lock behavior for drag and keyboard deletion', async () => {
    const original = { id: 'locked', type: 'trendline' as const, points: [{ time: 20, price: 40 }, { time: 120, price: 160 }], color: '#5aa2e6' };
    addDrawing('BTCUSDT', original);
    const layer = await mountLayer('cursor', 'BTCUSDT', { locked: true });
    const target = layer.host.querySelector('line[stroke="transparent"]')!;
    await dispatch(target, pointer('pointerdown', 20, 40));
    await dispatch(window, pointer('pointermove', 80, 90));
    await dispatch(window, pointer('pointerup', 80, 90));
    await dispatch(window, new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(getDrawings('BTCUSDT')).toEqual([original]);
    await layer.unmount();
  });

  it('touch selects a completed drawing without creating another drawing or history entry', async () => {
    addDrawing('BTCUSDT', { id: 'touch-select', type: 'trendline', points: [{ time: 20, price: 40 }, { time: 120, price: 160 }], color: '#5aa2e6' });
    const layer = await mountLayer('cursor');
    const target = layer.host.querySelector('line[stroke="transparent"]')!;
    await dispatch(target, pointer('pointerdown', 20, 40, { pointerType: 'touch' }));
    await dispatch(window, pointer('pointerup', 20, 40, { pointerType: 'touch' }));
    expect(layer.host.querySelectorAll('circle')).toHaveLength(2);
    expect(getDrawings('BTCUSDT')).toHaveLength(1);
    await layer.unmount();
  });

  it.each([
    ['horizontal', [{ time: 20, price: 40 }], 'line[stroke="transparent"]', 20, 40],
    ['trendline', [{ time: 20, price: 40 }, { time: 120, price: 160 }], 'line[stroke="transparent"]', 20, 40],
    ['ray', [{ time: 20, price: 40 }, { time: 120, price: 160 }], 'line[stroke="transparent"]', 20, 40],
    ['rectangle', [{ time: 20, price: 40 }, { time: 120, price: 160 }], 'rect[fill="transparent"]', 70, 100],
    ['fib', [{ time: 20, price: 40 }, { time: 120, price: 160 }], 'line[stroke="transparent"]', 20, 40],
    ['measure', [{ time: 20, price: 40 }, { time: 120, price: 160 }], 'line[stroke="transparent"]', 20, 40],
    ['text', [{ time: 20, price: 40 }], 'text', 20, 40],
  ] as const)('%s remains draggable after the creation upgrade', async (type, points, selector, startX, startY) => {
    const drawing: Drawing = { id: `edit-${type}`, type: type as DrawingType, points: [...points], color: '#5aa2e6', ...(type === 'text' ? { text: 'Note' } : {}) };
    addDrawing('BTCUSDT', drawing);
    const layer = await mountLayer('cursor');
    const target = layer.host.querySelector(selector)!;
    await dispatch(target, pointer('pointerdown', startX, startY));
    await dispatch(window, pointer('pointermove', startX + 15, startY + 20));
    await dispatch(window, pointer('pointerup', startX + 15, startY + 20));
    expect(getDrawings('BTCUSDT')[0].points).not.toEqual(points);
    await layer.unmount();
  });
});
