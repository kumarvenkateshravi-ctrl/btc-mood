'use client';

import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { RenkoConfig, RenkoMethod } from '@/lib/renko';

interface RenkoSettingsModalProps {
  initialConfig: RenkoConfig;
  onClose: () => void;
  onSave: (config: RenkoConfig) => void;
}

export default function RenkoSettingsModal({
  initialConfig,
  onClose,
  onSave,
}: RenkoSettingsModalProps) {
  const [method, setMethod] = useState<RenkoMethod>(initialConfig.method);
  const [boxSize, setBoxSize] = useState<number>(initialConfig.boxSize ?? 150);
  const [atrLength, setAtrLength] = useState<number>(initialConfig.atrLength);
  const [percentage, setPercentage] = useState<number>(initialConfig.percentage);

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = modalRef.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    
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
    document.addEventListener("mousedown", handleClickOutside, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, [onClose]);

  const handleSaveBtn = () => {
    onSave({
      method,
      boxSize: method === 'traditional' ? boxSize : initialConfig.boxSize,
      atrLength: method === 'atr' ? atrLength : initialConfig.atrLength,
      percentage: method === 'percentage' ? percentage : initialConfig.percentage,
    });
    onClose();
  };

  const selectBg = 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2212%22%20height%3D%228%22%20viewBox%3D%220%200%2012%208%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M1%201.5L6%206.5L11%201.5%22%20stroke%3D%22%23787b86%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E")';

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none p-4">
      <div 
        ref={modalRef}
        className="pointer-events-auto flex w-[400px] flex-col overflow-hidden rounded-lg bg-[#1e222d] text-[13px] text-[#d1d4dc] shadow-[0_2px_4px_rgba(0,0,0,0.5),0_16px_24px_rgba(0,0,0,0.5)] border border-[#434651]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-4 border-b border-[#2a2e39]">
          <h2 className="text-xl font-bold text-white tracking-wide">Renko Settings</h2>
          <button onClick={onClose} className="rounded text-[#787b86] hover:text-[#d1d4dc] transition-colors">
            <X size={24} strokeWidth={1.2} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 px-5 py-6 space-y-6">
          
          <div className="flex items-center justify-between">
            <label className="text-[#d1d4dc]">Box size assignment method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as RenkoMethod)}
              className="h-[34px] w-[160px] rounded-[6px] border border-[#434651] bg-[#131722] hover:border-[#787b86] pl-3 pr-8 outline-none focus:border-[#2962FF] text-[#d1d4dc] text-[14px] transition-colors appearance-none cursor-pointer"
              style={{ backgroundImage: selectBg, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '10px' }}
            >
              <option value="atr" className="bg-[#1e222d]">ATR</option>
              <option value="traditional" className="bg-[#1e222d]">Traditional</option>
              <option value="percentage" className="bg-[#1e222d]">Percentage LTP</option>
            </select>
          </div>

          {method === 'atr' && (
            <div className="flex items-center justify-between">
              <label className="text-[#d1d4dc]">ATR length</label>
              <input
                type="number"
                min={1}
                value={atrLength}
                onChange={(e) => setAtrLength(Math.max(1, parseInt(e.target.value, 10) || 14))}
                className="h-[34px] w-[160px] rounded-[6px] border border-[#434651] bg-[#131722] hover:border-[#787b86] px-3 outline-none focus:border-[#2962FF] text-[#d1d4dc] text-[14px] transition-colors appearance-none"
              />
            </div>
          )}

          {method === 'traditional' && (
            <div className="flex items-center justify-between">
              <label className="text-[#d1d4dc]">Box size</label>
              <input
                type="number"
                min={0.0001}
                step="any"
                value={boxSize}
                onChange={(e) => setBoxSize(parseFloat(e.target.value) || 150)}
                className="h-[34px] w-[160px] rounded-[6px] border border-[#434651] bg-[#131722] hover:border-[#787b86] px-3 outline-none focus:border-[#2962FF] text-[#d1d4dc] text-[14px] transition-colors appearance-none"
              />
            </div>
          )}

          {method === 'percentage' && (
            <div className="flex items-center justify-between">
              <label className="text-[#d1d4dc]">Percentage</label>
              <div className="relative w-[160px]">
                <input
                  type="number"
                  min={0.001}
                  step="0.1"
                  value={percentage}
                  onChange={(e) => setPercentage(parseFloat(e.target.value) || 0.5)}
                  className="h-[34px] w-full rounded-[6px] border border-[#434651] bg-[#131722] hover:border-[#787b86] pl-3 pr-8 outline-none focus:border-[#2962FF] text-[#d1d4dc] text-[14px] transition-colors appearance-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#787b86] pointer-events-none">%</span>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-[#2a2e39] px-5 py-4 bg-[#1e222d] gap-2">
          <button
            onClick={onClose}
            className="rounded-[4px] border border-[#363a45] bg-transparent px-5 py-1.5 text-[13px] font-semibold text-[#d1d4dc] transition-colors hover:border-[#787b86] hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveBtn}
            className="rounded-[4px] bg-[#2962FF] px-6 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#1E53E5]"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
