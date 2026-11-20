import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatPanel } from "../chat/ChatPanel";
import { OfficeBoard } from "../office/OfficeBoard";
import { teamNotesForOffice } from "../office/officeNotes";
import type { OfficeState } from "../office/officeState";
import { PcConsult } from "./PcConsult";
import { ConsultWindow } from "./components/ConsultWindow";
import type { ConsultDataSource } from "./data/ConsultDataSource";
import type { ConsultEvent, ConsultState } from "./state";
import type { Survey } from "./types";
import type { ChatState } from "../chat/chatState";
import type { CompanyPolicy } from "./data/companyPolicy";
import { applyResponsePolicy } from "./data/demoRules";
import { useOfficeBridge } from "./useOfficeBridge";
import { acceptedReviewSelection, reviewSelectionStore } from "./reviewSelectionStore";
import {
  appendConsultMessage,
  appendConsultTransition,
  initialConsultChatState,
} from "./consultTranscript";
import "./consultationLayout.css";

/** Reuses the original office and voice panel; PC work never starts the canned mock stream. */
export function IntegratedWorkspace({
  source,
  sessionId,
  intervalMs,
  onOffice,
  initialSurvey,
  requestedDiscountPercent,
  onConsultState,
  onTranscript,
  policy,
}: {
  source: ConsultDataSource;
  sessionId: string;
  intervalMs: number;
  onOffice: (office: OfficeState) => void;
  initialSurvey?: Survey;
  requestedDiscountPercent?: number;
  onConsultState?: (state: ConsultState) => void;
  onTranscript?: (chat: ChatState) => void;
  policy?: CompanyPolicy;
}) {
  const { office, receive } = useOfficeBridge({ sessionId, intervalMs });
  const [chat, setChat] = useState(() => initialConsultChatState(new Date().toISOString()));
  const notes = useMemo(() => teamNotesForOffice(office), [office]);
  useEffect(() => onOffice(office), [office, onOffice]);
  const displayedChat = useMemo(
    () =>
      !policy
        ? chat
        : {
            ...chat,
            messages: chat.messages.map((message) =>
              message.role === "assistant"
                ? { ...message, content: applyResponsePolicy(message.content, policy) }
                : message,
            ),
          },
    [chat, policy],
  );
  useEffect(() => onTranscript?.(displayedChat), [displayedChat, onTranscript]);
  const acceptedTransition = useCallback(
    (event: ConsultEvent, previous: ConsultState, next: ConsultState) => {
      const occurredAt = new Date().toISOString();
      const selection = acceptedReviewSelection(
        policy?.companyCode,
        event,
        previous,
        next,
        occurredAt,
      );
      if (selection) reviewSelectionStore.dispatch({ type: "SELECTED", selection });
      setChat((current) => appendConsultTransition(current, event, previous, next, occurredAt));
    },
    [policy?.companyCode],
  );
  return (
    <PcConsult
      source={source}
      embedded
      onTransition={receive}
      onAcceptedTransition={acceptedTransition}
      initialSurvey={initialSurvey}
      requestedDiscountPercent={requestedDiscountPercent}
      onStateChange={onConsultState}
      renderLayout={(content, intake, summary, screen) => (
        <div
          className="layout integrated-workspace"
          data-layout={intake ? "intake" : "selection"}
          data-screen={screen}
        >
          <div className="consultation-topline">
            <div>
              <span className="consultation-company-mark" aria-hidden="true">
                B
              </span>
              <span>
                <strong>{policy?.companyName ?? "BUILDWISE"}</strong>의 PC 상담실
              </span>
            </div>
            <span className="consultation-presence">
              <i aria-hidden="true" /> 네 팀과 함께 구성하세요
            </span>
          </div>
          <div className="consultation-workspace">
            <OfficeBoard state={office} />
            {summary && (
              <div className="consultation-build-summary pc-app pc-embedded">{summary}</div>
            )}
            <ChatPanel
              key={sessionId}
              state={displayedChat}
              disabled={false}
              onSend={(text) =>
                setChat((current) => appendConsultMessage(current, text, new Date().toISOString()))
              }
              notes={notes}
              officeRunStatus={office.runStatus}
              intakeMode={intake}
              compactWelcome={intake}
            >
              {intake && (
                <div className="pc-intake-slot">
                  <ConsultWindow
                    active={screen === "survey" || screen === "review"}
                    stage={screen}
                    title={screen === "review" ? "설문 확인" : "상담 설문"}
                  >
                    {content}
                  </ConsultWindow>
                </div>
              )}
            </ChatPanel>
          </div>
          <section
            className="workspace-results"
            id="results"
            aria-labelledby="results-title"
            hidden={intake}
          >
            <div className="results-heading">
              <h2 id="results-title">내 PC 구성</h2>
              <p>추천 근거를 확인하고 직접 골라 주세요.</p>
            </div>
            {!intake && content}
          </section>
        </div>
      )}
    />
  );
}
