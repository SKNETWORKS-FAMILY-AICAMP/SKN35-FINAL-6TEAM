import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildMockEvents } from "../../events/mockEventStream";
import { OfficeDemoResults } from "./OfficeDemoResults";
import { initialOfficeState, officeReducer, type OfficeState } from "./officeState";

function render(state: OfficeState) {
  return renderToStaticMarkup(createElement(OfficeDemoResults, { state }));
}

function quotationSummary(markup: string) {
  const match = markup.match(/<p\b[^>]*data-testid="demo-quotation-summary"[^>]*>(.*?)<\/p>/s);
  if (!match) throw new Error("데모 견적 요약을 찾을 수 없습니다.");
  return match[1];
}

describe("OfficeDemoResults", () => {
  it("이벤트가 없으면 상품·가격을 만들지 않고 대기 상태를 표시한다", () => {
    const markup = render(initialOfficeState());
    expect(markup).toContain('data-testid="office-demo-results"');
    expect(markup).toContain("후보를 찾으면 이곳에 기록이 쌓입니다.");
    expect(quotationSummary(markup)).toBe("견적을 기다리고 있어요");
    expect(markup).not.toMatch(/\d[\d,]*원/);
    expect(markup).not.toContain("가상 브랜드 노트북");
  });

  it("후보·검증 기록은 해당 이벤트를 수신한 뒤에만 순서대로 나타난다", () => {
    const events = buildMockEvents();
    const results = events.filter(
      (event) =>
        (event.team === "design" && event.type === "task.progress") ||
        (event.team === "validation" && event.type === "task.completed"),
    );

    for (let count = 0; count <= events.length; count += 1) {
      const office = events.slice(0, count).reduce(officeReducer, initialOfficeState());
      const markup = render(office);
      let previousPosition = -1;
      for (const event of results) {
        if (event.seq > office.lastSeq) {
          expect(markup).not.toContain(event.message);
          continue;
        }
        const position = markup.indexOf(event.message);
        expect(position).toBeGreaterThan(previousPosition);
        expect(markup).toContain(`dateTime="${event.occurred_at}"`);
        previousPosition = position;
      }
    }
  });

  it("견적 작업 시작만으로 금액을 표시하지 않고 완료 이벤트의 문장을 그대로 표시한다", () => {
    const events = buildMockEvents();
    const quoteIndex = events.findIndex(
      (event) => event.team === "quotation" && event.type === "task.completed",
    );
    expect(quoteIndex).toBeGreaterThan(0);
    const quote = events[quoteIndex];

    for (let count = 0; count <= quoteIndex; count += 1) {
      const before = events.slice(0, count).reduce(officeReducer, initialOfficeState());
      const markup = render(before);
      expect(quotationSummary(markup)).toBe("견적을 기다리고 있어요");
      expect(markup).not.toMatch(/\d[\d,]*원/);
    }

    const after = events.slice(0, quoteIndex + 1).reduce(officeReducer, initialOfficeState());
    expect(after.runStatus).toBe("running");
    const markup = render(after);
    expect(quotationSummary(markup)).toBe(quote.message);
    expect(markup).toContain("가상 상품의 데모 금액이며 실제 판매가가 아닙니다.");
  });

  it("검증 완료 이벤트에 담긴 부적합 사유를 통과로 바꾸지 않는다", () => {
    const events = buildMockEvents();
    const rejection = events.find(
      (event) => event.team === "validation" && event.message.includes("부적합"),
    );
    expect(rejection).toBeDefined();
    expect(rejection?.status).toBe("completed");

    const markup = render(events.reduce(officeReducer, initialOfficeState()));
    const resultRows = [...markup.matchAll(/<li\b[^>]*>(.*?)<\/li>/gs)].map((match) => match[1]);
    const rejectedRow = resultRows.find((row) => row.includes("노트북 B: 부적합"));
    expect(rejectedRow).toContain(rejection!.message);
    expect(rejectedRow).toContain("메모리 16GB (조건 32GB 이상)");
    expect(rejectedRow).not.toContain("통과");
    expect(markup).not.toContain("노트북 B: 통과");
    expect(markup).toContain("노트북 A: 통과");
  });

  it("새 요구사항 버전에서는 이전 후보·견적을 지우고 늦은 이전 결과도 표시하지 않는다", () => {
    const events = buildMockEvents();
    const completed = events.reduce(officeReducer, initialOfficeState());
    const oldQuote = events.find(
      (event) => event.team === "quotation" && event.type === "task.completed",
    )!;
    expect(quotationSummary(render(completed))).toBe(oldQuote.message);

    const fresh = officeReducer(completed, {
      ...events[0],
      seq: completed.lastSeq + 1,
      requirement_version: completed.version + 1,
      message: "시험 요구사항 새 버전 접수",
    });
    const withLateOldQuote = officeReducer(fresh, {
      ...oldQuote,
      seq: fresh.lastSeq + 1,
    });

    for (const state of [fresh, withLateOldQuote]) {
      const markup = render(state);
      expect(quotationSummary(markup)).toBe("견적을 기다리고 있어요");
      expect(markup).not.toContain(oldQuote.message);
      expect(markup).not.toContain("가상 브랜드 노트북");
      expect(markup).not.toContain("노트북 A: 통과");
      expect(markup).toContain("후보를 찾으면 이곳에 기록이 쌓입니다.");
    }
  });
});
