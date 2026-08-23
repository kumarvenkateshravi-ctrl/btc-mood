/**
 * Development/test-only timing hooks for the Stage 2 performance baseline.
 *
 * The default path is deliberately allocation-free apart from the function
 * call: production builds do not create PerformanceEntry objects, emit logs,
 * or retain samples. A recorder is supplied explicitly by tests/dev tooling.
 */

export type PerformanceEnvironment = 'production' | 'development' | 'test' | string;

export interface PerformanceSample {
  label: string;
  durationMs: number;
}

export interface PerformanceSink {
  record(sample: PerformanceSample): void;
}

function nowMs(): number {
  return typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
}

export function isPerformanceInstrumentationEnabled(
  environment: PerformanceEnvironment =
    typeof process !== 'undefined' ? process.env.NODE_ENV ?? 'development' : 'development',
): boolean {
  return environment !== 'production';
}

/** Measure a callback only when the caller provides a development/test sink. */
export function measurePerformance<T>(
  label: string,
  operation: () => T,
  sink?: PerformanceSink | null,
): T {
  if (!sink || !isPerformanceInstrumentationEnabled()) return operation();
  const start = nowMs();
  const token = `stage2:${label}:${start}`;
  const perf = globalThis.performance as Performance & {
    mark?: (name: string) => void;
    measure?: (name: string, startMark?: string, endMark?: string) => void;
  };
  try { perf.mark?.(`${token}:start`); } catch {}
  try {
    return operation();
  } finally {
    const durationMs = Math.max(0, nowMs() - start);
    sink.record({ label, durationMs });
    // Keep browser traces available to DevTools without writing application
    // logs. `measure` is best-effort because marks may be unavailable in tests.
    try {
      perf.mark?.(`${token}:end`);
      perf.measure?.(`stage2:${label}`, `${token}:start`, `${token}:end`);
    } catch {
      // Instrumentation must never affect chart behavior.
    }
  }
}

export class PerformanceRecorder implements PerformanceSink {
  private readonly values = new Map<string, number[]>();

  record(sample: PerformanceSample): void {
    const values = this.values.get(sample.label);
    if (values) values.push(sample.durationMs);
    else this.values.set(sample.label, [sample.durationMs]);
  }

  samples(label: string): number[] {
    return [...(this.values.get(label) ?? [])];
  }

  labels(): string[] {
    return [...this.values.keys()];
  }

  clear(): void {
    this.values.clear();
  }
}

export function createPerformanceRecorder(): PerformanceRecorder {
  return new PerformanceRecorder();
}
