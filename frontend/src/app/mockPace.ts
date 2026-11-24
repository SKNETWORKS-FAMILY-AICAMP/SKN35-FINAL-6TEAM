/**
 * 시연 재생 간격. 주소의 pace 값으로 고릅니다.
 * - 없으면 700ms, pace=slow 면 2000ms, pace=<숫자> 면 300~5000ms 안으로 맞춥니다.
 */
export const DEFAULT_MOCK_INTERVAL_MS = 700;
export const SLOW_MOCK_INTERVAL_MS = 2000;
export const MIN_MOCK_INTERVAL_MS = 300;
export const MAX_MOCK_INTERVAL_MS = 5000;

export function mockIntervalFromSearch(search: string): number {
  const pace = new URLSearchParams(search).get("pace")?.trim();
  if (!pace) return DEFAULT_MOCK_INTERVAL_MS;
  if (pace === "slow") return SLOW_MOCK_INTERVAL_MS;
  const value = Number(pace);
  if (!Number.isFinite(value)) return DEFAULT_MOCK_INTERVAL_MS;
  return Math.min(MAX_MOCK_INTERVAL_MS, Math.max(MIN_MOCK_INTERVAL_MS, Math.round(value)));
}
