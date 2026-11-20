import { useState, type FormEvent } from "react";
import type { AccountKind } from "../types";
import { DEMO_COMPANIES } from "../seller/mockData";
import type { SellerSession, SellerRole } from "../seller/types";

export function StartScreen({
  onEnter,
  onBusinessEnter,
}: {
  onEnter: (account: AccountKind) => void;
  onBusinessEnter: (session: SellerSession) => void;
}) {
  const [account, setAccount] = useState<AccountKind | null>(null);
  const [signup, setSignup] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [companyCode, setCompanyCode] = useState<string>(DEMO_COMPANIES[0].code);
  const accountLabel = account === "business" ? "기업용" : "개인용";
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
  return (
    <div className="pc-start">
      <section className="pc-hero" aria-labelledby="pc-welcome-title">
        <span className="pc-eyebrow">나의 장비부터 기업의 고객센터까지</span>
        <h1 id="pc-welcome-title">
          더 나은 선택,
          <br />
          함께 만드는 내일.
        </h1>
        <p className="pc-hero-copy">
          개인에게는 나에게 맞는 PC 상담을.
          <br />
          기업에게는 한눈에 보이는 AI 고객센터를.
        </p>
        <div className="pc-machine" aria-hidden="true">
          <svg viewBox="0 0 580 350" fill="none">
            <defs>
              <linearGradient
                id="pc-tower-side"
                x1="260"
                y1="50"
                x2="460"
                y2="300"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#d4dff4" />
                <stop offset="1" stopColor="#a2b5d6" />
              </linearGradient>
              <linearGradient
                id="pc-tower-glass"
                x1="156"
                y1="85"
                x2="332"
                y2="290"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#243f6a" />
                <stop offset="1" stopColor="#101e38" />
              </linearGradient>
            </defs>
            <ellipse cx="305" cy="312" rx="185" ry="20" fill="#183d80" opacity=".08" />
            <path d="M178 75 313 35 420 80 288 125Z" fill="#e4ebf9" stroke="#a7badb" />
            <path d="m288 125 132-45v200l-132 47Z" fill="url(#pc-tower-side)" stroke="#93a9cf" />
            <path d="M178 75 288 125v202l-110-55Z" fill="#eef3fc" stroke="#a7badb" />
            <path d="m190 95 86 38v170l-86-42Z" fill="url(#pc-tower-glass)" />
            <path d="m205 124 55 26v59l-55-26Z" fill="#406295" stroke="#6f94c8" />
            <path d="m213 140 34 16v32l-34-16Z" fill="#a3c9ff" />
            <path d="m202 220 62 29v14l-62-29Z" fill="#759bce" />
            <path d="m200 244 64 30v11l-64-30Z" fill="#263c5d" />
            <ellipse
              cx="354"
              cy="143"
              rx="32"
              ry="37"
              transform="rotate(17 354 143)"
              fill="#526d98"
            />
            <ellipse
              cx="354"
              cy="143"
              rx="23"
              ry="28"
              transform="rotate(17 354 143)"
              stroke="#c8e2ff"
              strokeWidth="4"
            />
            <path d="m354 130 7 12-7 14-7-12Z" fill="#bed7fc" />
            <ellipse
              cx="354"
              cy="229"
              rx="32"
              ry="37"
              transform="rotate(17 354 229)"
              fill="#526d98"
            />
            <ellipse
              cx="354"
              cy="229"
              rx="23"
              ry="28"
              transform="rotate(17 354 229)"
              stroke="#c8e2ff"
              strokeWidth="4"
            />
            <path d="m354 216 7 12-7 14-7-12Z" fill="#bed7fc" />
            <path d="m302 99 42-14" stroke="#8a9fc0" strokeWidth="4" strokeLinecap="round" />
            <circle cx="367" cy="77" r="4" fill="#2457d6" />
            <rect x="87" y="172" width="105" height="49" rx="12" fill="white" stroke="#d7e3f4" />
            <path
              d="m102 196 6 6 12-14"
              stroke="#1f8a4c"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M132 189h43m-43 12h28"
              stroke="#91a6c6"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <rect x="399" y="118" width="95" height="49" rx="12" fill="white" stroke="#d7e3f4" />
            <rect x="413" y="134" width="15" height="18" rx="3" fill="#dbe7fc" />
            <path
              d="M441 135h36m-36 13h24"
              stroke="#91a6c6"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <div className="pc-hero-stat">
          <span>
            01 <strong>목적에 맞는 설계</strong>
          </span>
          <span>
            02 <strong>연결되는 업무</strong>
          </span>
          <span>
            03 <strong>투명한 진행</strong>
          </span>
        </div>
      </section>
      <section className="pc-login" aria-labelledby="pc-login-title">
        <span className="pc-eyebrow">빌드와이즈에 오신 것을 환영합니다</span>
        <h2 id="pc-login-title">
          {!account
            ? "어떤 계정으로 시작할까요?"
            : accountLabel + (signup ? " 회원가입" : " 로그인")}
        </h2>
        {!account ? (
          <>
            <p className="pc-muted">필요한 서비스를 선택해 주세요.</p>
            <div className="pc-entry-choices">
              <button className="pc-entry-card" onClick={() => choose("business")}>
                <span className="pc-entry-symbol" aria-hidden="true">
                  ▦
                </span>
                <span>
                  <strong>기업</strong>
                  <small>AI 고객센터와 판매 현황을 관리해요.</small>
                </span>
                <b aria-hidden="true">→</b>
              </button>
              <button className="pc-entry-card" onClick={() => choose("personal")}>
                <span className="pc-entry-symbol" aria-hidden="true">
                  ◇
                </span>
                <span>
                  <strong>개인</strong>
                  <small>부품 교체와 새 PC 조립을 상담해요.</small>
                </span>
                <b aria-hidden="true">→</b>
              </button>
            </div>
            <p className="pc-notice">
              서버 없이 체험하는 시연입니다. 실제 인증·주문·결제는 진행되지 않습니다.
            </p>
          </>
        ) : (
          <>
            <div className="pc-account-tabs" aria-label="로그인 계정 유형">
              {(["personal", "business"] as const).map((kind) => (
                <button
                  type="button"
                  key={kind}
                  aria-pressed={account === kind}
                  onClick={() => choose(kind)}
                >
                  {kind === "personal" ? "개인용" : "기업용"}
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
                  placeholder="시연용 아이디를 입력해 주세요"
                  maxLength={50}
                />
              </label>
              <label className="pc-field" htmlFor="pc-password">
                비밀번호
              </label>
              <div className="pc-password-field">
                <input
                  id="pc-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="off"
                  placeholder="시연용 비밀번호"
                />
                <button
                  type="button"
                  className="pc-button pc-ghost"
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? "숨기기" : "보기"}
                </button>
              </div>
              {account === "business" &&
                (signup ? (
                  <label className="pc-field">
                    기업 인증번호
                    <input
                      name="companyCode"
                      placeholder="예: BW-1001"
                      aria-invalid={error.includes("인증번호") || undefined}
                      aria-describedby="pc-company-hint"
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
                <p className="pc-error" role="alert">
                  {error}
                </p>
              )}
              <button className="pc-button pc-primary" type="submit">
                {signup ? "회원가입" : "로그인"}
              </button>
              <button
                className="pc-button pc-ghost"
                type="button"
                onClick={() => {
                  setSignup(!signup);
                  setNotice("");
                  setError("");
                }}
              >
                {signup ? "로그인으로 돌아가기" : "회원가입"}
              </button>
            </form>
            {notice && (
              <p className="pc-notice" role="status">
                {notice}
              </p>
            )}
            <div className="pc-login-demo">
              <p className="pc-muted">입력 없이 바로 체험하셔도 좋아요.</p>
              {account === "business" ? (
                <div className="pc-role-buttons">
                  <button
                    type="button"
                    className="pc-button pc-primary"
                    onClick={() => enter("admin", "가상관리")}
                  >
                    관리자로 시연
                  </button>
                  <button
                    type="button"
                    className="pc-button pc-secondary"
                    onClick={() => enter("agent", "가상상담")}
                  >
                    상담원으로 시연
                  </button>
                </div>
              ) : (
                <button type="button" className="pc-button pc-primary" onClick={() => enter()}>
                  개인용 시연으로 시작 →
                </button>
              )}
              <p className="pc-fineprint">
                모든 로그인은 시연 전용입니다. 입력한 비밀번호는 전송하거나 저장하지 않습니다.
              </p>
            </div>
            <button
              className="pc-inline-button"
              onClick={() => {
                setAccount(null);
                setError("");
                setNotice("");
              }}
            >
              ← 처음 선택으로
            </button>
          </>
        )}
      </section>
    </div>
  );
}
