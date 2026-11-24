/**
 * 음성 턴의 시각 기록. 숫자만 남기고 받아쓴 글·답 글·소리는 남기지 않습니다.
 * 모든 지연 개선(말 끝 판정, 즉시 반응, 서버 스트리밍, 학습 모델)을 같은 자로 재려고 둡니다.
 */
import type { EndpointRule } from "./endpointPolicy";

export type TurnMark =
  | "speechStart"
  | "speechEnd"
  | "endpoint"
  | "requestSent"
  | "firstReply"
  | "firstAudio"
  | "firstContentAudio";

export interface TurnRecord {
  turnId: number;
  source: "voice" | "text";
  endpointRule: EndpointRule | null;
  endpointDelayMs: number | null;
  marks: Partial<Record<TurnMark, number>>;
  ack: boolean;
  bargeIn: boolean;
  /** 앞 문장이 끝나고 다음 문장 소리가 나기까지(ms). */
  sentenceGapsMs: number[];
}

export interface IntervalSummary {
  key: IntervalKey;
  label: string;
  n: number;
  p50: number | null;
  p90: number | null;
}

export type IntervalKey = "endpointWait" | "firstAudio" | "firstContent" | "server" | "gap";

const INTERVALS: { key: IntervalKey; label: string; from?: TurnMark; to?: TurnMark }[] = [
  { key: "endpointWait", label: "말 끝 대기", from: "speechEnd", to: "endpoint" },
  { key: "firstAudio", label: "첫 소리", from: "endpoint", to: "firstAudio" },
  { key: "firstContent", label: "내용 첫 소리", from: "endpoint", to: "firstContentAudio" },
  { key: "server", label: "서버 응답", from: "requestSent", to: "firstReply" },
  { key: "gap", label: "문장 사이 공백" },
];

export const TURN_LIMIT = 50;

/** 가장 가까운 순위 방식 백분위. 값이 없으면 null. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export function intervalValues(records: readonly TurnRecord[], key: IntervalKey): number[] {
  if (key === "gap") return records.flatMap((record) => record.sentenceGapsMs);
  const spec = INTERVALS.find((item) => item.key === key);
  if (!spec?.from || !spec.to) return [];
  const values: number[] = [];
  for (const record of records) {
    const from = record.marks[spec.from];
    const to = record.marks[spec.to];
    if (from !== undefined && to !== undefined && to >= from) values.push(Math.round(to - from));
  }
  return values;
}

export function summarize(records: readonly TurnRecord[]): IntervalSummary[] {
  return INTERVALS.map(({ key, label }) => {
    const values = intervalValues(records, key);
    return {
      key,
      label,
      n: values.length,
      p50: percentile(values, 50),
      p90: percentile(values, 90),
    };
  });
}

export class TurnTimer {
  private records: TurnRecord[] = [];
  private listeners = new Set<() => void>();
  private version = 0;
  private snapshotCache: { version: number; records: readonly TurnRecord[] } = {
    version: 0,
    records: [],
  };

  constructor(private readonly limit = TURN_LIMIT) {}

  /** 같은 턴을 두 번 시작하면 첫 기록을 지킵니다(StrictMode 로 효과가 두 번 돌 때). */
  begin(
    turnId: number,
    source: TurnRecord["source"],
    marks: Partial<Record<TurnMark, number>> = {},
    endpoint: { rule: EndpointRule; delayMs: number } | null = null,
  ): void {
    if (this.find(turnId)) return;
    this.records.push({
      turnId,
      source,
      endpointRule: endpoint?.rule ?? null,
      endpointDelayMs: endpoint?.delayMs ?? null,
      marks: { ...marks },
      ack: false,
      bargeIn: false,
      sentenceGapsMs: [],
    });
    if (this.records.length > this.limit) this.records.splice(0, this.records.length - this.limit);
    this.changed();
  }

  /** 시각은 처음 것만 남깁니다. */
  mark(turnId: number, mark: TurnMark, at: number): void {
    const record = this.find(turnId);
    if (!record || record.marks[mark] !== undefined) return;
    record.marks[mark] = at;
    this.changed();
  }

  flag(turnId: number, flag: "ack" | "bargeIn"): void {
    const record = this.find(turnId);
    if (!record || record[flag]) return;
    record[flag] = true;
    this.changed();
  }

  gap(turnId: number, ms: number): void {
    const record = this.find(turnId);
    if (!record || !(ms >= 0)) return;
    record.sentenceGapsMs.push(Math.round(ms));
    this.changed();
  }

  clear(): void {
    this.records = [];
    this.changed();
  }

  snapshot = (): readonly TurnRecord[] => {
    if (this.snapshotCache.version !== this.version) {
      this.snapshotCache = {
        version: this.version,
        records: this.records.map((record) => ({
          ...record,
          marks: { ...record.marks },
          sentenceGapsMs: [...record.sentenceGapsMs],
        })),
      };
    }
    return this.snapshotCache.records;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** 내보내기 JSON. 시각은 첫 기록 기준 상대값(ms)이라 기기 시계를 드러내지 않습니다. */
  exportJson(meta: Record<string, string | number | boolean | null> = {}): string {
    const records = this.snapshot();
    const origin = Math.min(
      ...records.flatMap((record) => Object.values(record.marks)),
      Number.POSITIVE_INFINITY,
    );
    const relative = (at: number) => Math.round(at - origin);
    return JSON.stringify(
      {
        format: "buildwise-voice-timing/1",
        meta,
        summary: summarize(records),
        turns: records.map((record) => ({
          ...record,
          marks: Object.fromEntries(
            Object.entries(record.marks).map(([key, value]) => [key, relative(value)]),
          ),
        })),
      },
      null,
      2,
    );
  }

  private find(turnId: number): TurnRecord | undefined {
    return this.records.find((record) => record.turnId === turnId);
  }

  private changed() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}
