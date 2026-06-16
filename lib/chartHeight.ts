// Chart height policy for the dashboard.
//
// The previous implementation capped the chart at 560px and used a
// 0.55vh ratio, which made the chart feel cramped. This policy uses
// a vh-based sizing with no hard pixel cap so the chart fills the
// viewport on both desktop and mobile.

export const MIN_CHART_HEIGHT = 380;
export const FALLBACK_HEIGHT = 540;
export const MOBILE_BREAKPOINT_PX = 640;
export const DESKTOP_VH_RATIO = 0.72;
export const MOBILE_VH_RATIO = 0.62;

export function computeChartHeight(): number {
  if (typeof window === 'undefined') return FALLBACK_HEIGHT;
  const isMobile = window.innerWidth < MOBILE_BREAKPOINT_PX;
  const ratio = isMobile ? MOBILE_VH_RATIO : DESKTOP_VH_RATIO;
  return Math.max(MIN_CHART_HEIGHT, Math.round(window.innerHeight * ratio));
}

export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < MOBILE_BREAKPOINT_PX;
}
