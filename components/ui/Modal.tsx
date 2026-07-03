'use client';

// MDS Phase C — Modal primitive.
// Backed by the native <dialog> element for built-in focus trapping,
// Escape-key dismissal, and accessibility with zero JS dependencies.
//
// Usage:
//   <Modal open={isOpen} onClose={() => setOpen(false)} title="Settings">
//     <p>Content here</p>
//     <Modal.Footer>
//       <Button variant="outline" onClick={onClose}>Cancel</Button>
//       <Button variant="solid" onClick={handleSave}>Save</Button>
//     </Modal.Footer>
//   </Modal>
//
// Size variants: sm (380px) | md (480px, default) | lg (640px) | full (100vw - 24px)

import {
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { cx } from './util';
import { Button } from './Button';

export type ModalSize = 'sm' | 'md' | 'lg' | 'full';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: ModalSize;
  className?: string;
  children?: ReactNode;
}

const MAX_W: Record<ModalSize, string> = {
  sm:   'max-w-[380px]',
  md:   'max-w-[480px]',
  lg:   'max-w-[640px]',
  full: 'max-w-[calc(100vw-24px)]',
};

export function Modal({ open, onClose, title, size = 'md', className, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Open / close the native <dialog>
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Native <dialog> fires 'close' on Escape — keep React state in sync
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  // Backdrop click closes the modal (click on <dialog> itself, not its contents)
  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      className={cx(
        // Reset native dialog styles, apply MDS surface styles
        'fixed inset-0 m-auto w-full rounded-2xl border border-line bg-surface-1 p-0',
        'shadow-[0_1px_0_var(--specular),0_24px_64px_oklch(0_0_0/0.55)]',
        'backdrop:bg-base/60 backdrop:backdrop-blur-sm',
        // Entry animation
        'open:animate-[modal-in_220ms_var(--ease-quart)_forwards]',
        MAX_W[size],
        className,
      )}
    >
      {/* Header */}
      {title && (
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <Button
            variant="ghost"
            size="sm"
            icon={<X className="h-3.5 w-3.5" />}
            onClick={onClose}
            aria-label="Close"
          />
        </div>
      )}

      {/* Body */}
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}

// Convenience slot for action rows at the bottom of a modal
Modal.Footer = function ModalFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center justify-end gap-2 border-t border-line px-5 py-4', className)}>
      {children}
    </div>
  );
};
