import { useEffect, useState } from "react";
import { api, errorMessage, type Company } from "../api/client";
import { ConsultationForm } from "../features/consultation/ConsultationForm";
import { OfficeBoard } from "../features/office/OfficeBoard";
import { OrderButton } from "../features/orders/OrderButton";
import { QuotationTable } from "../features/quotations/QuotationTable";
import { RecommendationList } from "../features/recommendations/RecommendationList";
import { useConsultation } from "./useConsultation";

const MOCK = new URLSearchParams(window.location.search).has("mock");

const CONNECTION_LABEL = {
  connecting: "연결 중",
  open: "실시간 연결됨",
  reconnecting: "다시 연결 중",
  closed: "연결 끊김",
} as const;

function Workspace({ company }: { company: Company | null }) {
  const { office, connection, recommendations, quotation, error, submit, retry, sessionId } =
    useConsultation(company, MOCK);

  return (
    <>
      <p className="connection" data-testid="connection">
        {MOCK ? "가짜 이벤트 재생 중(?mock=1)" : CONNECTION_LABEL[connection]}
        {sessionId && <span className="muted mono"> · 세션 {sessionId.slice(0, 8)}</span>}
      </p>
      {error && <p className="error">{error}</p>}
      <div className="layout">
        <div className="column">
          {company && (
            <ConsultationForm company={company} disabled={MOCK || !sessionId} onSubmit={submit} />
          )}
        </div>
        <div className="column wide">
          <OfficeBoard state={office} onRetry={retry} />
          <RecommendationList items={recommendations} />
        </div>
        <div className="column">
          <QuotationTable quotation={quotation} />
          {company && <OrderButton companyId={company.id} quotation={quotation} />}
        </div>
      </div>
    </>
  );
}

export function App() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (MOCK) return;
    api.GET("/api/companies").then(({ data, error }) => {
      if (data) {
        setCompanies(data);
        setCompanyId(data[0]?.id ?? null);
      } else {
        setLoadError(errorMessage(error));
      }
    });
  }, []);

  const company = companies.find((c) => c.id === companyId) ?? null;

  return (
    <main>
      <header className="top">
        <h1>BUILDWISE</h1>
        <span className="badge" data-testid="test-data-badge">
          테스트 데이터 · Mock 모드
        </span>
        {companies.length > 0 && (
          <label className="company">
            기업(시연용 전환 · 인증 아님)
            <select
              value={companyId ?? ""}
              onChange={(e) => setCompanyId(Number(e.target.value))}
              data-testid="company"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {loadError && <p className="error">기업 목록을 불러오지 못했습니다: {loadError}</p>}
      <Workspace key={company?.id ?? "none"} company={company} />
    </main>
  );
}
