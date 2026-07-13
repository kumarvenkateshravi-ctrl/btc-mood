'use client';

// Last line of defense for the chart: a trading chart must NEVER take the
// page down. Any error escaping the chart tree (lightweight-charts internals,
// a hook race, a bad frame) is caught here, logged WITH its stack (the Next
// overlay often loses it), and the chart remounts itself — losing at most a
// frame of state. After 3 rapid failures we stop retrying and show a manual
// reload card instead of looping.

import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  failedAt: number[];
  generation: number;
  halted: boolean;
}

const MAX_RETRIES = 3;
const WINDOW_MS = 30_000;

export default class ChartErrorBoundary extends React.Component<Props, State> {
  state: State = { failedAt: [], generation: 0, halted: false };

  static getDerivedStateFromError(): Partial<State> | null {
    return null; // handled in componentDidCatch so we can rate-limit
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[chart] crashed — remounting:', error, info.componentStack);
    this.setState((prev) => {
      const now = Date.now();
      const recent = [...prev.failedAt, now].filter((t) => now - t < WINDOW_MS);
      if (recent.length > MAX_RETRIES) {
        return { failedAt: recent, generation: prev.generation, halted: true };
      }
      return { failedAt: recent, generation: prev.generation + 1, halted: false };
    });
  }

  render(): React.ReactNode {
    if (this.state.halted) {
      return (
        <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-line bg-surface-1 p-6">
          <p className="text-sm font-semibold text-ink">Chart hit a repeated error.</p>
          <p className="text-xs text-ink-muted">The rest of the app keeps running. Details are in the console.</p>
          <button
            type="button"
            className="focus-ring mt-2 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink hover:bg-surface-3"
            onClick={() => this.setState({ failedAt: [], generation: this.state.generation + 1, halted: false })}
          >
            Reload chart
          </button>
        </div>
      );
    }
    // key bump remounts the entire chart subtree after a caught error
    return <React.Fragment key={this.state.generation}>{this.props.children}</React.Fragment>;
  }
}
