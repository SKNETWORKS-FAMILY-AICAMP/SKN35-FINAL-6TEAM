import { reviewSelectionHandoffId, type ReviewSelection } from "../reviewSelectionStore";
import { CATEGORY_LABELS } from "../types";
import type { PreviewHandoffInput, SellerIssue } from "./types";

export function reviewSelectionHandoff(selection: ReviewSelection): PreviewHandoffInput {
  const subject = `${CATEGORY_LABELS[selection.category]} · ${selection.productName}`;
  return {
    id: reviewSelectionHandoffId(selection.companyCode, selection.consultationId),
    dataOrigin: "browser-selection",
    reviewSelections: [selection],
    reasons: selection.reasons.map((reason) => `${subject}: ${reason}`),
    messages: [
      {
        speaker: "고객",
        text: `${subject}의 확인 불가 경고를 확인하고 선택했습니다.`,
        occurredAt: selection.selectedAt,
      },
    ],
    teamNotes: [
      {
        team: "validation",
        message: `${subject}: ${selection.reasons.join(" · ")}`,
        occurredAt: selection.selectedAt,
      },
    ],
  };
}

function uniqueBy<T>(rows: T[], key: (row: T) => string): T[] {
  return [...new Map(rows.map((row) => [key(row), row])).values()];
}

/** One handoff per real browser consultation, with repeat forwarding/receipts ignored. */
export function mergeBrowserHandoff(
  existing: SellerIssue | undefined,
  input: PreviewHandoffInput,
): SellerIssue | null {
  const selections = uniqueBy(
    [...(existing?.reviewSelections ?? []), ...(input.reviewSelections ?? [])],
    (row) => row.key,
  );
  const reasons = [...new Set([...(existing?.reasons ?? []), ...input.reasons])];
  const lines = uniqueBy([...(existing?.lines ?? []), ...input.messages], (row) =>
    JSON.stringify(row),
  );
  const teamNotes = uniqueBy([...(existing?.teamNotes ?? []), ...input.teamNotes], (row) =>
    JSON.stringify(row),
  );
  if (
    existing &&
    selections.length === (existing.reviewSelections?.length ?? 0) &&
    reasons.length === (existing.reasons?.length ?? 0) &&
    lines.length === (existing.lines?.length ?? 0) &&
    teamNotes.length === (existing.teamNotes?.length ?? 0)
  )
    return null;
  return {
    id: existing?.id ?? `preview-handoff:${input.id}`,
    customerId: "browser-consultation",
    kind: "이슈",
    title: selections.length ? "상품 정보 보강 필요" : "고객 미리보기 상담 인계",
    stage:
      existing?.stage === "done" && selections.length > (existing.reviewSelections?.length ?? 0)
        ? "received"
        : (existing?.stage ?? "received"),
    assignee: existing?.assignee ?? "미배정",
    summary: reasons.join(" · "),
    suggestion:
      "선택한 제품의 확인 불가 항목을 보강하고 실제 호환성을 확인해 주세요. 고객의 선택은 호환성 통과를 뜻하지 않습니다.",
    consultationId: input.id,
    dataOrigin: selections.length ? "browser-selection" : "browser-preview",
    reviewSelections: selections.map((row) => ({ ...row, reasons: [...row.reasons] })),
    reasons,
    lines: lines.map((row) => ({ ...row })),
    teamNotes: teamNotes.map((row) => ({ ...row })),
  };
}
