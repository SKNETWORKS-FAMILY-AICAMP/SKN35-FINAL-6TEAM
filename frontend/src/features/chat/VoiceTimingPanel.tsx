/** ?voice-debug 에서만 보이는 턴 시간 표. 숫자만 보여 주고 받아쓴 글은 보여 주지 않습니다. */
import { useSyncExternalStore } from "react";
import { summarize, type TurnTimer } from "./turnTiming";

const RULE_LABEL: Record<string, string> = {
  final: "끝맺음",
  continuation: "이어짐",
  filler: "채움말",
  short: "짧은 말",
  default: "기본",
};

function ms(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : `${value}`;
}

export function VoiceTimingPanel({ timer }: { timer: TurnTimer }) {
  const records = useSyncExternalStore(timer.subscribe, timer.snapshot, timer.snapshot);
  const rows = summarize(records);
  const recent = records.slice(-5).reverse();

  function download() {
    const blob = new Blob([timer.exportJson({ userAgent: navigator.userAgent })], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `voice-timing-${records.length}turns.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <section className="voice-timing" aria-label="음성 턴 시간 기록" data-testid="voice-timing">
      <div className="voice-timing-head">
        <h3>턴 시간 기록 (ms, 최근 {records.length}턴)</h3>
        <div>
          <button type="button" onClick={download} data-testid="voice-timing-export">
            JSON 내보내기
          </button>
          <button type="button" onClick={() => timer.clear()}>
            비우기
          </button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">구간</th>
            <th scope="col">n</th>
            <th scope="col">p50</th>
            <th scope="col">p90</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} data-interval={row.key}>
              <th scope="row">{row.label}</th>
              <td>{row.n}</td>
              <td>{ms(row.p50)}</td>
              <td>{ms(row.p90)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {recent.length > 0 && (
        <ol className="voice-timing-recent">
          {recent.map((record) => {
            const { endpoint, firstAudio, firstContentAudio } = record.marks;
            const since = (at: number | undefined) =>
              endpoint !== undefined && at !== undefined ? Math.round(at - endpoint) : null;
            return (
              <li key={record.turnId}>
                {record.turnId}번 {record.source === "voice" ? "음성" : "글"}
                {record.endpointRule
                  ? ` · ${RULE_LABEL[record.endpointRule]} ${ms(record.endpointDelayMs)}`
                  : ""}
                {` · 첫 소리 ${ms(since(firstAudio))} · 내용 ${ms(since(firstContentAudio))}`}
                {record.ack ? " · 즉시 반응" : ""}
                {record.bargeIn ? " · 끼어듦" : ""}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
