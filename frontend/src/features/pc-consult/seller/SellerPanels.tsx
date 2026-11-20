import type { SellerMenu } from "./types";
import { OfficeBoard } from "../../office/OfficeBoard";
import { initialOfficeState } from "../../office/officeState";

const TABLES = {
  customers: { title: "고객 정보", columns: ["고객명", "유형", "최근 상담", "상태"] },
  sales: { title: "판매 통계", columns: ["부품", "판매 수량", "매출액"] },
  issues: { title: "상담 · 이슈 현황", columns: ["상담", "단계", "담당자", "최근 활동"] },
  documents: { title: "문서 · 정책 관리", columns: ["문서명", "유형", "처리 상태"] },
  employees: { title: "직원 관리", columns: ["직원", "역할", "상태"] },
} as const;

export function SellerPanels({ menu }: { menu: SellerMenu }) {
  if (menu === "office")
    return (
      <section className="seller-card seller-office-stage">
        <h1>2D 오피스</h1>
        <p>기업 계정 연결 후 업무 진행 상황을 표시합니다.</p>
        <OfficeBoard state={initialOfficeState()} />
      </section>
    );
  if (menu === "home")
    return (
      <>
        <div className="seller-page-heading">
          <h1>판매자 홈</h1>
          <p>기업 계정 연결을 기다리고 있습니다.</p>
        </div>
        <div className="seller-metrics">
          {["오늘의 상담", "진행 중인 상담", "완료된 견적", "판매 금액"].map((label) => (
            <section className="seller-card" key={label}>
              <h2>{label}</h2>
              <strong aria-label="집계 미연결">—</strong>
            </section>
          ))}
        </div>
        <div className="seller-home-grid">
          {["최근 활동", "먼저 확인할 요청"].map((label) => (
            <section className="seller-card" key={label}>
              <h2>{label}</h2>
              <p className="seller-empty">기업 데이터 미연결</p>
            </section>
          ))}
        </div>
      </>
    );
  const panel = TABLES[menu];
  return (
    <>
      <div className="seller-page-heading">
        <h1>{panel.title}</h1>
      </div>
      <section className="seller-card">
        <div className="seller-table-wrap">
          <table className="seller-table">
            <thead>
              <tr>
                {panel.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={panel.columns.length} className="seller-empty">
                  기업 계정과 연결한 뒤 조회할 수 있습니다.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
