/**
 * 상담 입력 — 실시간 음성 상담이 들어오기 전까지 같은 요구사항 형식을 화면에서 직접 보냅니다.
 */
import { useState, type FormEvent } from "react";
import type { Company, RequirementsIn } from "../../api/client";

const PURPOSES = ["영상 편집", "사무용", "게임", "AI 학습", "서버 가상화", "가볍게 휴대"];

interface Props {
  company: Company;
  disabled: boolean;
  onSubmit: (requirements: RequirementsIn) => void;
}

export function ConsultationForm({ company, disabled, onSubmit }: Props) {
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [types, setTypes] = useState<string[]>([company.product_types[0]?.code ?? "laptop"]);
  const [budget, setBudget] = useState(2_500_000);

  function toggle(code: string) {
    setTypes((current) =>
      current.includes(code) ? current.filter((c) => c !== code) : [...current, code],
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (types.length === 0) return;
    onSubmit({ purpose, product_types: types, budget_max: budget, preferences: {}, note: "" });
  }

  return (
    <form className="panel form" onSubmit={submit} aria-label="상담 입력">
      <h2>상담</h2>
      <label>
        사용 목적
        <input
          list="purposes"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          required
          maxLength={200}
          data-testid="purpose"
        />
        <datalist id="purposes">
          {PURPOSES.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      <fieldset>
        <legend>상품 유형 ({company.name} 취급)</legend>
        {company.product_types.map((t) => (
          <label key={t.code} className="check">
            <input
              type="checkbox"
              checked={types.includes(t.code)}
              onChange={() => toggle(t.code)}
              data-testid={`type-${t.code}`}
            />
            {t.label}
          </label>
        ))}
      </fieldset>
      <label>
        총예산(원)
        <input
          type="number"
          min={100_000}
          step={100_000}
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
          required
          data-testid="budget"
        />
      </label>
      <button type="submit" disabled={disabled || types.length === 0} data-testid="submit">
        요구사항 보내기
      </button>
    </form>
  );
}
