'use client';

import { Modal, Button } from '@/components/ui';

interface CloseConfirmDialogProps {
  open: boolean;
  pnl: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation dialog for closing the active trade. */
export default function CloseConfirmDialog(p: CloseConfirmDialogProps) {
  const formatted = `${p.pnl >= 0 ? '+' : '−'}$${Math.abs(p.pnl).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  return (
    <Modal open={p.open} onClose={p.onCancel} size="sm" title="Close Trade?">
      <p className="text-sm text-ink-muted">
        Current P&amp;L{' '}
        <span className={`font-mono font-semibold ${p.pnl >= 0 ? 'text-bull-bright' : 'text-bear-bright'}`}>
          {formatted}
        </span>
      </p>
      <Modal.Footer>
        <Button variant="outline" onClick={p.onCancel}>
          Cancel
        </Button>
        <Button variant="solid" onClick={p.onConfirm}>
          Yes, close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
