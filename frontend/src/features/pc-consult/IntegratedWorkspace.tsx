import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatPanel } from "../chat/ChatPanel";
import { OfficeBoard } from "../office/OfficeBoard";
import { teamNotesForOffice } from "../office/officeNotes";
import type { OfficeState } from "../office/officeState";
import { PcConsult } from "./PcConsult";
import type { ConsultDataSource } from "./data/ConsultDataSource";
import type { ConsultEvent, ConsultState } from "./state";
import { useOfficeBridge } from "./useOfficeBridge";
import {
  appendConsultMessage,
  appendConsultTransition,
  initialConsultChatState,
} from "./consultTranscript";

/** Reuses the original office and voice panel; PC work never starts the canned mock stream. */
export function IntegratedWorkspace({
  source,
  sessionId,
  intervalMs,
  onOffice,
}: {
  source: ConsultDataSource;
  sessionId: string;
  intervalMs: number;
  onOffice: (office: OfficeState) => void;
}) {
  const { office, receive } = useOfficeBridge({ sessionId, intervalMs });
  const [chat, setChat] = useState(() => initialConsultChatState(new Date().toISOString()));
  const notes = useMemo(() => teamNotesForOffice(office), [office]);
  useEffect(() => onOffice(office), [office, onOffice]);
  const acceptedTransition = useCallback(
    (event: ConsultEvent, previous: ConsultState, next: ConsultState) => {
      setChat((current) =>
        appendConsultTransition(current, event, previous, next, new Date().toISOString()),
      );
    },
    [],
  );
  return (
    <PcConsult
      source={source}
      embedded
      onTransition={receive}
      onAcceptedTransition={acceptedTransition}
      renderLayout={(content, intake) => (
        <div className="layout integrated-workspace">
          <div className="consultation-workspace">
            <OfficeBoard state={office} />
            <ChatPanel
              key={sessionId}
              state={chat}
              disabled={false}
              onSend={(text) =>
                setChat((current) => appendConsultMessage(current, text, new Date().toISOString()))
              }
              notes={notes}
              officeRunStatus={office.runStatus}
            >
              {intake && (
                <div className="pc-intake-slot">
                  <p className="integrated-note">
                    원하시는 PC를 아래 설문에 알려 주세요. 음성·글 입력은 요청 메모로 남습니다.
                  </p>
                  {content}
                </div>
              )}
            </ChatPanel>
          </div>
          <section className="workspace-results" id="results" aria-labelledby="results-title">
            <div className="results-heading">
              <h2 id="results-title">내 PC 상담</h2>
              <p>선택은 대화에, 진행은 사무실에 함께 기록됩니다.</p>
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
