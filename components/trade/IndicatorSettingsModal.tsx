'use client';

import { useState, useEffect, useRef } from 'react';
import { X, HelpCircle } from 'lucide-react';
import type { CustomIndicatorDef } from '@/lib/customIndicatorsLibrary';
import type { IndicatorSettings } from '@/lib/indicatorFramework';

interface IndicatorSettingsModalProps {
  indicatorDef: CustomIndicatorDef;
  initialSettings?: IndicatorSettings;
  activeIndicatorsContext?: { id: string; name: string; plots: { id: string; title: string }[] }[];
  onClose: () => void;
  onSave: (settings: IndicatorSettings) => void;
}

type Tab = 'Inputs' | 'Style' | 'Visibility';

// ── COLOR PICKER UTILS & COMPONENT ───────────────────────────────────────
function hexToRgba(hex: string): { r: number, g: number, b: number, a: number } {
  if (!hex) return { r: 0, g: 0, b: 0, a: 1 };
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  const a = h.length === 8 ? (parseInt(h.substring(6, 8), 16) / 255) : 1;
  return { r, g, b, a };
}

function rgbaToHex(r: number, g: number, b: number, a: number): string {
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${a < 1 ? toHex(a * 255) : ''}`;
}

const TV_COLORS = [
  '#ffffff', '#d1d4dc', '#b2b5be', '#9598a1', '#787b86', '#5d606b', '#434651', '#2a2e39', '#1e222d', '#000000',
  '#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#673ab7', '#9c27b0', '#e91e63',
  '#fccbcd', '#ffe0b2', '#fff59d', '#c8e6c9', '#b2dfdb', '#b2ebf2', '#bbdefb', '#d1c4e9', '#e1bee7', '#f8bbd0',
  '#ef5350', '#ffb74d', '#fff176', '#81c784', '#4db6ac', '#4dd0e1', '#64b5f6', '#9575cd', '#ba68c8', '#f06292',
  '#e53935', '#f57c00', '#fbc02d', '#388e3c', '#00897b', '#00acc1', '#1e88e5', '#5e35b1', '#8e24aa', '#d81b60',
  '#c62828', '#e65100', '#f57f17', '#1b5e20', '#004d40', '#006064', '#0d47a1', '#311b92', '#4a148c', '#880e4f',
];

interface ColorPickerPopoverProps {
  color: string;
  thickness?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  onColorChange: (c: string) => void;
  onThicknessChange?: (t: number) => void;
  onLineStyleChange?: (s: 'solid' | 'dashed' | 'dotted') => void;
  onClose: () => void;
}

function ColorPickerPopover({
  color, thickness, lineStyle, onColorChange, onThicknessChange, onLineStyleChange, onClose
}: ColorPickerPopoverProps) {
  const parsed = hexToRgba(color);
  const opacity = Math.round(parsed.a * 100);
  const popoverRef = useRef<HTMLDivElement>(null);
  const nativePickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClickOutside, true), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [onClose]);

  return (
    <div ref={popoverRef} className="absolute right-0 top-full mt-2 z-[60] w-[276px] rounded-lg bg-[#1e222d] border border-[#434651] shadow-[0_10px_30px_rgba(0,0,0,0.8)] p-4 flex flex-col gap-4 cursor-default" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
      {/* Grid */}
      <div className="grid grid-cols-10 gap-1">
        {TV_COLORS.map(hex => (
          <button
            key={hex}
            className="w-5 h-5 rounded-[3px] border border-[#363a45] hover:border-white focus:outline-none transition-colors"
            style={{ backgroundColor: hex }}
            onClick={() => {
              const c = hexToRgba(hex);
              onColorChange(rgbaToHex(c.r, c.g, c.b, parsed.a));
            }}
          />
        ))}
      </div>
      
      {/* Custom Color Add */}
      <div className="flex items-center">
        <button 
          onClick={() => nativePickerRef.current?.click()}
          className="flex h-[22px] w-[22px] items-center justify-center rounded-[3px] border border-[#363a45] text-[#d1d4dc] hover:border-[#787b86] hover:text-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M6 1V11M1 6H11" />
          </svg>
        </button>
        <input 
          ref={nativePickerRef}
          type="color" 
          className="sr-only pointer-events-none"
          onChange={(e) => {
            const c = hexToRgba(e.target.value);
            onColorChange(rgbaToHex(c.r, c.g, c.b, parsed.a));
          }}
        />
      </div>

      <div className="h-px bg-[#2a2e39] -mx-4" />

      {/* Opacity */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] text-[#787b86]">Opacity</span>
        <div className="flex items-center gap-3">
          <input 
            type="range" min="0" max="100" value={opacity} 
            onChange={(e) => onColorChange(rgbaToHex(parsed.r, parsed.g, parsed.b, parseInt(e.target.value)/100))}
            className="flex-1 accent-[#2962FF] h-1 bg-[#434651] rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#2962FF]"
          />
          <div className="flex items-center justify-center w-[50px] h-[26px] rounded bg-[#131722] border border-[#363a45] text-[12px] text-[#d1d4dc]">
            {opacity}%
          </div>
        </div>
      </div>

      {/* Thickness */}
      {onThicknessChange && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] text-[#787b86]">Thickness</span>
          <div className="flex rounded-[4px] border border-[#363a45] overflow-hidden bg-[#131722]">
            {[1, 2, 3, 4].map(t => (
              <button
                key={t}
                className={`flex-1 flex items-center justify-center h-[26px] border-r border-[#363a45] last:border-r-0 hover:bg-[#2a2e39] transition-colors ${thickness === t ? 'bg-[#2a2e39]' : ''}`}
                onClick={() => onThicknessChange(t)}
              >
                <div className="bg-[#d1d4dc] w-5" style={{ height: t }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Line Style */}
      {onLineStyleChange && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] text-[#787b86]">Line style</span>
          <div className="flex rounded-[4px] border border-[#363a45] overflow-hidden bg-[#131722]">
            {[
              { id: 'solid', dashArray: '' },
              { id: 'dashed', dashArray: '4,4' },
              { id: 'dotted', dashArray: '2,2' },
            ].map(styleDef => (
              <button
                key={styleDef.id}
                className={`flex-1 flex items-center justify-center h-[26px] border-r border-[#363a45] last:border-r-0 hover:bg-[#2a2e39] transition-colors ${lineStyle === styleDef.id ? 'bg-[#2a2e39]' : ''}`}
                onClick={() => onLineStyleChange(styleDef.id as 'solid' | 'dashed' | 'dotted')}
              >
                <svg width="24" height="2" viewBox="0 0 24 2">
                  <line x1="0" y1="1" x2="24" y2="1" stroke="#d1d4dc" strokeWidth="2" strokeDasharray={styleDef.dashArray} />
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────

export default function IndicatorSettingsModal({
  indicatorDef,
  initialSettings,
  activeIndicatorsContext = [],
  onClose,
  onSave,
}: IndicatorSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Inputs');
  const [openColorPickerId, setOpenColorPickerId] = useState<string | null>(null);
  
  // Initialize state from existing settings or defaults
  const [inputsState, setInputsState] = useState<IndicatorSettings['inputs']>(() => {
    const state: IndicatorSettings['inputs'] = { ...initialSettings?.inputs };
    indicatorDef.inputs?.forEach((inp) => {
      if (state[inp.id] === undefined) {
        state[inp.id] = inp.default;
      }
    });
    return state;
  });

  const [stylesState, setStylesState] = useState<IndicatorSettings['styles']>(() => {
    const state: IndicatorSettings['styles'] = { ...initialSettings?.styles };
    indicatorDef.styles?.forEach((st) => {
      if (state[st.id] === undefined) {
        state[st.id] = { color: st.color, thickness: st.thickness, lineStyle: st.lineStyle, display: st.display };
      }
    });
    return state;
  });

  const [visibilityState, setVisibilityState] = useState<Record<string, boolean>>(() => {
    return initialSettings?.visibility ?? {
      ticks: true, seconds: true, minutes: true, hours: true, days: true, weeks: true, months: true, ranges: true,
    };
  });

  const [labelsOnPriceScale, setLabelsOnPriceScale] = useState<boolean>(initialSettings?.labelsOnPriceScale ?? true);
  const [valuesInStatusLine, setValuesInStatusLine] = useState<boolean>(initialSettings?.valuesInStatusLine ?? true);

  const notifySave = (
    i = inputsState,
    s = stylesState,
    v = visibilityState,
    l = labelsOnPriceScale,
    val = valuesInStatusLine
  ) => {
    onSave({ inputs: i, styles: s, visibility: v, labelsOnPriceScale: l, valuesInStatusLine: val });
  };

  const updateInputs = (key: string, value: IndicatorSettings['inputs'][string]) => {
    const next = { ...inputsState, [key]: value };
    setInputsState(next);
    notifySave(next, stylesState, visibilityState, labelsOnPriceScale, valuesInStatusLine);
  };

  const updateStyles = (key: string, value: IndicatorSettings['styles'][string]) => {
    const next = { ...stylesState, [key]: value };
    setStylesState(next);
    notifySave(inputsState, next, visibilityState, labelsOnPriceScale, valuesInStatusLine);
  };

  const updateVisibility = (key: string, value: boolean) => {
    const next = { ...visibilityState, [key]: value };
    setVisibilityState(next);
    notifySave(inputsState, stylesState, next, labelsOnPriceScale, valuesInStatusLine);
  };

  const updateLabelsOnPriceScale = (val: boolean) => {
    setLabelsOnPriceScale(val);
    notifySave(inputsState, stylesState, visibilityState, val, valuesInStatusLine);
  };

  const updateValuesInStatusLine = (val: boolean) => {
    setValuesInStatusLine(val);
    notifySave(inputsState, stylesState, visibilityState, labelsOnPriceScale, val);
  };

  const handleCancel = () => {
    if (initialSettings) onSave(initialSettings);
    onClose();
  };

  const handleSaveBtn = () => {
    onClose();
  };

  const tabs: Tab[] = ['Inputs', 'Style', 'Visibility'];

  // Group inputs
  const inputGroups: Record<string, typeof indicatorDef.inputs> = { default: [] };
  indicatorDef.inputs?.forEach(inp => {
    const g = inp.group || 'default';
    if (!inputGroups[g]) inputGroups[g] = [];
    inputGroups[g]!.push(inp);
  });

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = modalRef.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    
    // We must use native event listeners to prevent lightweight-charts 
    // from intercepting events, because React's synthetic events 
    // bubble at the document root, which is too late.
    el.addEventListener('pointerdown', stop);
    el.addEventListener('mousedown', stop);
    el.addEventListener('touchstart', stop);
    el.addEventListener('touchmove', stop);
    el.addEventListener('wheel', stop);
    
    return () => {
      el.removeEventListener('pointerdown', stop);
      el.removeEventListener('mousedown', stop);
      el.removeEventListener('touchstart', stop);
      el.removeEventListener('touchmove', stop);
      el.removeEventListener('wheel', stop);
    };
  }, []);

  // Close when clicking outside the modal
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    // Use capture phase to catch the event before lightweight-charts stops propagation
    document.addEventListener("mousedown", handleClickOutside, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, [onClose]);

  // ── MA-Ribbon inline-row detection ──────────────────────────────────────
  // The MA Ribbon indicator uses groups "MA #1" … "MA #4".
  // We render those as a compact TradingView-style row:
  //   [✓] MA #N | [type▾] | [Close▾] | [length] | [■ color]
  const isMaRibbonGroup = (groupName: string) =>
    /^MA #[1-4]$/.test(groupName);

  /** Look up the style color for a given MA index (1-based). */
  const getMaColor = (maIdx: number): string =>
    stylesState[`ma_${maIdx}`]?.color ??
    indicatorDef.styles?.find((s) => s.id === `ma_${maIdx}`)?.color ??
    '#888888';

  const setMaColor = (maIdx: number, color: string) =>
    updateStyles(`ma_${maIdx}`, { ...stylesState[`ma_${maIdx}`], color });

  /** Compact inline MA row matching the TradingView design. */
  const renderMaRow = (groupName: string, inputs: typeof indicatorDef.inputs) => {
    if (!inputs) return null;
    const maIdx = parseInt(groupName.replace('MA #', ''), 10); // 1..4
    const showInp  = inputs.find((i) => i.id === `showMa${maIdx}`);
    const typeInp  = inputs.find((i) => i.id === `ma${maIdx}Type`);
    const lenInp   = inputs.find((i) => i.id === `ma${maIdx}Length`);
    const srcInp   = inputs.find((i) => i.id === `ma${maIdx}Source`);
    if (!showInp) return null;

    const checked = Boolean(inputsState[showInp.id] ?? showInp.default);
    const color   = getMaColor(maIdx);
    const rowDisabled = !checked;

    return (
      <div key={groupName} className="flex items-center gap-2">
        {/* Checkbox */}
        <label className="relative flex shrink-0 cursor-pointer items-center">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => updateInputs(showInp.id, e.target.checked)}
            className="peer sr-only"
          />
          <div className="flex h-[16px] w-[16px] items-center justify-center rounded-[3px] border border-[#50535e] bg-[#1e222d] transition-colors peer-checked:border-white peer-checked:bg-white">
            <svg width="9" height="7" viewBox="0 0 10 8" fill="none" className="opacity-0 peer-checked:opacity-100">
              <path d="M1 4L3.5 6.5L9 1" stroke="#1e222d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </label>

        {/* MA label */}
        <span className={`w-[36px] shrink-0 text-[13px] font-medium ${rowDisabled ? 'text-[#4c505e]' : 'text-[#d1d4dc]'}`}>
          {groupName}
        </span>

        {/* Type dropdown */}
        {typeInp && (
          <select
            value={inputsState[typeInp.id] ?? typeInp.default}
            onChange={(e) => updateInputs(typeInp.id, e.target.value)}
            disabled={rowDisabled}
            className={`h-[30px] min-w-0 flex-1 rounded-[5px] border bg-[#131722] pl-2 pr-5 text-[12px] outline-none transition-colors appearance-none cursor-pointer
              ${rowDisabled ? 'border-[#2a2e39] text-[#4c505e]' : 'border-[#434651] text-[#d1d4dc] hover:border-[#787b86] focus:border-[#2962FF]'}`}
            style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2210%22%20height%3D%226%22%20viewBox%3D%220%200%2010%206%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M1%201L5%205L9%201%22%20stroke%3D%22%23787b86%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center', backgroundSize: '9px' }}
          >
            {typeInp.options?.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-[#1e222d]">{opt.label}</option>
            ))}
          </select>
        )}

        {/* Source dropdown (Close) — always Close for MA Ribbon, show as static or select */}
        {srcInp ? (
          <select
            value={inputsState[srcInp.id] ?? srcInp.default}
            onChange={(e) => updateInputs(srcInp.id, e.target.value)}
            disabled={rowDisabled}
            className={`h-[30px] w-[68px] shrink-0 rounded-[5px] border bg-[#131722] pl-2 pr-5 text-[12px] outline-none transition-colors appearance-none cursor-pointer
              ${rowDisabled ? 'border-[#2a2e39] text-[#4c505e]' : 'border-[#434651] text-[#d1d4dc] hover:border-[#787b86] focus:border-[#2962FF]'}`}
            style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2210%22%20height%3D%226%22%20viewBox%3D%220%200%2010%206%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M1%201L5%205L9%201%22%20stroke%3D%22%23787b86%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center', backgroundSize: '9px' }}
          >
            {srcInp.options?.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-[#1e222d]">{opt.label}</option>
            ))}
          </select>
        ) : (
          /* No source input defined — show a static "Close" pill */
          <div className={`flex h-[30px] w-[68px] shrink-0 items-center justify-between rounded-[5px] border bg-[#131722] pl-2 pr-2 text-[12px]
            ${rowDisabled ? 'border-[#2a2e39] text-[#4c505e]' : 'border-[#434651] text-[#d1d4dc]'}`}>
            Close
            <svg width="9" height="6" viewBox="0 0 10 6" fill="none">
              <path d="M1 1L5 5L9 1" stroke="#787b86" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        )}

        {/* Length input */}
        {lenInp && (
          <div className="relative w-[56px] shrink-0 group">
            <input
              type="number"
              min={lenInp.min}
              max={lenInp.max}
              step={lenInp.step ?? 1}
              value={inputsState[lenInp.id] ?? lenInp.default}
              onChange={(e) => updateInputs(lenInp.id, parseInt(e.target.value, 10) || lenInp.default)}
              disabled={rowDisabled}
              className={`h-[30px] w-full rounded-[5px] border bg-[#131722] pl-2 pr-5 text-[12px] outline-none transition-colors appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                ${rowDisabled ? 'border-[#2a2e39] text-[#4c505e]' : 'border-[#434651] text-[#d1d4dc] hover:border-[#787b86] focus:border-[#2962FF]'}`}
              style={{ MozAppearance: 'textfield' }}
            />
            {!rowDisabled && (
              <div className="absolute right-0 top-0 bottom-0 flex flex-col justify-center pr-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
                <button type="button" className="text-[#787b86] hover:text-[#d1d4dc] p-px"
                  onClick={() => updateInputs(lenInp.id, (Number(inputsState[lenInp.id]) || 0) + 1)}>
                  <svg width="7" height="5" viewBox="0 0 10 6" fill="none"><path d="M1 5L5 1L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                <button type="button" className="text-[#787b86] hover:text-[#d1d4dc] p-px"
                  onClick={() => updateInputs(lenInp.id, Math.max(1, (Number(inputsState[lenInp.id]) || 0) - 1))}>
                  <svg width="7" height="5" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Color swatch — links to the corresponding style */}
        <div className={`relative h-[30px] w-[34px] shrink-0 overflow-hidden rounded-[5px] border transition-colors ${rowDisabled ? 'border-[#2a2e39] opacity-40' : 'border-[#434651] hover:border-[#787b86]'}`}>
          <div className="absolute inset-0" style={{ backgroundColor: color }} />
          {!rowDisabled && (
            <input
              type="color"
              value={color}
              onChange={(e) => setMaColor(maIdx, e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              title="Change color"
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none p-4">
      <div 
        ref={modalRef}
        className="pointer-events-auto flex w-[400px] max-h-full flex-col overflow-hidden rounded-lg bg-[#1e222d] text-[13px] text-[#d1d4dc] shadow-[0_2px_4px_rgba(0,0,0,0.5),0_16px_24px_rgba(0,0,0,0.5)] border border-[#434651]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-xl font-bold text-white tracking-wide">{indicatorDef.name}</h2>
          <button onClick={onClose} className="rounded text-[#787b86] hover:text-[#d1d4dc] transition-colors">
            <X size={24} strokeWidth={1.2} />
          </button>
        </div>

        {/* Tabs */}
        <div className="relative flex gap-6 px-5 mt-1">
          <div className="absolute bottom-0 left-5 right-5 h-[2px] bg-[#2a2e39]" />
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative pb-3 text-[14px] font-semibold transition-colors z-10 ${
                activeTab === tab
                  ? 'text-white border-b-2 border-[#2962FF]'
                  : 'text-[#787b86] hover:text-[#d1d4dc] border-b-2 border-transparent'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#434651] [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-[#5d606b]">
          {activeTab === 'Inputs' && (() => {
            // Split groups into MA-ribbon rows vs generic groups
            const maGroups: [string, typeof indicatorDef.inputs][] = [];
            const genericGroups: [string, typeof indicatorDef.inputs][] = [];
            Object.entries(inputGroups).forEach(([g, inps]) => {
              if (!inps || inps.length === 0) return;
              if (isMaRibbonGroup(g)) maGroups.push([g, inps]);
              else genericGroups.push([g, inps]);
            });

            return (
              <div className="space-y-1">
                {/* ── MA ribbon rows ── */}
                {maGroups.length > 0 && (
                  <div className="space-y-2 pb-2">
                    {maGroups.map(([g, inps]) => renderMaRow(g, inps))}
                  </div>
                )}

                {/* ── Generic groups ── */}
                {genericGroups.map(([groupName, inputs]) => (
                  <div key={groupName} className="space-y-4 pt-4">
                    {groupName !== 'default' && (
                      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#787b86] pt-2">
                        {groupName}
                      </h3>
                    )}
                    <div className="space-y-4">
                      {inputs!.map((inp) => {
                        const isDisabled = inp.disabledIf?.(inputsState) ?? false;

                        if (inp.type === 'boolean') {
                          return (
                            <div key={inp.id} className={`flex items-center gap-3 ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
                              <label className="relative flex cursor-pointer items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={inputsState[inp.id]}
                                  onChange={(e) => updateInputs(inp.id, e.target.checked)}
                                  className="peer sr-only"
                                  disabled={isDisabled}
                                />
                                <div className="h-[18px] w-[18px] rounded-[3px] border border-[#50535e] bg-[#1e222d] peer-checked:bg-white peer-checked:border-white peer-checked:[&>svg]:opacity-100 flex items-center justify-center transition-colors">
                                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none" className="opacity-0 transition-opacity">
                                    <path d="M1 4L3.5 6.5L9 1" stroke="#1e222d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </div>
                                <span className="text-[13px] text-[#d1d4dc]">{inp.name}</span>
                              </label>
                              {inp.tooltip && (
                                <div title={inp.tooltip} className="text-[#787b86] hover:text-[#d1d4dc] cursor-help">
                                  <HelpCircle size={16} strokeWidth={2} />
                                </div>
                              )}
                            </div>
                          );
                        }

                        return (
                          <div key={inp.id} className={`flex items-center ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
                            <label className="w-[160px] shrink-0 text-[#d1d4dc]">{inp.name}</label>
                            <div className="flex w-[110px] items-center gap-2">
                              {inp.type === 'number' && (
                                <div className="relative w-full group">
                                  <input
                                    type="number"
                                    min={inp.min}
                                    max={inp.max}
                                    step={inp.step}
                                    value={inputsState[inp.id]}
                                    onChange={(e) => updateInputs(inp.id, parseFloat(e.target.value))}
                                    className="w-full h-[34px] rounded-[6px] border border-[#434651] bg-[#131722] hover:border-[#787b86] pl-3 pr-6 outline-none focus:border-[#2962FF] text-[#d1d4dc] text-[14px] transition-colors appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                    style={{ MozAppearance: 'textfield' }}
                                    disabled={isDisabled}
                                  />
                                  <div className="absolute right-0 top-0 bottom-0 flex flex-col justify-center pr-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button type="button" className="text-[#787b86] hover:text-[#d1d4dc] focus:outline-none p-0.5"
                                      onClick={() => updateInputs(inp.id, (inputsState[inp.id] || 0) + (inp.step || 1))} disabled={isDisabled}>
                                      <svg width="8" height="5" viewBox="0 0 10 6" fill="none"><path d="M1 5L5 1L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                    </button>
                                    <button type="button" className="text-[#787b86] hover:text-[#d1d4dc] focus:outline-none p-0.5 mt-[1px]"
                                      onClick={() => updateInputs(inp.id, (inputsState[inp.id] || 0) - (inp.step || 1))} disabled={isDisabled}>
                                      <svg width="8" height="5" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                    </button>
                                  </div>
                                </div>
                              )}
                              {(inp.type === 'select' || inp.type === 'source') && (
                                <select
                                  value={inputsState[inp.id]}
                                  onChange={(e) => updateInputs(inp.id, e.target.value)}
                                  className="w-full h-[34px] rounded-[6px] border border-[#434651] bg-[#131722] hover:border-[#787b86] pl-3 pr-6 outline-none focus:border-[#2962FF] text-[#d1d4dc] text-[14px] transition-colors appearance-none cursor-pointer"
                                  style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2212%22%20height%3D%228%22%20viewBox%3D%220%200%2012%208%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M1%201.5L6%206.5L11%201.5%22%20stroke%3D%22%23787b86%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '10px' }}
                                  disabled={isDisabled}
                                >
                                  {inp.options?.map((opt) => (
                                    <option key={opt.value} value={opt.value} className="bg-[#1e222d]">{opt.label}</option>
                                  ))}
                                  {inp.type === 'source' && activeIndicatorsContext.map(ctx => (
                                    <optgroup key={ctx.id} label={ctx.name} className="bg-[#1e222d] text-[#787b86] font-semibold text-[11px] uppercase">
                                      {ctx.plots.map(p => (
                                        <option key={`${ctx.id}:${p.id}`} value={`${ctx.id}:${p.id}`} className="bg-[#1e222d] text-[#d1d4dc] normal-case text-[14px] font-normal">
                                          {`${ctx.name}: ${p.title}`}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </select>
                              )}
                            </div>
                            {inp.tooltip && (
                              <div title={inp.tooltip} className="text-[#50535e] hover:text-[#787b86] cursor-help pl-3">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                                </svg>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}


          {activeTab === 'Style' && (
            <div className="space-y-4">
              {indicatorDef.styles?.map((st) => {
                const currentStyle = stylesState[st.id] || ({} as IndicatorSettings['styles'][string]);
                const isColorPickerOpen = openColorPickerId === st.id;
                return (
                  <div key={st.id} className="flex items-center justify-between">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <div className="relative flex items-center">
                        <input
                          type="checkbox"
                          checked={currentStyle.display !== false}
                          onChange={(e) => updateStyles(st.id, { ...currentStyle, display: e.target.checked })}
                          className="peer sr-only"
                        />
                        <div className="h-[18px] w-[18px] rounded-[3px] border border-[#50535e] bg-[#1e222d] peer-checked:bg-white peer-checked:border-white peer-checked:[&>svg]:opacity-100 flex items-center justify-center transition-colors">
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none" className="opacity-0 transition-opacity">
                            <path d="M1 4L3.5 6.5L9 1" stroke="#1e222d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      </div>
                      <span className="text-[#d1d4dc]">{st.name}</span>
                    </label>
                    <div className="flex items-center gap-2 relative">
                      {/* Custom toggle button replacing native input */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenColorPickerId(isColorPickerOpen ? null : st.id);
                        }}
                        className={`flex items-center h-[26px] rounded-[4px] border transition-colors overflow-hidden ${isColorPickerOpen ? 'border-[#2962FF]' : 'border-[#363a45] hover:border-[#787b86]'}`}
                      >
                        {/* Swatch box */}
                        <div className={`h-full w-[34px] ${st.isFill ? '' : 'border-r border-[#363a45]'}`} style={{ backgroundColor: currentStyle.color }} />
                        {/* Thickness indicator box */}
                        {!st.isFill && (
                          <div className="flex h-full w-[42px] items-center justify-center bg-[#131722]">
                            <svg width="22" height="2" viewBox="0 0 22 2" className="overflow-visible">
                              <line 
                                x1="0" y1="1" x2="22" y2="1" 
                                stroke="#d1d4dc" 
                                strokeWidth={currentStyle.thickness || 1} 
                                strokeDasharray={currentStyle.lineStyle === 'dashed' ? '4,4' : currentStyle.lineStyle === 'dotted' ? '2,2' : ''} 
                              />
                            </svg>
                          </div>
                        )}
                      </button>

                      {st.hasValue && (
                        <input
                          type="number"
                          value={currentStyle.value ?? ''}
                          onChange={(e) => updateStyles(st.id, { ...currentStyle, value: parseFloat(e.target.value) })}
                          className="h-[26px] w-[80px] rounded-[4px] border border-[#363a45] bg-[#131722] hover:border-[#787b86] px-2 outline-none focus:border-[#2962FF] text-[#d1d4dc] text-[13px] transition-colors appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          style={{ MozAppearance: 'textfield' }}
                        />
                      )}

                      {isColorPickerOpen && (
                        <ColorPickerPopover
                          color={currentStyle.color}
                          thickness={st.isFill ? undefined : currentStyle.thickness}
                          lineStyle={st.isFill ? undefined : (currentStyle.lineStyle as 'solid' | 'dashed' | 'dotted')}
                          onColorChange={(c) => updateStyles(st.id, { ...currentStyle, color: c })}
                          onThicknessChange={st.isFill ? undefined : ((t) => updateStyles(st.id, { ...currentStyle, thickness: t }))}
                          onLineStyleChange={st.isFill ? undefined : ((s) => updateStyles(st.id, { ...currentStyle, lineStyle: s }))}
                          onClose={() => setOpenColorPickerId(null)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
              
              <div className="mt-6 space-y-4 pt-6 border-t border-[#2a2e39]">
                <div className="flex items-center justify-between">
                  <span className="text-[#d1d4dc]">Precision</span>
                  <select className="w-[160px] rounded-[4px] border border-[#363a45] bg-[#131722] px-3 py-1.5 outline-none focus:border-[#2962FF] transition-colors appearance-none" style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2212%22%20height%3D%228%22%20viewBox%3D%220%200%2012%208%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M1%201.5L6%206.5L11%201.5%22%20stroke%3D%22%23787b86%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', backgroundSize: '12px' }}>
                    <option>Default</option>
                  </select>
                </div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative flex items-center">
                    <input type="checkbox" checked={labelsOnPriceScale} onChange={(e) => updateLabelsOnPriceScale(e.target.checked)} className="peer sr-only" />
                    <div className="h-[18px] w-[18px] rounded-[3px] border border-[#50535e] bg-[#1e222d] peer-checked:bg-white peer-checked:border-white peer-checked:[&>svg]:opacity-100 flex items-center justify-center transition-colors">
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none" className="opacity-0 transition-opacity">
                        <path d="M1 4L3.5 6.5L9 1" stroke="#1e222d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                  <span className="text-[#d1d4dc]">Labels on price scale</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative flex items-center">
                    <input type="checkbox" checked={valuesInStatusLine} onChange={(e) => updateValuesInStatusLine(e.target.checked)} className="peer sr-only" />
                    <div className="h-[18px] w-[18px] rounded-[3px] border border-[#50535e] bg-[#1e222d] peer-checked:bg-white peer-checked:border-white peer-checked:[&>svg]:opacity-100 flex items-center justify-center transition-colors">
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none" className="opacity-0 transition-opacity">
                        <path d="M1 4L3.5 6.5L9 1" stroke="#1e222d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                  <span className="text-[#d1d4dc]">Values in status line</span>
                </label>
              </div>
            </div>
          )}

          {activeTab === 'Visibility' && (
            <div className="space-y-4">
              {[
                { id: 'ticks', label: 'Ticks' },
                { id: 'seconds', label: 'Seconds' },
                { id: 'minutes', label: 'Minutes' },
                { id: 'hours', label: 'Hours' },
                { id: 'days', label: 'Days' },
                { id: 'weeks', label: 'Weeks' },
                { id: 'months', label: 'Months' },
                { id: 'ranges', label: 'Ranges' },
              ].map((tf) => (
                <label key={tf.id} className="flex items-center gap-3 cursor-pointer">
                  <div className="relative flex items-center">
                    <input
                      type="checkbox"
                      checked={visibilityState[tf.id]}
                      onChange={(e) => updateVisibility(tf.id, e.target.checked)}
                      className="peer sr-only"
                    />
                    <div className="h-[18px] w-[18px] rounded-[3px] border border-[#50535e] bg-[#1e222d] peer-checked:bg-white peer-checked:border-white peer-checked:[&>svg]:opacity-100 flex items-center justify-center transition-colors">
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none" className="opacity-0 transition-opacity">
                        <path d="M1 4L3.5 6.5L9 1" stroke="#1e222d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                  <span className="text-[#d1d4dc]">{tf.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#2a2e39] px-5 py-4 bg-[#1e222d]">
          <select 
            className="w-[110px] rounded-[4px] border border-[#363a45] bg-[#1e222d] px-2 py-1 text-[13px] text-[#d1d4dc] outline-none transition-colors appearance-none cursor-pointer" 
            style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2212%22%20height%3D%228%22%20viewBox%3D%220%200%2012%208%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M1%201.5L6%206.5L11%201.5%22%20stroke%3D%22%23787b86%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '10px' }}
            onChange={(e) => {
              if (e.target.value === 'save_as_default') {
                const defaultsStr = localStorage.getItem('indicator_defaults') || '{}';
                const defaultsObj = JSON.parse(defaultsStr);
                defaultsObj[indicatorDef.id] = {
                  inputs: inputsState,
                  styles: stylesState,
                  visibility: visibilityState,
                  labelsOnPriceScale,
                  valuesInStatusLine,
                };
                localStorage.setItem('indicator_defaults', JSON.stringify(defaultsObj));
                e.target.value = 'defaults';
              }
            }}
          >
            <option value="defaults">Defaults</option>
            <option value="save_as_default">Save as default</option>
          </select>
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              className="rounded-[4px] border border-[#363a45] bg-transparent px-5 py-1.5 text-[13px] font-semibold text-[#d1d4dc] transition-colors hover:border-[#787b86] hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveBtn}
              className="rounded-[4px] bg-white px-6 py-1.5 text-[13px] font-semibold text-black transition-colors hover:bg-[#d1d4dc]"
            >
              Ok
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
