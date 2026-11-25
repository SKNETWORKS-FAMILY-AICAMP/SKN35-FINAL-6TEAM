import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatPanel } from "../chat/ChatPanel";
import { useChat } from "../chat/useChat";
import { OfficeBoard } from "../office/OfficeBoard";
import { teamNotesForOffice } from "../office/officeNotes";
import type { OfficeState } from "../office/officeState";
import { PcConsult } from "./PcConsult";
import { ConsultWindow } from "./components/ConsultWindow";
import type { ConsultDataSource } from "./data/ConsultDataSource";
import type { PcApi } from "./data/apiSource";
import type { ConsultEvent, ConsultState } from "./state";
import type { SelectionMap, Survey } from "./types";
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

/** 실제 상담 서버 세션에서 받은 사무실 상태와 대화. 있으면 시연 연결 대신 이것을 씁니다. */
export interface LiveConsultation {
  office: OfficeState;
  chat: ChatState;
  onSend: (text: string) => void;
  onContext: (survey: Survey | null, selected: SelectionMap) => void;
}

/**
 * 사무실 · 음성 상담 · PC 상담을 한 화면에 둡니다.
 * live 가 있으면 사무실과 대화는 상담 서버(부품 DB) 세션을 따르고,
 * 없으면 스냅샷 시연 데이터의 진행을 사무실 이벤트로 바꿔 보여 줍니다.
 */
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
  live,
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
  live?: LiveConsultation;
}) {
  // 훅 순서를 지키려고 시연 연결은 늘 만들고, 실제 세션일 때는 쓰지 않습니다.
  const bridge = useOfficeBridge({ sessionId, intervalMs });
  const office = live?.office ?? bridge.office;
  const [demoChat, setChat] = useState(() => initialConsultChatState(new Date().toISOString()));
  const consultState = useRef<ConsultState | null>(null);
  const rememberState = useCallback(
    (state: ConsultState) => {
      consultState.current = state;
      onConsultState?.(state);
    },
    [onConsultState],
  );
  const chat = live?.chat ?? demoChat;
  const notes = useMemo(() => teamNotesForOffice(office), [office]);
  useEffect(() => onOffice(office), [office, onOffice]);
  const displayedChat = useMemo(
    () =>
      !policy || live
        ? chat
        : {
            ...chat,
            messages: chat.messages.map((message) =>
              message.role === "assistant"
                ? { ...message, content: applyResponsePolicy(message.content, policy) }
                : message,
            ),
          },
    [chat, policy, live],
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
      // 실제 세션의 대화는 서버가 가지고 있으므로 시연 대화에만 진행 기록을 붙입니다.
      if (!live)
        setChat((current) => appendConsultTransition(current, event, previous, next, occurredAt));
    },
    [policy?.companyCode, live],
  );
  return (
    <PcConsult
      source={source}
      sessionId={live ? sessionId : undefined}
      chatRevision={live?.chat.messages.at(-1)?.id}
      onContext={live?.onContext}
      embedded
      onTransition={live ? undefined : bridge.receive}
      onAcceptedTransition={acceptedTransition}
      initialSurvey={initialSurvey}
      requestedDiscountPercent={requestedDiscountPercent}
      onStateChange={rememberState}
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
              speechSession={live ? sessionId : undefined}
              state={displayedChat}
              disabled={false}
              onSend={(text) => {
                if (live) return live.onSend(text);
                const result = consultState.current?.candidates;
                setChat((current) =>
                  appendConsultMessage(current, text, new Date().toISOString(), result),
                );
              }}
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
            </div>
            {!intake && content}
          </section>
        </div>
      )}
    />
  );
}

/** 상담 서버 세션(부품 DB · RAG)에 붙은 개인 상담. 대화는 서버에 보내고 사무실은 서버 이벤트로 움직입니다. */
export function LiveWorkspace({
  session,
  onOffice,
}: {
  session: { id: string; api: PcApi; office: OfficeState };
  onOffice: (office: OfficeState) => void;
}) {
  const context = useRef<{ survey: Survey | null; selected: SelectionMap }>({
    survey: null,
    selected: {},
  });
  const { chat, sendChat } = useChat(session.api, context);
  const onContext = useCallback((survey: Survey | null, selected: SelectionMap) => {
    context.current = { survey, selected };
  }, []);
  const live = useMemo<LiveConsultation>(
    () => ({ office: session.office, chat, onSend: (text) => void sendChat(text), onContext }),
    [session.office, chat, sendChat, onContext],
  );
  return (
    <IntegratedWorkspace
      source={session.api}
      sessionId={session.id}
      intervalMs={0}
      onOffice={onOffice}
      live={live}
    />
  );
}
