import { describe, expect, it } from "vitest";
import { buildMockEvents } from "./officeEvent.fixture";
import { teamNotesForOffice } from "./officeNotes";
import { initialOfficeState, officeReducer } from "./officeState";

describe("팀 작업 기록", () => {
  it("요청 전에는 비어 있다", () => {
    expect(teamNotesForOffice(initialOfficeState())).toEqual([]);
  });

  it("요구사항 정리는 빼고 팀 이벤트만 순번 순으로 담는다", () => {
    const state = buildMockEvents().reduce(officeReducer, initialOfficeState());
    const notes = teamNotesForOffice(state);
    expect(notes.map((note) => note.seq)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(notes.some((note) => note.type === "requirements.updated")).toBe(false);
    expect(notes.find((note) => note.seq === 10)).toMatchObject({
      team: "validation",
      status: "completed",
      message: "노트북 B: 부적합 — 메모리 16GB (조건 32GB 이상)",
    });
  });

  it("아직 받지 않은 이벤트는 없다", () => {
    const state = buildMockEvents().slice(0, 5).reduce(officeReducer, initialOfficeState());
    expect(teamNotesForOffice(state).map((note) => note.seq)).toEqual([3, 4, 5]);
  });

  it("새 요구사항 버전이 오면 이전 버전 기록을 버린다", () => {
    const first = buildMockEvents().reduce(officeReducer, initialOfficeState());
    const next = officeReducer(first, {
      ...buildMockEvents()[2],
      seq: 20,
      requirement_version: 2,
      message: "v2 후보 탐색 시작",
    });
    expect(teamNotesForOffice(next).map((note) => note.message)).toEqual(["v2 후보 탐색 시작"]);
  });

  it("최근 기록만 남긴다", () => {
    const state = buildMockEvents().reduce(officeReducer, initialOfficeState());
    expect(teamNotesForOffice(state, 3).map((note) => note.seq)).toEqual([10, 11, 12]);
  });
});
