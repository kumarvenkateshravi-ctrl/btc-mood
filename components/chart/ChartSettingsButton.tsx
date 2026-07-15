'use client';

import { forwardRef } from 'react';
import { TvSettingsIcon } from './TvSettingsIcon';

export interface ChartSettingsButtonProps {
  open: boolean;
  onClick: () => void;
  title?: string;
}

export const ChartSettingsButton = forwardRef<HTMLButtonElement, ChartSettingsButtonProps>(
  function ChartSettingsButton({ open, onClick, title = 'Chart settings' }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="chart-settings-popover"
        className={[
          'focus-ring inline-flex h-full px-2 items-center justify-center transition-colors',
          open ? 'text-accent' : 'text-ink-faint hover:text-ink',
        ].join(' ')}
      >
        <TvSettingsIcon size={16} strokeWidth={1.5} />
      </button>
    );
  },
);
