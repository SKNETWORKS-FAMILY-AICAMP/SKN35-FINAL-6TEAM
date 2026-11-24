import { useEffect, useRef, useState, type FormEvent } from "react";
import { PartVisual } from "./PartVisual";
import "./surveyWindowLayout.css";
import type { ConsultDataSource } from "../data/ConsultDataSource";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  won,
  type Category,
  type ConsultMode,
  type OwnedPart,
  type Part,
  type Purpose,
  type Survey,
} from "../types";

const PURPOSES: { value: Purpose; label: string; description: string }[] = [
  { value: "gaming", label: "고사양 게임", description: "즐겨 하는 게임을 더 쾌적하게" },
  { value: "image", label: "이미지 편집", description: "사진 보정과 디자인 작업" },
  { value: "video", label: "동영상 편집", description: "영상 편집과 렌더링 작업" },
  { value: "other", label: "기타", description: "문서 작업과 일상적인 사용" },
];
const PROBLEMS = [
  { value: "gaming", label: "게임이 끊겨요" },
  { value: "multitasking", label: "여러 프로그램을 띄우면 느려요" },
  { value: "storage", label: "저장 공간이 부족해요" },
  { value: "rendering", label: "렌더링이 오래 걸려요" },
  { value: "heat", label: "발열이 심해요" },
  { value: "power", label: "전원이 불안정해요" },
];

export function TypeScreen({ onChoose }: { onChoose: (mode: ConsultMode) => void }) {
  return (
    <section className="pc-type-screen" aria-labelledby="pc-type-title">
      <div className="pc-page-heading">
        <h1 id="pc-type-title">어떤 PC가 필요하세요?</h1>
        <p className="pc-muted">지금 필요한 상담을 선택해 주세요.</p>
      </div>
      <div className="pc-type-grid">
        <button type="button" className="pc-type-card" onClick={() => onChoose("replacement")}>
          <PartVisual category="gpu" name="기존 PC 부품 교체" caption={false} />
          <strong>기존 PC 부품 교체</strong>
          <span className="pc-muted">지금 쓰는 PC에서 필요한 부품만 바꿔요.</span>
          <span className="pc-type-detail">보유 부품 · 현재 문제 · 교체 예산</span>
          <span className="pc-type-cta">
            부품 교체 상담하기 <span aria-hidden="true">↗</span>
          </span>
        </button>
        <button type="button" className="pc-type-card pc-type-new" onClick={() => onChoose("new")}>
          <PartVisual category="case" name="신규 PC 조립" caption={false} />
          <strong>신규 PC 조립</strong>
          <span className="pc-muted">예산과 용도에 맞춰 8가지 부품을 골라요.</span>
          <span className="pc-type-detail">전체 예산 · 사용 목적 · 목표 성능</span>
          <span className="pc-type-cta">
            새 PC 구성하기 <span aria-hidden="true">↗</span>
          </span>
        </button>
      </div>
    </section>
  );
}

