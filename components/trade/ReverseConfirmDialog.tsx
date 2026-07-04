'use client';

import { Modal, Button } from '@/components/ui';

interface ReverseConfirmDialogProps {
  open: boolean;
  side: 'buy' | 'sell';
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation dialog for reversing the active trade's side. */
export default function ReverseConfirmDialog(p: ReverseConfirmDialogProps) {
  const current = p.side === 'buy' ? 'BUY' : 'SELL';
  const opposite = p.side === 'buy' ? 'SELL' : 'BUY';

  return (
    <Modal open={p.open} onClose={p.onCancel} size="sm" title="Reverse Trade?">
      <p className="text-sm text-ink-muted">
        <span className={p.side === 'buy' ? 'font-semibold text-bull-bright' : 'font-semibold text-bear-bright'}>
          {current}
        </span>
        {' → '}
        <span className={p.side === 'buy' ? 'font-semibold text-bear-bright' : 'font-semibold text-bull-bright'}>
          {opposite}
        </span>
      </p>
      <Modal.Footer>
        <Button variant="outline" onClick={p.onCancel}>
          Cancel
        </Button>
        <Button variant="solid" onClick={p.onConfirm}>
          Yes, reverse
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
