/* Tabler (MIT) segmented storage bar and compact card layout adapted for snapshot metadata. */
import { useEffect, useState, type ReactNode } from "react";
import type { ConsultDataSource } from "../data/ConsultDataSource";
import type { CompanyPolicy } from "../data/companyPolicy";
import { applyResponsePolicy } from "../data/demoRules";
import {
  CATEGORY_LABELS,
  CATEGORIES,
  won,
  type CandidateResult,
  type CatalogSummary,
  type Category,
  type Survey,
} from "../types";

export type CatalogTab = "connection" | "policy" | "compare" | "documents";
export function CatalogPanel({
  source,
  policy,
  policies,
  onSave,
  onPreview,
  documents,
  initialTab = "connection",
  sourceForCompany,
}: {
  source: ConsultDataSource;
  policy: CompanyPolicy;
  policies: Record<string, CompanyPolicy>;
  onSave: (policy: CompanyPolicy) => void;
  onPreview: () => void;
  documents: ReactNode;
  initialTab?: CatalogTab;
  sourceForCompany: (policy: CompanyPolicy) => ConsultDataSource;
}) {
  const [tab, setTab] = useState(initialTab);
  const [catalog, setCatalog] = useState<CatalogSummary | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState(policy);
  const [phrasesText, setPhrasesText] = useState(policy.forbiddenPhrases.join(", "));
  const [saved, setSaved] = useState(false);
  const [comparison, setComparison] = useState<
    { company: CompanyPolicy; result: CandidateResult }[]
  >([]);
  const [comparing, setComparing] = useState(false);
  const [comparisonInput, setComparisonInput] = useState<{
    survey: Survey;
    category: Category;
    budget: number;
  } | null>(null);
  useEffect(() => {
    let active = true;
    source.getCatalogSummary?.().then(
      (value) => {
        if (active) setCatalog(value);
      },
      (failure) => {
        if (active) setError(String(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [source, retry]);
  const scopeDescription = CATEGORIES.map((category) => {
    const brands = policy.allowedBrands?.[category];
    return brands
      ? `${CATEGORY_LABELS[category]}: ${brands.length ? brands.join(" · ") : "취급 없음"}`
      : null;
  }).filter(Boolean);
  const responseSample = "최저가 보장! 무조건 호환하며 성능 보장합니다.";
  async function compare() {
    setComparing(true);
    setError("");
    try {
      if (!source.getDemoSurvey)
        throw new Error("이 연결에서는 같은 설문 비교를 아직 지원하지 않습니다.");
      const survey = await source.getDemoSurvey();
      const plan = await source.planConsultation(survey);
      const category = plan.steps[0];
      if (!category) throw new Error("비교할 부품 단계를 찾지 못했습니다.");
      const budget = survey.mode === "replacement" ? survey.budget : plan.allocations[category];
      const results = await Promise.all(
        Object.values(policies).map(async (company) => ({
          company,
          result: await sourceForCompany(company).getCandidates({
            survey,
            category,
            selected: {},
            budget,
            requestedDiscountPercent: 5,
          }),
        })),
      );
      setComparisonInput({ survey, category, budget });
      setComparison(results);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setComparing(false);
    }
  }
  function update<K extends keyof CompanyPolicy>(key: K, value: CompanyPolicy[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }
  return (
    <div className="b2b-page">
      <div className="b2b-page-heading">
        <div>
          <p className="b2b-kicker">우리 회사의 상담 기준</p>
          <h1>상품과 판매 정책 연결</h1>
          <p>같은 AI 팀에 우리 회사의 상품과 응대 기준을 연결합니다.</p>
        </div>
        <span className="seller-soft-label">기업 설정 · 가상</span>
      </div>
      <nav className="b2b-tabs" aria-label="상품과 정책 보기">
        {(
          [
            ["connection", "상품 연결"],
            ["policy", "판매 정책"],
            ["compare", "같은 엔진, 다른 기업"],
            ["documents", "문서 · 응대 자료"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <div className="pc-error" role="alert">
          {error}
          <button
            onClick={() => {
              setError("");
              setRetry(retry + 1);
            }}
          >
            다시 시도
          </button>
        </div>
      )}
      {tab === "connection" && (
        <>
          <section className="seller-card b2b-connection-card">
            <div className="seller-card-heading">
              <div>
                <h2>상품 카탈로그 스냅샷</h2>
                <p>팀 DB에서 추출한 읽기 전용 자료입니다. DB 실시간 연결은 아닙니다.</p>
              </div>
              <span className="seller-live-tag">
                {catalog ? "스냅샷 읽기 완료" : "불러오는 중"}
              </span>
            </div>
            {catalog ? (
              <>
                <div className="b2b-catalog-totals">
                  <div>
                    <span>연결된 상품</span>
                    <strong>
                      {catalog.totalParts.toLocaleString()}
                      <small>개</small>
                    </strong>
                  </div>
                  <div>
                    <span>기업 취급 상품</span>
                    <strong>
                      {catalog.scopedParts.toLocaleString()}
                      <small>개</small>
                    </strong>
                  </div>
                  <div>
                    <span>제조사 호환성 근거</span>
                    <strong>
                      {catalog.compatibilityCount.toLocaleString()}
                      <small>건</small>
                    </strong>
                  </div>
                </div>
                <div className="b2b-segment-bar" aria-label="분류별 상품 구성">
                  {CATEGORIES.map((category, index) => (
                    <span
                      key={category}
                      style={{
                        flex: catalog.categoryCounts[category] ?? 0,
                        background: `var(--b2b-category-${index % 4})`,
                      }}
                      title={`${CATEGORY_LABELS[category]} ${catalog.categoryCounts[category] ?? 0}개`}
                    />
                  ))}
                </div>
                <div className="b2b-category-grid">
                  {CATEGORIES.map((category, index) => (
                    <div key={category}>
                      <i style={{ background: `var(--b2b-category-${index % 4})` }} />
                      <span>{CATEGORY_LABELS[category]}</span>
                      <strong>{(catalog.categoryCounts[category] ?? 0).toLocaleString()}</strong>
                    </div>
                  ))}
                </div>
                <dl className="b2b-metadata">
                  <div>
                    <dt>가격 기준일</dt>
                    <dd>{catalog.priceDate || "정보 없음"} · 테스트 가격</dd>
                  </div>
                  <div>
                    <dt>스냅샷 추출 시각</dt>
                    <dd>
                      {catalog.generatedAt
                        ? new Date(catalog.generatedAt).toLocaleString("ko-KR", {
                            timeZone: "Asia/Seoul",
                          })
                        : "정보 없음"}
                    </dd>
                  </div>
                  <div>
                    <dt>기업 취급 범위</dt>
                    <dd>
                      {scopeDescription.length
                        ? `${scopeDescription.join(" / ")}${scopeDescription.length < CATEGORIES.length ? " / 그 외 분류: 전체" : ""}`
                        : "8개 분류 전체"}{" "}
                      · 가상 기업의 시연 설정
                    </dd>
                  </div>
                </dl>
                <p>
                  부품 이름·브랜드는 제공 스냅샷의 값입니다. 기업별 취급 범위는 시연 설정이며 재고
                  수량을 뜻하지 않습니다.
                </p>
              </>
            ) : (
              <p role="status">상품 수와 호환성 자료를 읽고 있습니다.</p>
            )}
            <div className="b2b-actions">
              <button className="seller-primary" onClick={() => setTab("policy")}>
                판매 정책 설정 →
              </button>
              <button className="seller-secondary" onClick={onPreview}>
                손님 화면에서 시험하기
              </button>
            </div>
          </section>
          <div className="b2b-info-banner">
            사양이 없는 항목은 확인 불가로 표시합니다. 판매량과 재고는 이 스냅샷에 없으므로 만들어
            채우지 않습니다.
          </div>
        </>
      )}
      {tab === "policy" && (
        <form
          className="seller-card b2b-policy-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({ ...draft, version: policy.version + 1 });
            setSaved(true);
          }}
        >
          <div className="seller-card-heading">
            <div>
              <h2>{policy.companyName} 상담 정책</h2>
              <p>저장한 기준은 다음 상담과 다시 실행한 상담에 적용됩니다.</p>
            </div>
            <span className="seller-soft-label">적용 버전 {policy.version}</span>
          </div>
          <label>
            추천 순서
            <select
              aria-label="추천 순서"
              value={draft.sort}
              onChange={(event) => update("sort", event.target.value as CompanyPolicy["sort"])}
            >
              <option value="price">가격 낮은 순</option>
              <option value="brand">선호 브랜드 우선</option>
              <option disabled>재고 우선 · 데이터 준비 중</option>
            </select>
          </label>
          <label>
            우선 추천 브랜드
            <select
              aria-label="우선 추천 브랜드"
              value={draft.preferredBrands[0] ?? ""}
              onChange={(event) =>
                update("preferredBrands", event.target.value ? [event.target.value] : [])
              }
            >
              <option value="">지정하지 않음</option>
              {(catalog?.brands ?? []).map((brand) => (
                <option key={brand}>{brand}</option>
              ))}
            </select>
          </label>
          <div className="b2b-form-row">
            <label>
              할인 자동 응대 한도 (%)
              <input
                aria-label="할인 자동 응대 한도"
                type="number"
                min="0"
                max="30"
                required
                value={draft.maxDiscountPercent}
                onChange={(event) => update("maxDiscountPercent", Number(event.target.value))}
              />
            </label>
            <label>
              자동 견적 검토 한도 (원)
              <input
                aria-label="자동 견적 검토 한도"
                type="number"
                min="0"
                step="10000"
                required
                value={draft.autoQuoteLimit}
                onChange={(event) => update("autoQuoteLimit", Number(event.target.value))}
              />
              <small>{won(draft.autoQuoteLimit)}</small>
            </label>
          </div>
          <fieldset>
            <legend>사람에게 넘길 조건</legend>
            <label className="b2b-checkbox">
              <input
                type="checkbox"
                checked={draft.handoffUnknown}
                onChange={(event) => update("handoffUnknown", event.target.checked)}
              />
              호환성 확인 불가 항목이 있을 때
            </label>
            <label className="b2b-checkbox">
              <input
                type="checkbox"
                checked={draft.handoffConditional}
                onChange={(event) => update("handoffConditional", event.target.checked)}
              />
              BIOS 등 조건부 지원을 확인해야 할 때
            </label>
            <p>설정 여부와 관계없이 확인 불가 후보에는 AI 추천을 붙이지 않습니다.</p>
          </fieldset>
          <label>
            상담에서 쓰지 않을 표현 (쉼표로 구분)
            <textarea
              aria-label="상담 금지 표현"
              value={phrasesText}
              onChange={(event) => {
                setPhrasesText(event.target.value);
                update(
                  "forbiddenPhrases",
                  event.target.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                );
              }}
            />
          </label>
          <div className="b2b-info-banner">
            <strong>금지 표현 치환 시연 · 저장 전 미리보기</strong>
            <p>입력 예시: {responseSample}</p>
            <p>직원 응답: {applyResponsePolicy(responseSample, draft)}</p>
            <small>
              문자열 치환을 확인하는 예시입니다. 고객 원문과 제조사 근거는 바꾸지 않습니다.
            </small>
          </div>
          <div className="b2b-info-banner">
            가격·호환성 판단은 스냅샷 기반 간이 판단입니다. 할인 한도는 담당자 확인 여부에만 쓰며
            테스트 단가를 임의로 바꾸지 않습니다.
          </div>
          <div className="b2b-actions">
            <span role="status">
              {saved
                ? "정책을 적용했습니다. 같은 상담으로 차이를 확인해 주세요."
                : "변경 내용을 저장해 주세요."}
            </span>
            <button className="seller-primary" type="submit">
              정책 저장
            </button>
            <button className="seller-secondary" type="button" onClick={onPreview}>
              같은 상담 다시 시험
            </button>
          </div>
        </form>
      )}
      {tab === "compare" && (
        <>
          <section className="seller-card">
            <div className="seller-card-heading">
              <div>
                <h2>입력은 같고, 기업의 기준은 다릅니다.</h2>
                <p>
                  {comparisonInput
                    ? `${comparisonInput.survey.mode === "replacement" ? "부품 교체" : "신규 조립"} · 전체 예산 ${won(comparisonInput.survey.budget)} · ${CATEGORY_LABELS[comparisonInput.category]} 예산 ${won(comparisonInput.budget)} · 할인 5% 요청`
                    : "실제 스냅샷 보유 부품을 담은 동일한 시연 설문으로 비교합니다. 할인은 5%를 요청합니다."}
                </p>
              </div>
              <button
                className="seller-primary"
                disabled={comparing}
                onClick={() => void compare()}
              >
                {comparing ? "두 기업의 후보를 검증하고 있습니다…" : "같은 설문으로 비교"}
              </button>
            </div>
            <p>
              한 스냅샷과 같은 판단 엔진을 사용합니다. 기업의 취급 범위·우선순위·담당자 인계 기준이
              다릅니다. 아래 결과는 후보 단계의 간이 판단이며 전체 구성 검증 후 인계 조건이 달라질
              수 있습니다.
            </p>
          </section>
          <div className="b2b-comparison">
            {comparison.map(({ company, result }) => (
              <section className="seller-card" key={company.companyCode}>
                <span className="seller-soft-label">가상 기업 설정 · 정책 {company.version}</span>
                <h2>{company.companyName}</h2>
                <p>{result.sortLabel}</p>
                <p className={result.handoff?.required ? "b2b-warning" : "b2b-success"}>
                  {result.handoff?.required
                    ? `사람 확인: ${result.handoff.reasons.join(" · ")}`
                    : "현재 후보는 설정한 자동 응대 범위입니다."}
                </p>
                <ol>
                  {result.passed.slice(0, 3).map((candidate, index) => (
                    <li key={candidate.part.source_key}>
                      <span>{index + 1}</span>
                      <div>
                        <strong>{candidate.part.name}</strong>
                        <p>{candidate.reason || "검증 조건에 맞는 후보입니다."}</p>
                        <p>
                          {candidate.validation.status === "CONDITIONAL"
                            ? "조건부 통과"
                            : "현재 단계 간이 검증 통과"}
                          {candidate.validation.checks
                            .filter((check) => check.status === "CONDITIONAL")
                            .map((check) => ` · ${check.message}`)
                            .join("")}
                        </p>
                        <small>
                          {candidate.part.current_price === null
                            ? "가격 미확인"
                            : `${won(candidate.part.current_price)} · 테스트 가격`}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
                {!result.passed.length && (
                  <p>통과한 후보가 없습니다. 확인이 더 필요한 후보 {result.needsReview.length}개</p>
                )}
              </section>
            ))}
          </div>
        </>
      )}
      {tab === "documents" && documents}
    </div>
  );
}
