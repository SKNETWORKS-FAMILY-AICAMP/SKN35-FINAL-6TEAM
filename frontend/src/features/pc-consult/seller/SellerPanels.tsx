import { useState } from "react";
import { OfficeBoard } from "../../office/OfficeBoard";
import { initialOfficeState } from "../../office/officeState";
import type { SellerMenu } from "./types";

const ACCOUNT_NOTICE = "기업 계정과 연결한 뒤 조회할 수 있습니다.";

function Metrics({ labels }: { labels: string[] }) {
  return (
    <div className="seller-metrics">
      {labels.map((label) => (
        <section className="seller-metric" key={label}>
          <div>{label}</div>
          <strong aria-label="집계 미연결">—</strong>
        </section>
      ))}
    </div>
  );
}

function Counters() {
  return (
    <div className="seller-consult-counters">
      {(
        [
          ["상담 중", "teal"],
          ["대기 중", "amber"],
          ["오늘 완료", "muted"],
        ] as const
      ).map(([label, color]) => (
        <div key={label}>
          <span aria-hidden="true" className={`seller-dot seller-dot-${color}`} />
          {label}
          <strong aria-label="집계 미연결">—</strong>
        </div>
      ))}
    </div>
  );
}

function Heading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="seller-page-heading">
      <div>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
      <span className="seller-soft-label">기업 계정 미연결</span>
    </div>
  );
}

