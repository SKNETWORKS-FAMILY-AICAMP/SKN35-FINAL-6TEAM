import { useEffect, useState, type FormEvent } from "react";
import type { AccountKind } from "../types";
import { DEMO_COMPANIES } from "../seller/mockData";
import type { SellerSession, SellerRole } from "../seller/types";
import { WelcomeStage } from "./WelcomeStage";
import "./entryScreen.css";

export function StartScreen({
  onEnter,
  onBusinessEnter,
}: {
  onEnter: (account: AccountKind) => void;
  onBusinessEnter: (session: SellerSession) => void;
}) {
  const [account, setAccount] = useState<AccountKind>("business");
  const [signup, setSignup] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [companyCode, setCompanyCode] = useState<string>(DEMO_COMPANIES[0].code);
  const [stageOpen, setStageOpen] = useState(() => window.matchMedia("(min-width: 761px)").matches);
  const accountLabel = account === "business" ? "기업용" : "개인용";

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 761px)");
    const resize = (event: MediaQueryListEvent) => setStageOpen(event.matches);
    desktop.addEventListener("change", resize);
    return () => desktop.removeEventListener("change", resize);
  }, []);

  function enter(role: SellerRole = "admin", userName = "시연 사용자") {
    if (account === "business") {
      const company = DEMO_COMPANIES.find((item) => item.code === companyCode) ?? DEMO_COMPANIES[0];
      onBusinessEnter({ companyCode: company.code, companyName: company.name, userName, role });
    } else onEnter("personal");
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const userId = String(values.get("userId") ?? "").trim();
    const password = String(values.get("password") ?? "");
    if (!userId || !password) {
      setError("아이디와 비밀번호를 모두 입력해 주세요.");
      form.querySelector<HTMLInputElement>(!userId ? "[name=userId]" : "[name=password]")?.focus();
      return;
    }
    if (signup) {
      if (account === "business") {
        const company = DEMO_COMPANIES.find(
          (item) => item.code === String(values.get("companyCode") ?? "").trim(),
        );
        if (!company) {
          setError("등록되지 않은 기업 인증번호입니다");
          form.querySelector<HTMLInputElement>("[name=companyCode]")?.focus();
          return;
        }
        setCompanyCode(company.code);
      }
      form.reset();
      setSignup(false);
      setShowPassword(false);
      setError("");
      setNotice(
        "시연 회원가입이 완료되었습니다. 실제 계정은 저장되지 않으며, 원하는 아이디로 시연 로그인할 수 있습니다.",
      );
    } else {
      form.reset();
      enter("admin", userId);
    }
  }
  function choose(kind: AccountKind) {
    setAccount(kind);
    setSignup(false);
    setNotice("");
    setError("");
    setShowPassword(false);
  }
  function changeMode() {
    setSignup(!signup);
    setNotice("");
    setError("");
    setShowPassword(false);
  }
  return (
    <div className="pc-start bw-entry" data-stage="login" data-account={account}>
      <section className="pc-hero" aria-labelledby="pc-welcome-title">
        <div className="bw-entry-brand">
          <span className="bw-entry-wordmark">
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="9" fill="currentColor" />
              <path d="M7 7h7v7H7Zm11 0h7v7h-7ZM7 18h7v7H7Zm11 0h3v3h4v4h-7Z" fill="#f7f9ed" />
            </svg>
            BUILDWISE
          </span>
          <span className="bw-entry-demo-tag">시연 공간</span>
        </div>
        <div className="bw-entry-hero-copy">
          <p className="bw-entry-kicker">기업의 기준으로, 고객의 편에서</p>
          <h1 id="pc-welcome-title">
            일 잘하는 AI 팀,
            <br />
            <em>이제 우리 회사에.</em>
          </h1>
          <p className="pc-hero-copy">
            상품과 판매 정책을 연결하면,
            <br />
            상담부터 견적까지 함께하는 팀이 생깁니다.
          </p>
        </div>
        <details
          className="bw-entry-art"
          open={stageOpen}
          onToggle={(event) => setStageOpen(event.currentTarget.open)}
        >
          <summary>
            <span>어떤 팀이 함께하나요?</span>
            <span aria-hidden="true">＋</span>
          </summary>
          <div className="bw-entry-stage-wrap">
            <WelcomeStage />
          </div>
        </details>
        <p className="bw-entry-lobby-note">
          <span aria-hidden="true">◇</span> 같은 엔진에 우리 회사의 기준을 담습니다.
        </p>
      </section>
      <section className="pc-login" aria-labelledby="pc-login-title">
        <div className="bw-entry-form-inner">
          <div className="bw-entry-form-heading">
            <h2 id="pc-login-title">{signup ? "처음 만나서 반가워요." : "함께 시작해 볼까요?"}</h2>
            <p>
              {signup
                ? "실제 계정이 저장되지 않는 시연 회원가입입니다."
                : account === "business"
                  ? "우리 회사의 AI 상담팀을 만나보세요."
                  : "부품 교체부터 새 PC 조립까지, 함께 찾아드려요."}
            </p>
          </div>
          <div className="pc-account-tabs" role="group" aria-label="로그인 계정 유형">
            {(["business", "personal"] as const).map((kind) => (
              <button
                type="button"
                key={kind}
                aria-label={kind === "business" ? "기업용" : "개인용"}
                aria-pressed={account === kind}
                onClick={() => choose(kind)}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  {kind === "business" ? (
                    <path d="M4 17V3h8v14M12 8h4v9M2 17h16M7 6h2M7 9h2M7 12h2" />
                  ) : (
                    <>
                      <circle cx="10" cy="6" r="3" />
                      <path d="M4 17v-1a6 6 0 0 1 12 0v1" />
                    </>
                  )}
                </svg>
                {kind === "business" ? "기업" : "개인"}
              </button>
            ))}
          </div>
          <form
            className="pc-form"
            onSubmit={submit}
            key={account + signup}
            aria-label={accountLabel + (signup ? " 회원가입" : " 로그인")}
            noValidate
          >
            <label className="pc-field">
              아이디
              <input
                name="userId"
                autoComplete="off"
                placeholder="시연용 아이디"
                maxLength={50}
                aria-invalid={error.includes("아이디") || undefined}
                aria-describedby={error.includes("아이디") ? "pc-login-error" : undefined}
              />
            </label>
            <div className="pc-field">
              <label htmlFor="pc-password">비밀번호</label>
              <div className="pc-password-field">
                <input
                  id="pc-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="off"
                  placeholder="시연용 비밀번호"
                  aria-invalid={error.includes("비밀번호") || undefined}
                  aria-describedby={error.includes("비밀번호") ? "pc-login-error" : undefined}
                />
                <button
                  type="button"
                  className="bw-entry-password-toggle"
                  aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" />
                    <circle cx="10" cy="10" r="2" />
                    {showPassword && <path d="m3 3 14 14" />}
                  </svg>
                </button>
              </div>
            </div>
            {account === "business" &&
              (signup ? (
                <label className="pc-field">
                  기업 인증번호
                  <input
                    name="companyCode"
                    aria-label="기업 인증번호"
                    placeholder="예: BW-1001"
                    autoComplete="off"
                    aria-invalid={error.includes("인증번호") || undefined}
                    aria-describedby={`pc-company-hint${error.includes("인증번호") ? " pc-login-error" : ""}`}
                  />
                  <small id="pc-company-hint" className="pc-muted">
                    시연 번호: BW-1001 (가상전자), BW-2002 (테스트컴퓨터)
                  </small>
                </label>
              ) : (
                <label className="pc-field">
                  시연 기업
                  <select
                    aria-label="시연 기업"
                    value={companyCode}
                    onChange={(event) => setCompanyCode(event.target.value)}
                  >
                    {DEMO_COMPANIES.map((company) => (
                      <option key={company.code} value={company.code}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            {error && (
              <p id="pc-login-error" className="pc-error" role="alert">
                {error}
              </p>
            )}
            <button className="pc-button pc-primary bw-entry-submit" type="submit">
              {signup ? "회원가입" : "로그인"}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <p className="bw-entry-switch-mode">
            <span>{signup ? "이미 둘러보셨나요?" : "BUILDWISE가 처음이신가요?"}</span>
            <button type="button" onClick={changeMode}>
              {signup ? "로그인으로 돌아가기" : "회원가입"}
            </button>
          </p>
          {notice && (
            <p className="pc-notice" role="status">
              {notice}
            </p>
          )}
          <div className="pc-login-demo">
            <p className="bw-entry-demo-divider">입력 없이 빠르게 둘러보기</p>
            {account === "business" ? (
              <div className="pc-role-buttons">
                <button
                  type="button"
                  className="pc-button pc-secondary"
                  onClick={() => enter("admin", "가상관리")}
                >
                  관리자로 시연 <span aria-hidden="true">↗</span>
                </button>
                <button
                  type="button"
                  className="pc-button pc-secondary"
                  onClick={() => enter("agent", "가상상담")}
                >
                  상담원으로 시연 <span aria-hidden="true">↗</span>
                </button>
              </div>
            ) : (
              <button type="button" className="pc-button pc-secondary" onClick={() => enter()}>
                개인용 시연으로 시작 <span aria-hidden="true">↗</span>
              </button>
            )}
          </div>
          <p className="pc-fineprint bw-entry-privacy">
            원하는 아이디와 비밀번호로 체험하세요.
            <br />
            비밀번호는 저장하거나 전송하지 않습니다.
          </p>
        </div>
      </section>
    </div>
  );
}