function OwnedPicker({
  category,
  value,
  onChange,
  source,
}: {
  category: Category;
  value?: OwnedPart;
  onChange: (value?: OwnedPart) => void;
  source: ConsultDataSource;
}) {
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const [results, setResults] = useState<Part[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );

  async function search(nextQuery: string) {
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const matches = await source.searchParts(category, nextQuery);
      if (id !== requestId.current) return;
      setResults(matches.slice(0, 15));
      setSearched(true);
    } catch (failure) {
      if (id === requestId.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "부품 목록을 불러오지 못했습니다. 다시 시도해 주세요.",
        );
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  function choose(part: OwnedPart) {
    onChange(part);
    if (details.current) {
      details.current.open = false;
      details.current.querySelector("summary")?.focus();
    }
  }

  return (
    <details
      className="pc-owned"
      ref={details}
      onToggle={(event) => {
        if (event.currentTarget.open && !searched && !loading) void search(query);
      }}
    >
      <summary>
        <strong>{CATEGORY_LABELS[category]}</strong>
        <span>{value?.name ?? "보유 부품 선택"}</span>
        {value && (
          <span className={`pc-badge ${value.part ? "pc-badge-ok" : "pc-badge-warn"}`}>
            {value.part ? "목록에서 선택" : "미확인"}
          </span>
        )}
      </summary>
      <div className="pc-owned-body">
        <label className="pc-field" htmlFor={`pc-search-${category}`}>
          제품명 검색
        </label>
        <input
          id={`pc-search-${category}`}
          type="search"
          value={query}
          placeholder="브랜드 또는 제품명을 입력해 주세요"
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            void search(event.target.value);
          }}
        />
        {loading && (
          <p className="pc-muted" role="status">
            부품 목록을 불러오고 있습니다.
          </p>
        )}
        {error && (
          <div className="pc-error" role="alert">
            {error}{" "}
            <button type="button" className="pc-button pc-ghost" onClick={() => void search(query)}>
              다시 시도
            </button>
          </div>
        )}
        {!loading && !error && searched && results.length === 0 && (
          <p className="pc-muted">검색 결과가 없습니다. 아래에서 직접 입력해 주세요.</p>
        )}
        {!loading && !error && (
          <ul className="pc-search-results" aria-label={`${CATEGORY_LABELS[category]} 검색 결과`}>
            {results.map((part) => (
              <li key={part.source_key}>
                <button type="button" onClick={() => choose({ category, name: part.name, part })}>
                  <span>
                    {part.brand} {part.name}
                  </span>
                  <span aria-hidden="true">선택 +</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {results.length === 15 && !loading && (
          <p className="pc-fineprint">
            검색 결과를 최대 15개 표시합니다. 제품명을 더 입력해 주세요.
          </p>
        )}
        <div className="pc-manual-entry">
          <label className="pc-field" htmlFor={`pc-manual-${category}`}>
            목록에 없다면 직접 입력
          </label>
          <div className="pc-inline-input">
            <input
              id={`pc-manual-${category}`}
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              placeholder="보유한 제품명"
              maxLength={150}
            />
            <button
              type="button"
              className="pc-button pc-secondary"
              disabled={!manual.trim()}
              onClick={() => choose({ category, name: manual.trim(), part: null })}
            >
              추가
            </button>
          </div>
          <p className="pc-fineprint">
            직접 입력한 부품은 미확인 상태이며 호환성을 확인할 수 없어요.
          </p>
        </div>
        {value && (
          <button type="button" className="pc-button pc-ghost" onClick={() => onChange(undefined)}>
            이 부품 선택 해제
          </button>
        )}
      </div>
    </details>
  );
}

type FormErrors = Partial<Record<"budget" | "purposes" | "owned" | "problems", string>>;

export function SurveyScreen({
  survey,
  onChange,
  onNext,
  onBack,
  source,
}: {
  survey: Survey;
  onChange: (survey: Survey) => void;
  onNext: () => void;
  onBack: () => void;
  source: ConsultDataSource;
}) {
  const [errors, setErrors] = useState<FormErrors>({});
  const form = useRef<HTMLFormElement>(null);
  const replacement = survey.mode === "replacement";

  function update(patch: Partial<Survey>, field?: keyof FormErrors) {
    onChange({ ...survey, ...patch });
    if (field) setErrors((previous) => ({ ...previous, [field]: undefined }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: FormErrors = {};
    if (!Number.isSafeInteger(survey.budget) || survey.budget <= 0)
      next.budget = "전체 예산을 1원 이상의 정수로 입력해 주세요.";
    if (survey.purposes.length === 0) next.purposes = "사용 목적을 하나 이상 선택해 주세요.";
    if (replacement && Object.values(survey.owned).filter(Boolean).length === 0)
      next.owned = "현재 보유한 부품을 하나 이상 선택하거나 직접 입력해 주세요.";
    if (replacement && survey.problems.length === 0)
      next.problems = "교체 대상을 정할 수 있도록 가까운 문제를 하나 이상 선택해 주세요.";
    setErrors(next);
    if (Object.keys(next).length) {
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    onNext();
  }

  return (
    <section className="pc-survey" aria-labelledby="pc-survey-title">
      <div className="pc-page-heading">
        <span className="pc-eyebrow">01 / 원하는 조건</span>
        <h1 id="pc-survey-title">
          {replacement ? "지금 쓰는 PC, 무엇이 아쉬우세요?" : "어떤 PC를 만들고 싶으세요?"}
        </h1>
        <p className="pc-muted">
          {replacement
            ? "보유 부품과 불편한 점을 알려주시면 교체할 부품을 찾아드려요."
            : "예산과 사용 목적을 알려주세요. 여기에 맞춰 부품을 하나씩 골라드려요."}
        </p>
      </div>
      <form className="pc-form" ref={form} onSubmit={submit} noValidate>
        <div className="pc-form-fields">
          <section className="pc-section">
            <div className="pc-section-heading">
              <span className="pc-section-number">01</span>
              <h2>{replacement ? "전체 교체 예산" : "전체 예산"}</h2>
              <span className="pc-required">필수</span>
            </div>
            <label className="pc-field" htmlFor="pc-budget">
              얼마까지 생각하고 계세요?
            </label>
            <div className="pc-budget-input">
              <span aria-hidden="true">₩</span>
              <input
                id="pc-budget"
                inputMode="numeric"
                value={survey.budget ? survey.budget.toLocaleString("ko-KR") : ""}
                placeholder="예: 1,500,000"
                aria-required="true"
                aria-invalid={Boolean(errors.budget)}
                aria-describedby={errors.budget ? "pc-budget-error" : "pc-budget-help"}
                onChange={(event) =>
                  update(
                    { budget: Number(event.target.value.replace(/\D/g, "").slice(0, 12)) },
                    "budget",
                  )
                }
              />
            </div>
            {errors.budget ? (
              <p className="pc-error" id="pc-budget-error">
                {errors.budget}
              </p>
            ) : (
              <p className="pc-fineprint" id="pc-budget-help">
                카탈로그에 기록된 부품 가격을 기준으로 계산해요.
              </p>
            )}
          </section>
          <section className="pc-section">
            <div className="pc-section-heading">
              <span className="pc-section-number">02</span>
              <h2>주요 사용 목적</h2>
              <span className="pc-required">필수 · 여러 개 선택 가능</span>
            </div>
            <fieldset
              className="pc-choice-fieldset"
              aria-invalid={Boolean(errors.purposes)}
              aria-describedby={errors.purposes ? "pc-purpose-error" : undefined}
              tabIndex={-1}
            >
              <legend className="pc-sr-only">주요 사용 목적</legend>
              <div className="pc-choice-grid">
                {PURPOSES.map((purpose) => (
                  <label
                    className={`pc-choice ${survey.purposes.includes(purpose.value) ? "pc-choice-selected" : ""}`}
                    key={purpose.value}
                  >
                    <input
                      type="checkbox"
                      value={purpose.value}
                      checked={survey.purposes.includes(purpose.value)}
                      onChange={() =>
                        update(
                          {
                            purposes: survey.purposes.includes(purpose.value)
                              ? survey.purposes.filter((item) => item !== purpose.value)
                              : [...survey.purposes, purpose.value],
                          },
                          "purposes",
                        )
                      }
                    />
                    <span>
                      <strong>{purpose.label}</strong>
                      <small>{purpose.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {errors.purposes && (
              <p className="pc-error" id="pc-purpose-error">
                {errors.purposes}
              </p>
            )}
          </section>
          {!replacement && (
            <section className="pc-section">
              <div className="pc-section-heading">
                <span className="pc-section-number">03</span>
                <h2>원하는 성능</h2>
              </div>
              <div className="pc-form-grid">
                <label className="pc-field">
                  목표 해상도
                  <select
                    value={survey.resolution}
                    onChange={(event) =>
                      update({ resolution: event.target.value as Survey["resolution"] })
                    }
                  >
                    <option value="fhd">FHD · 일반 모니터</option>
                    <option value="qhd">QHD · 더 선명한 화면</option>
                    <option value="4k">4K · 고해상도 화면</option>
                  </select>
                </label>
                <label className="pc-field">
                  목표 프레임
                  <select
                    value={survey.frameRate}
                    onChange={(event) =>
                      update({ frameRate: event.target.value as Survey["frameRate"] })
                    }
                  >
                    <option value="60">초당 60프레임 · 일반적인 움직임</option>
                    <option value="144">초당 144프레임 · 더 부드러운 움직임</option>
                  </select>
                </label>
                <label className="pc-field">
                  작업 규모
                  <select
                    value={survey.workScale}
                    onChange={(event) =>
                      update({ workScale: event.target.value as Survey["workScale"] })
                    }
                  >
                    <option value="basic">기본 · 일반 문서와 간단한 편집</option>
                    <option value="large">대규모 · 큰 파일과 복잡한 편집</option>
                  </select>
                </label>
              </div>
              <p className="pc-notice">
                사양 하한으로 후보를 찾는 간이 판단이에요. 실제 게임 프레임이나 작업 속도를 보장하지
                않으며, 적용한 기준은 후보 화면에서 보여드려요.
              </p>
            </section>
          )}
          {replacement && (
            <>
              <section
                className="pc-section"
                tabIndex={-1}
                aria-invalid={Boolean(errors.owned)}
                aria-describedby={errors.owned ? "pc-owned-error" : undefined}
              >
                <div className="pc-section-heading">
                  <span className="pc-section-number">03</span>
                  <h2>현재 보유한 부품</h2>
                  <span className="pc-required">필수</span>
                </div>
                <p className="pc-muted">
                  아는 부품부터 선택해 주세요. 입력하지 않은 부품은 확인 불가로 안내해 드려요.
                </p>
                {errors.owned && (
                  <p className="pc-error" id="pc-owned-error">
                    {errors.owned}
                  </p>
                )}
                <div className="pc-owned-list">
                  {CATEGORIES.map((category) => (
                    <OwnedPicker
                      key={category}
                      category={category}
                      value={survey.owned[category]}
                      source={source}
                      onChange={(value) => {
                        const owned = { ...survey.owned };
                        if (value) owned[category] = value;
                        else delete owned[category];
                        update({ owned }, "owned");
                      }}
                    />
                  ))}
                </div>
              </section>
              <section className="pc-section">
                <div className="pc-section-heading">
                  <span className="pc-section-number">04</span>
                  <h2>지금 겪는 문제</h2>
                  <span className="pc-required">필수 · 여러 개 선택 가능</span>
                </div>
                <fieldset
                  className="pc-choice-fieldset"
                  tabIndex={-1}
                  aria-invalid={Boolean(errors.problems)}
                  aria-describedby={errors.problems ? "pc-problem-error" : undefined}
                >
                  <legend className="pc-sr-only">지금 겪는 문제</legend>
                  <div className="pc-choice-grid">
                    {PROBLEMS.map((problem) => (
                      <label
                        className={`pc-choice ${survey.problems.includes(problem.value) ? "pc-choice-selected" : ""}`}
                        key={problem.value}
                      >
                        <input
                          type="checkbox"
                          checked={survey.problems.includes(problem.value)}
                          onChange={() =>
                            update(
                              {
                                problems: survey.problems.includes(problem.value)
                                  ? survey.problems.filter((item) => item !== problem.value)
                                  : [...survey.problems, problem.value],
                              },
                              "problems",
                            )
                          }
                        />
                        <span>{problem.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {errors.problems && (
                  <p className="pc-error" id="pc-problem-error">
                    {errors.problems}
                  </p>
                )}
                <label className="pc-field" htmlFor="pc-problem-note">
                  더 알려주실 내용이 있나요? <span className="pc-muted">선택</span>
                </label>
                <textarea
                  id="pc-problem-note"
                  rows={3}
                  maxLength={1000}
                  value={survey.problemNote}
                  placeholder="언제 불편한지, 어떤 작업을 하는지 알려주세요."
                  onChange={(event) => update({ problemNote: event.target.value })}
                />
                <p className="pc-fineprint">
                  자유 입력은 상담 메모로 남아요. 위에서 선택한 문제를 기준으로 교체 대상을 정해요.
                </p>
              </section>
            </>
          )}
        </div>
        <div className="pc-actions">
          <button type="button" className="pc-button pc-secondary" onClick={onBack}>
            이전으로
          </button>
          <button type="submit" className="pc-button pc-primary">
            입력 내용 확인 <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>
    </section>
  );
}

export function ReviewScreen({
  survey,
  onEdit,
  onStart,
  loading,
  error,
}: {
  survey: Survey;
  onEdit: () => void;
  onStart: () => void;
  loading: boolean;
  error?: string;
}) {
  return (
    <section className="pc-review" aria-labelledby="pc-review-title">
      <div className="pc-review-body">
        <div className="pc-page-heading">
          <span className="pc-eyebrow">상담 시작 전 확인</span>
          <h1 id="pc-review-title">이 내용으로 상담을 시작할까요?</h1>
          <p className="pc-muted">설계팀에 전달할 내용을 확인해 주세요.</p>
        </div>
        <div className="pc-section">
          <dl className="pc-summary-grid">
            <div>
              <dt>상담 유형</dt>
              <dd>{survey.mode === "new" ? "신규 PC 조립" : "기존 PC 부품 교체"}</dd>
            </div>
            <div>
              <dt>전체 예산</dt>
              <dd className="pc-price">{won(survey.budget)}</dd>
            </div>
            <div>
              <dt>주요 사용 목적</dt>
              <dd>
                {survey.purposes
                  .map((value) => PURPOSES.find((purpose) => purpose.value === value)?.label)
                  .join(" · ")}
              </dd>
            </div>
            {survey.mode === "new" && (
              <div>
                <dt>원하는 성능</dt>
                <dd>
                  {survey.resolution.toUpperCase()} · 초당 {survey.frameRate}프레임 목표
                  <br />
                  {survey.workScale === "basic" ? "기본 작업" : "대규모 작업"}
                </dd>
              </div>
            )}
            {survey.mode === "replacement" && (
              <div>
                <dt>현재 겪는 문제</dt>
                <dd>
                  {survey.problems
                    .map((value) => PROBLEMS.find((problem) => problem.value === value)?.label)
                    .filter(Boolean)
                    .join(" · ")}
                </dd>
              </div>
            )}
          </dl>
          {survey.mode === "replacement" && (
            <>
              <h2>보유 부품</h2>
              <ul className="pc-summary-list">
                {CATEGORIES.filter((category) => survey.owned[category]).map((category) => {
                  const owned = survey.owned[category]!;
                  return (
                    <li key={category}>
                      <span>{CATEGORY_LABELS[category]}</span>
                      <strong>{owned.name}</strong>
                      {!owned.part && <span className="pc-badge pc-badge-warn">미확인</span>}
                    </li>
                  );
                })}
              </ul>
              {survey.problemNote && <p className="pc-notice">추가 메모: {survey.problemNote}</p>}
            </>
          )}
        </div>
        <p className="pc-notice">부품 DB에서 예산에 맞는 후보와 호환성 근거를 조회해요.</p>
        {loading && (
          <p className="pc-muted" role="status">
            설계팀이 부품 DB에서 상담 구성을 확인하고 있습니다.
          </p>
        )}
        {error && (
          <p className="pc-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="pc-actions">
        <button
          type="button"
          className="pc-button pc-secondary"
          disabled={loading}
          onClick={onEdit}
        >
          입력 내용 고치기
        </button>
        <button type="button" className="pc-button pc-primary" disabled={loading} onClick={onStart}>
          {loading ? "상담 준비 중…" : error ? "다시 시도" : "상담 시작"}{" "}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
