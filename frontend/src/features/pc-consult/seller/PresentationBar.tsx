import { useEffect, useState } from "react";
import { PRESENTATION_STEPS, presentationStep } from "./presentationScenario";
import type { SellerMenu } from "./types";
import type { PreviewOutcome } from "./CustomerPreview";

export function PresentationBar({
  onNavigate,
  outcomes,
  onSignup,
}: {
  onNavigate: (menu: SellerMenu, tab?: "connection" | "policy" | "compare") => void;
  outcomes: PreviewOutcome[];
  onSignup: () => void;
}) {
  const [step, setStep] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (step === null || paused) return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [step, paused]);
  function go(index: number) {
    setStep(index);
    onNavigate(PRESENTATION_STEPS[index].menu, PRESENTATION_STEPS[index].tab);
  }
  if (step === null)
    return (
      <button
        className="seller-primary"
        onClick={() => {
          setElapsed(0);
          setPaused(false);
          go(0);
        }}
      >
        3분 발표 모드 시작
      </button>
    );
  const current = PRESENTATION_STEPS[step];
  const latest = outcomes.at(-1),
    first = outcomes[0];
  return (
    <section className="b2b-presentation" aria-label="발표 모드">
      <div className="b2b-presentation-title">
        <span>
          발표 {step + 1} / {PRESENTATION_STEPS.length}
        </span>
        <strong>{current.title}</strong>
        <time>
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} / 약 3분
        </time>
      </div>
      <p>{current.description}</p>
      <nav aria-label="발표 단계">
        {PRESENTATION_STEPS.map((item, index) => (
          <button
            key={item.title}
            aria-current={step === index ? "step" : undefined}
            onClick={() => go(index)}
            title={item.title}
          >
            {index + 1}
            <span>{item.title}</span>
          </button>
        ))}
      </nav>
      {step === 0 && (
        <button className="seller-text-button" onClick={onSignup}>
          기업 시연 가입 절차 보기
        </button>
      )}
      {step === 6 && first && latest && (
        <div className="b2b-presentation-comparison">
          <span>
            처음 · 정책 {first.policyVersion}: {first.handoff ? "사람 확인 필요" : "자동 응대 범위"}
            <small>{first.recommended}</small>
          </span>
          <span>
            현재 · 정책 {latest.policyVersion}:{" "}
            {latest.handoff ? "사람 확인 필요" : "자동 응대 범위"}
            <small>{latest.recommended}</small>
          </span>
        </div>
      )}
      <div className="b2b-actions">
        <button
          className="seller-secondary"
          disabled={step === 0}
          onClick={() => go(presentationStep(step, -1))}
        >
          이전
        </button>
        <button className="seller-secondary" onClick={() => setPaused(!paused)}>
          {paused ? "시간 재개" : "시간 일시정지"}
        </button>
        <button className="seller-text-button" onClick={() => setStep(null)}>
          발표 종료
        </button>
        <button
          className="seller-primary"
          disabled={step === PRESENTATION_STEPS.length - 1}
          onClick={() => go(presentationStep(step, 1))}
        >
          다음 단계 →
        </button>
      </div>
      <small>
        단계 이동은 화면만 바꿉니다. 상담·정책 작업의 완료 상태는 실제 처리 결과를 따릅니다.
      </small>
    </section>
  );
}
