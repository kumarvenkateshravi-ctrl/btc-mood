import { CUSTOM_INDICATORS } from './customIndicatorsLibrary';

export const CHART_INDICATORS = CUSTOM_INDICATORS;

export const isChartIndicatorId = (id: string) =>
  CHART_INDICATORS.some((indicator) => indicator.id === id);
