'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Native modal focus/inert behavior, with a scrollable, safe-area-aware sheet. */
export default function MobileSheet({ title, onClose, children, className = '' }: {
  title: string; onClose: () => void; children: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} aria-label={title} aria-modal="true" className={`mobile-sheet ${className}`}
    onCancel={(event) => { event.preventDefault(); closeRef.current(); }}
    onClick={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}>
    <div className="mobile-sheet-body">
      <div className="mobile-sheet-handle" aria-hidden="true" />
      <header className="mobile-sheet-heading"><h2>{title}</h2><button type="button" className="focus-ring" aria-label={`Close ${title}`} onClick={onClose}><X size={20} /></button></header>
      {children}
    </div>
  </dialog>;
}
