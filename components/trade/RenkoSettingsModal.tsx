'use client';

import { useState } from 'react';
import type { RenkoConfig, RenkoMethod } from '@/lib/renko';
import { Modal, Button } from '@/components/ui';

interface RenkoSettingsModalProps {
  initialConfig: RenkoConfig;
  onClose: () => void;
  onSave: (config: RenkoConfig) => void;
}

const INPUT_CLS =
  'h-8 w-[160px] rounded-lg border border-line bg-surface-2 px-3 text-xs text-ink outline-none transition-colors hover:border-line-strong focus:border-accent focus:ring-1 focus:ring-accent/30';

export default function RenkoSettingsModal({
  initialConfig,
  onClose,
  onSave,
}: RenkoSettingsModalProps) {
  const [method, setMethod] = useState<RenkoMethod>(initialConfig.method);
  const [boxSize, setBoxSize] = useState<number>(initialConfig.boxSize ?? 150);
  const [atrLength, setAtrLength] = useState<number>(initialConfig.atrLength);
  const [percentage, setPercentage] = useState<number>(initialConfig.percentage);

  const handleSave = () => {
    onSave({
      method,
      boxSize: method === 'traditional' ? boxSize : initialConfig.boxSize,
      atrLength: method === 'atr' ? atrLength : initialConfig.atrLength,
      percentage: method === 'percentage' ? percentage : initialConfig.percentage,
    });
    onClose();
  };

  return (
    <Modal open title="Renko Settings" onClose={onClose} size="sm">
      <div className="space-y-5">
        {/* Method selector */}
        <div className="flex items-center justify-between">
          <label className="text-xs text-ink-muted">Box size method</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as RenkoMethod)}
            className={INPUT_CLS}
          >
            <option value="atr">ATR</option>
            <option value="traditional">Traditional</option>
            <option value="percentage">Percentage LTP</option>
          </select>
        </div>

        {method === 'atr' && (
          <div className="flex items-center justify-between">
            <label className="text-xs text-ink-muted">ATR length</label>
            <input
              type="number"
              min={1}
              value={atrLength}
              onChange={(e) => setAtrLength(Math.max(1, parseInt(e.target.value, 10) || 14))}
              className={INPUT_CLS}
            />
          </div>
        )}

        {method === 'traditional' && (
          <div className="flex items-center justify-between">
            <label className="text-xs text-ink-muted">Box size</label>
            <input
              type="number"
              min={0.0001}
              step="any"
              value={boxSize}
              onChange={(e) => setBoxSize(parseFloat(e.target.value) || 150)}
              className={INPUT_CLS}
            />
          </div>
        )}

        {method === 'percentage' && (
          <div className="flex items-center justify-between">
            <label className="text-xs text-ink-muted">Percentage</label>
            <div className="relative w-[160px]">
              <input
                type="number"
                min={0.001}
                step="0.1"
                value={percentage}
                onChange={(e) => setPercentage(parseFloat(e.target.value) || 0.5)}
                className={`${INPUT_CLS} w-full pr-7`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-faint">
                %
              </span>
            </div>
          </div>
        )}
      </div>

      <Modal.Footer>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="solid" onClick={handleSave}>OK</Button>
      </Modal.Footer>
    </Modal>
  );
}
