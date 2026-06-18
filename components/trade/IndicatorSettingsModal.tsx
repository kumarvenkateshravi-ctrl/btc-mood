'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Info, HelpCircle } from 'lucide-react';
import type { CustomIndicatorDef } from '@/lib/customIndicatorsLibrary';
import type { IndicatorSettings } from '@/lib/indicatorFramework';

interface IndicatorSettingsModalProps {
  indicatorDef: CustomIndicatorDef;
  initialSettings?: IndicatorSettings;
  onClose: () => void;
  onSave: (settings: IndicatorSettings) => void;
}

type Tab = 'Inputs' | 'Style' | 'Visibility';

export default function IndicatorSettingsModal({
  indicatorDef,
  initialSettings,
  onClose,
  onSave,
}: IndicatorSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Inputs');
  
  // Initialize state from existing settings or defaults
  const [inputsState, setInputsState] = useState<Record<string, any>>(() => {
    const state: Record<string, any> = { ...initialSettings?.inputs };
    indicatorDef.inputs?.forEach((inp) => {
      if (state[inp.id] === undefined) {
        state[inp.id] = inp.default;
      }
    });
    return state;
  });

  const [stylesState, setStylesState] = useState<Record<string, any>>(() => {
    const state: Record<string, any> = { ...initialSettings?.styles };
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

  const updateInputs = (key: string, value: any) => {
    const next = { ...inputsState, [key]: value };
    setInputsState(next);
    onSave({ inputs: next, styles: stylesState, visibility: visibilityState });
  };

  const updateStyles = (key: string, value: any) => {
    const next = { ...stylesState, [key]: value };
    setStylesState(next);
    onSave({ inputs: inputsState, styles: next, visibility: visibilityState });
  };

  const updateVisibility = (key: string, value: boolean) => {
    const next = { ...visibilityState, [key]: value };
    setVisibilityState(next);
    onSave({ inputs: inputsState, styles: stylesState, visibility: next });
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
          {activeTab === 'Inputs' && (
            <div className="space-y-6">
              {Object.entries(inputGroups).map(([groupName, inputs], groupIdx) => {
                if (!inputs || inputs.length === 0) return null;
                return (
                  <div key={groupName} className="space-y-4">
                    {groupName !== 'default' && (
                      <h3 className={`text-[11px] font-semibold uppercase tracking-widest text-[#787b86] ${groupIdx > 0 ? 'pt-2' : ''}`}>
                        {groupName}
                      </h3>
                    )}
                    <div className="space-y-4">
                    {inputs.map((inp) => {
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
                              <div className="h-[18px] w-[18px] rounded-[3px] border border-[#50535e] bg-[#1e222d] peer-checked:bg-white peer-checked:border-white flex items-center justify-center transition-colors">
                                <svg width="10" height="8" viewBox="0 0 10 8" fill="none" className="opacity-0 peer-checked:opacity-100">
                                  <path d="M1 4L3.5 6.5L9 1" stroke="#1e222d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </div>
                              <span className="text-[13px] text-[#d1d4dc]">{inp.name}</span>
                            </label>
                            {inp.tooltip && (
                              <div title={inp.tooltip} className="text-[#787b86] hover:text-[#d1d4dc] cursor-help">
                                <Info size={16} strokeWidth={2} />
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
                                <button
                                  type="button"
                                  className="text-[#787b86] hover:text-[#d1d4dc] focus:outline-none p-0.5"
                                  onClick={() => updateInputs(inp.id, (inputsState[inp.id] || 0) + (inp.step || 1))}
                                  disabled={isDisabled}
                                >
                                  <svg width="8" height="5" viewBox="0 0 10 6" fill="none">
                                    <path d="M1 5L5 1L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  className="text-[#787b86] hover:text-[#d1d4dc] focus:outline-none p-0.5 mt-[1px]"
                                  onClick={() => updateInputs(inp.id, (inputsState[inp.id] || 0) - (inp.step || 1))}
                                  disabled={isDisabled}
                                >
                                  <svg width="8" height="5" viewBox="0 0 10 6" fill="none">
                                    <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
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
                );
              })}
            </div>
          )}

          {activeTab === 'Style' && (
            <div className="space-y-4">
              {indicatorDef.styles?.map((st) => (
                <div key={st.id} className="flex items-center justify-between">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <div className="relative flex items-center">
                      <input
                        type="checkbox"
                        checked={stylesState[st.id]?.display}
                        onChange={(e) => updateStyles(st.id, { ...stylesState[st.id], display: e.target.checked })}
                        className="peer sr-only"
                      />
                      <div className="h-[18px] w-[18px] rounded-[3px] border border-[#363a45] bg-[#131722] peer-checked:bg-[#2962FF] peer-checked:border-[#2962FF] flex items-center justify-center transition-colors">
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none" className="opacity-0 peer-checked:opacity-100 transition-opacity">
                          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                    <span className="text-[#d1d4dc]">{st.name}</span>
                  </label>
                  <div className="flex items-center gap-2">
                    {/* Native color picker masked in a block */}
                    <div className="relative h-[26px] w-[34px] overflow-hidden rounded-[4px] border border-[#363a45]">
                      <input
                        type="color"
                        value={stylesState[st.id]?.color}
                        onChange={(e) => updateStyles(st.id, { ...stylesState[st.id], color: e.target.value })}
                        className="absolute -inset-2 h-10 w-14 cursor-pointer"
                      />
                    </div>
                    {/* Thickness indicator */}
                    <button className="flex h-[26px] w-[42px] items-center justify-center rounded-[4px] border border-[#363a45] bg-[#131722] hover:border-[#434651] transition-colors">
                      <div 
                        className="w-[22px] bg-[#d1d4dc]" 
                        style={{ 
                          height: stylesState[st.id]?.thickness + 'px',
                          opacity: stylesState[st.id]?.lineStyle === 'solid' ? 1 : 0.5 
                        }} 
                      />
                    </button>
                  </div>
                </div>
              ))}
              
              <div className="mt-6 space-y-4 pt-6 border-t border-[#2a2e39]">
                <div className="flex items-center justify-between">
                  <span className="text-[#d1d4dc]">Precision</span>
                  <select className="w-[160px] rounded-[4px] border border-[#363a45] bg-[#131722] px-3 py-1.5 outline-none focus:border-[#2962FF] transition-colors appearance-none" style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2212%22%20height%3D%228%22%20viewBox%3D%220%200%2012%208%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M1%201.5L6%206.5L11%201.5%22%20stroke%3D%22%23787b86%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', backgroundSize: '12px' }}>
                    <option>Default</option>
                  </select>
                </div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative flex items-center">
                    <input type="checkbox" defaultChecked className="peer sr-only" />
                    <div className="h-[18px] w-[18px] rounded-[3px] border border-[#363a45] bg-[#131722] peer-checked:bg-[#2962FF] peer-checked:border-[#2962FF] flex items-center justify-center transition-colors">
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none" className="opacity-0 peer-checked:opacity-100 transition-opacity">
                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                  <span className="text-[#d1d4dc]">Labels on price scale</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative flex items-center">
                    <input type="checkbox" defaultChecked className="peer sr-only" />
                    <div className="h-[18px] w-[18px] rounded-[3px] border border-[#363a45] bg-[#131722] peer-checked:bg-[#2962FF] peer-checked:border-[#2962FF] flex items-center justify-center transition-colors">
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none" className="opacity-0 peer-checked:opacity-100 transition-opacity">
                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
                    <div className="h-[18px] w-[18px] rounded-[3px] border border-[#363a45] bg-[#131722] peer-checked:bg-[#2962FF] peer-checked:border-[#2962FF] flex items-center justify-center transition-colors">
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none" className="opacity-0 peer-checked:opacity-100 transition-opacity">
                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
          <select className="w-[110px] rounded-[4px] border border-[#363a45] bg-[#1e222d] px-2 py-1 text-[13px] text-[#d1d4dc] outline-none transition-colors appearance-none cursor-pointer" style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2212%22%20height%3D%228%22%20viewBox%3D%220%200%2012%208%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M1%201.5L6%206.5L11%201.5%22%20stroke%3D%22%23787b86%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '10px' }}>
            <option>Defaults</option>
            <option>Save as default</option>
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