function EmptyTable({ name, columns }: { name: string; columns: string[] }) {
  return (
    <div className="seller-table-wrap">
      <table className="seller-table" aria-label={name}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="seller-empty" colSpan={columns.length}>
              {ACCOUNT_NOTICE}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CustomerPanel() {
  const [blocked, setBlocked] = useState(false);
  return (
    <>
      <Heading title="고객 정보" detail="고객별 최근 상담과 견적, 이용 상태를 조회합니다." />
      <div className="seller-tabs seller-primary-tabs" role="group" aria-label="고객 관리 구분">
        {["고객 목록", "차단된 고객"].map((label, index) => (
          <button
            type="button"
            key={label}
            className={blocked === Boolean(index) ? "seller-active" : ""}
            aria-pressed={blocked === Boolean(index)}
            onClick={() => setBlocked(Boolean(index))}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="seller-card">
        <div className="seller-card-heading">
          <h2>{blocked ? "차단된 고객" : "고객 목록"}</h2>
        </div>
        <EmptyTable
          name={blocked ? "차단된 고객 목록" : "고객 목록"}
          columns={
            blocked
              ? ["고객", "차단 사유", "처리자", "처리 날짜"]
              : ["고객", "유형", "최근 상담", "견적 수", "이용 상태"]
          }
        />
      </section>
    </>
  );
}

function SalesPanel() {
  const [period, setPeriod] = useState("오늘");
  return (
    <>
      <Heading title="판매 통계" detail="기간별 판매와 상담 수요를 비교합니다." />
      <div className="seller-tabs seller-primary-tabs" role="group" aria-label="집계 기간">
        {["오늘", "이번 주", "이번 달"].map((label) => (
          <button
            type="button"
            key={label}
            aria-pressed={label === period}
            className={label === period ? "seller-active" : ""}
            onClick={() => setPeriod(label)}
          >
            {label}
          </button>
        ))}
      </div>
      <Metrics labels={["판매 금액", "판매 수량", "저장된 견적", "견적 구매 전환율"]} />
      <div className="seller-home-grid">
        <section className="seller-card">
          <div className="seller-card-heading">
            <h2>판매 건수 추이</h2>
          </div>
          <div className="seller-chart-unavailable">
            <span>{period} 판매 기록 미연결</span>
          </div>
        </section>
        <section className="seller-card">
          <div className="seller-card-heading">
            <h2>분류별 판매 비중</h2>
          </div>
          <div className="seller-category-unavailable">
            <span aria-hidden="true">—</span>
            <p>{period} 분류별 판매량 미연결</p>
          </div>
        </section>
        <section className="seller-card">
          <div className="seller-card-heading">
            <h2>판매 상위 10개 부품</h2>
          </div>
          <EmptyTable name="부품별 판매 순위" columns={["부품", "판매 수량", "판매 금액"]} />
        </section>
        <section className="seller-card">
          <div className="seller-card-heading">
            <h2>상담 수요와 실제 판매</h2>
          </div>
          <div className="seller-chart-unavailable">
            <span>{period} 상담·판매 기록 미연결</span>
          </div>
        </section>
      </div>
    </>
  );
}

export function SellerPanels({ menu }: { menu: SellerMenu }) {
  switch (menu) {
    case "home":
      return (
        <>
          <Heading title="판매자 홈" detail="오늘의 상담과 확인할 요청을 모아 봅니다." />
          <Metrics labels={["오늘의 상담", "처리 대기 이슈", "오늘 판매 건수", "욕설 감지 알림"]} />
          <div className="seller-home-grid">
            <section className="seller-card">
              <div className="seller-card-heading">
                <h2>지금 진행 중인 상담</h2>
              </div>
              <Counters />
            </section>
            {[
              ["최근 활동", "기업 활동 기록 미연결"],
              ["많이 선택한 부품", "상담 부품 집계 미연결"],
              ["먼저 확인할 요청", "이슈 접수 기록 미연결"],
            ].map(([title, empty]) => (
              <section className="seller-card" key={title}>
                <div className="seller-card-heading">
                  <h2>{title}</h2>
                </div>
                <p className="seller-empty">{empty}</p>
              </section>
            ))}
          </div>
        </>
      );
    case "sales":
      return <SalesPanel />;
    case "customers":
      return <CustomerPanel />;
    case "employees":
      return (
        <>
          <Heading title="직원 관리" detail="기업 관리자에게 직원 계정과 권한이 표시됩니다." />
          <section className="seller-card">
            <div className="seller-card-heading">
              <h2>팀원 목록</h2>
              <span className="seller-label seller-label-amber">승인 대기 · 집계 미연결</span>
            </div>
            <EmptyTable name="직원 계정 목록" columns={["직원", "권한", "상태", "계정 관리"]} />
          </section>
        </>
      );
    case "issues":
      return (
        <>
          <Heading
            title="상담 · 이슈 현황"
            detail="접수된 이슈와 클레임을 처리 단계별로 확인합니다."
          />
          <section className="seller-card seller-issue-counters" aria-label="상담 현황">
            <Counters />
          </section>
          <div className="seller-kanban">
            {[
              ["received", "받은", "새로 도착한 문의"],
              ["classified", "분류됨", "담당자 배정 대기"],
              ["working", "처리 중", "담당자가 확인 중"],
              ["done", "완료", "해결된 문의"],
            ].map(([stage, label, detail]) => (
              <section className={`seller-kanban-column seller-stage-${stage}`} key={stage}>
                <div className="seller-kanban-heading">
                  <h2>{label}</h2>
                  <span aria-label="이슈 수 미연결">—</span>
                </div>
                <p>{detail}</p>
                <div className="seller-kanban-cards">
                  <div className="seller-kanban-empty">처리 기록 미연결</div>
                </div>
              </section>
            ))}
          </div>
        </>
      );
    case "documents":
      return (
        <>
          <Heading
            title="문서 · 정책 관리"
            detail="상담에 쓰는 사내 문서와 판매 정책을 확인합니다."
          />
          <div className="seller-documents-grid">
            <section className="seller-card">
              <div className="seller-card-heading">
                <h2>상담 참고 문서</h2>
              </div>
              <div className="seller-upload seller-upload-unavailable">
                <span aria-hidden="true">↥</span>
                <strong>참고 문서 업로드</strong>
                <span>기업 관리자 계정 연결이 필요합니다.</span>
                <button type="button" className="seller-button seller-secondary" disabled>
                  문서 올리기
                </button>
              </div>
              <EmptyTable name="등록 문서" columns={["문서명", "유형", "반영 상태"]} />
            </section>
            <section className="seller-card">
              <div className="seller-card-heading">
                <h2>판매 정책</h2>
              </div>
              <div className="seller-form">
                {[
                  ["기본 배송비", "원"],
                  ["기본 할인율", "%"],
                ].map(([name, unit]) => (
                  <label key={name}>
                    {name}
                    <div className="seller-unit-input">
                      <input disabled aria-label={name} placeholder="정책 미연결" />
                      <span>{unit}</span>
                    </div>
                  </label>
                ))}
                <button type="button" disabled className="seller-button seller-primary">
                  정책 저장
                </button>
              </div>
            </section>
          </div>
        </>
      );
    case "office":
      return (
        <>
          <Heading title="2D 오피스" detail="기업 계정 연결 후 팀별 상담 진행 상황을 표시합니다." />
          <div className="seller-office-stage">
            <OfficeBoard state={initialOfficeState()} />
          </div>
          <section className="seller-card seller-office-records">
            <div className="seller-card-heading">
              <h2>상담 · 이슈 작업 기록</h2>
            </div>
            <p className="seller-empty">기업 업무 이벤트 미연결</p>
          </section>
        </>
      );
  }
}
