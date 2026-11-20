import { useMemo, useRef } from "react";
import { ChatPanel } from "../chat/ChatPanel";
import { useChat } from "../chat/useChat";
import { OfficeBoard } from "../office/OfficeBoard";
import { teamNotesForOffice } from "../office/officeNotes";
import type { OfficeState } from "../office/officeState";
import { PcConsult } from "./PcConsult";
import type { PcApi } from "./data/apiSource";
import type { SelectionMap, Survey } from "./types";

export function IntegratedWorkspace({
  session,
}: {
  session: { id: string; api: PcApi; office: OfficeState };
}) {
  const { id, api, office } = session;
  const context = useRef<{ survey: Survey | null; selected: SelectionMap }>({
    survey: null,
    selected: {},
  });
  const { chat, sendChat } = useChat(api, context);
  const notes = useMemo(() => teamNotesForOffice(office), [office]);
  return (
    <PcConsult
      source={api}
      sessionId={id}
      onContext={(survey, selected) => {
        context.current = { survey, selected };
      }}
      renderLayout={(content, intake) => (
        <div className="layout integrated-workspace">
          <div className="consultation-workspace">
            <OfficeBoard state={office} />
            <ChatPanel
              key={id}
              state={chat}
              disabled={false}
              onSend={sendChat}
              notes={notes}
              officeRunStatus={office.runStatus}
            >
              {intake && (
                <div className="pc-intake-slot">
                  <p className="integrated-note">
                    원하시는 PC를 아래 설문에 알려 주세요. 음성이나 글로도 질문을 보내실 수 있어요.
                  </p>
                  {content}
                </div>
              )}
            </ChatPanel>
          </div>
          <section className="workspace-results" id="results" aria-labelledby="results-title">
            <div className="results-heading">
              <h2 id="results-title">내 PC 상담</h2>
              <p>선택한 부품과 예산을 반영해 견적을 계산합니다.</p>
            </div>
            {intake ? (
              <p className="integrated-note">
                음성 상담 안의 설문을 마치면 이곳에서 부품 후보와 견적을 확인하실 수 있어요.{" "}
                <a href="#pc-main-content">설문으로 이동</a>
              </p>
            ) : (
              content
            )}
          </section>
        </div>
      )}
    />
  );
}
