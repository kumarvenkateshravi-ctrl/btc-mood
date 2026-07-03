'use client';

// MDS Phase C — Tabs primitive.
// A generic, accessible tablist with a smooth sliding indicator.
// Matches the pattern of IntentSwitch but is fully generic and composable.
//
// Usage:
//   <Tabs value={active} onChange={setActive} variant="pill">
//     <Tab id="signals">Signals</Tab>
//     <Tab id="trade">Trade</Tab>
//     <Tab id="alerts">Alerts</Tab>
//   </Tabs>
//
// Variants:
//   pill      — rounded container with a sliding accent-tinted indicator (default)
//   underline — bottom-border indicator for lower-emphasis navigation

import { Children, isValidElement, type ReactNode } from 'react';
import { cx } from './util';

export type TabsVariant = 'pill' | 'underline';

export interface TabsProps {
  value: string;
  onChange: (id: string) => void;
  variant?: TabsVariant;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
}

export interface TabProps {
  id: string;
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

// Collect Tab children metadata so Tabs can calculate indicator position
function collectTabs(children: ReactNode): TabProps[] {
  const tabs: TabProps[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as Partial<TabProps> | null;
    if (props && typeof props === 'object' && typeof props.id === 'string') {
      tabs.push(props as TabProps);
    }
  });
  return tabs;
}

export function Tabs({
  value,
  onChange,
  variant = 'pill',
  className,
  children,
  'aria-label': ariaLabel,
}: TabsProps) {
  const tabs = collectTabs(children);
  const activeIdx = tabs.findIndex((t) => t.id === value);
  const count = tabs.length;

  if (variant === 'underline') {
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cx('flex items-end border-b border-line gap-1', className)}
      >
        {tabs.map((tab) => {
          const active = tab.id === value;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active}
              disabled={tab.disabled}
              onClick={() => onChange(tab.id)}
              className={cx(
                'focus-ring inline-flex items-center gap-1.5 border-b-2 px-3 pb-2 pt-1 text-xs font-medium transition-colors',
                active
                  ? 'border-accent text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink',
                'disabled:pointer-events-none disabled:opacity-40',
              )}
            >
              {tab.icon && <span aria-hidden className="shrink-0">{tab.icon}</span>}
              {tab.children}
            </button>
          );
        })}
      </div>
    );
  }

  // Pill variant — sliding indicator
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cx(
        'relative inline-flex items-center rounded-xl border border-line bg-surface-2/60 p-0.5 text-xs',
        className,
      )}
    >
      {/* Sliding indicator */}
      {activeIdx >= 0 && (
        <span
          aria-hidden
          className="absolute top-0.5 bottom-0.5 rounded-lg bg-accent/15 ring-1 ring-accent/35 transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)]"
          style={{
            width: `calc((100% - 4px) / ${count})`,
            transform: `translateX(${activeIdx * 100}%)`,
          }}
        />
      )}
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={cx(
              'focus-ring relative z-10 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors',
              active ? 'text-ink' : 'text-ink-muted hover:text-ink',
              'disabled:pointer-events-none disabled:opacity-40',
            )}
          >
            {tab.icon && <span aria-hidden className="shrink-0">{tab.icon}</span>}
            {tab.children}
          </button>
        );
      })}
    </div>
  );
}

// Declarative Tab slot — data is harvested by Tabs, this renders nothing itself
export function Tab(_props: TabProps): null {
  return null;
}
