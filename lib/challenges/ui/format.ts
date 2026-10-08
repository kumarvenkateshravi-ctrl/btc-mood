const PERCENT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const REPLAY_MOMENT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatChallengeRatio(value: string): string {
  return PERCENT.format(Math.max(0, Number(value) * 100)) + '%';
}
export function challengeRatioWidth(value: string): string {
  return Math.min(100, Math.max(0, Number(value) * 100)) + '%';
}
export function formatReplayMoment(value: number): string {
  return REPLAY_MOMENT.format(new Date(value < 1e12 ? value * 1000 : value)) + ' UTC';
}
