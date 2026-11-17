/**
 * 음성 받아쓰기 · 글 입력 · 선택지를 같은 상담 흐름에서 표시합니다.
 * 상담 직원의 답은 서버(규칙 기반)가 만든 것만 보여 주고,
 * 업무팀의 작업은 상담 직원의 말과 섞지 않고 팀 작업 기록 한 줄로 따로 그립니다.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { QuickReply, QuickReplyIn } from "../../api/client";
import type { TeamNote } from "../office/officeNotes";
import { STATUS_LABELS, TEAM_LABELS, type DisplayStatus } from "../office/officeState";
import { currentQuickReplies, type ChatState } from "./chatState";
import { consoleDisplay, mergeTranscript, type ConsoleDisplay } from "./mockTranscript";
import { conditionTags, formatMessageTime } from "./transcript";
import { useVoiceConsultation } from "./useVoiceConsultation";
import "./transcript.css";

interface Props {
  state: ChatState;
  disabled: boolean;
  onSend: (text: string, quickReply: QuickReplyIn | null) => void | Promise<void>;
  mock?: boolean;
  mockDraft?: string;
  mockDraftAt?: string | null;
  /** 팀 작업 기록(오피스 상태에서 파생). 대화 말풍선 사이에 시각 순으로 끼웁니다. */
  notes?: TeamNote[];
  /** 오피스 실행 상태. 음성이 대기일 때 콘솔 표시 단계를 고르는 데만 씁니다. */
  officeRunStatus?: DisplayStatus;
}

const PLACEHOLDER = "예: 노트북 추천, 예산 300만 원";
const MOCK_PLACEHOLDER = "시연 중에는 입력하지 않아요";
const EMPTY = "무엇을 도와드릴까요? 사려는 장비 · 예산 · 용도를 말씀해 주세요.";
const NO_NOTES: TeamNote[] = [];
// 바닥에서 이만큼 안쪽에 있으면 새 기록이 올 때 따라 내려갑니다.
const FOLLOW_GAP = 48;

const DISPLAY_LABEL: Record<ConsoleDisplay, string> = {
  idle: "음성 상담 대기",
  listening: "듣는 중",
  transcribing: "듣는 중 · 받아쓰는 중",
  sending: "보내는 중 · 답변을 기다려요",
  speaking: "AI 상담 직원이 읽는 중",
  error: "음성 기능 확인 필요",
  drafting: "고객 말을 받아쓰는 중",
  working: "팀이 작업 중이에요",
  waiting: "고객 확인을 기다려요",
  done: "답변 준비됨",
};

function displayDetail(display: ConsoleDisplay, mock: boolean, micPaused: boolean): string {
  if (micPaused) {
    return display === "speaking"
      ? "마이크 켜짐 · 답 읽기가 끝나면 다시 들어요"
      : "마이크 켜짐 · 듣기 일시정지";
  }
  switch (display) {
    case "listening":
    case "transcribing":
      return mock ? "마이크 확인 · 보내지 않음" : "말을 멈추고 1초 지나면 보내요";
    case "sending":
      return "글과 선택지로도 이어갈 수 있어요";
    case "speaking":
      return "그만 읽기를 누르면 멈춰요";
    case "error":
      return "아래 안내를 확인해 주세요";
    case "drafting":
      return "시연 대본의 고객 요청이에요";
    case "working":
      return "상담 직원이 팀 결과를 기다려요";
    case "waiting":
      return "대화 기록의 질문에 답해 주세요";
    case "done":
      return "대화 기록에서 결과를 확인하세요";
    default:
      return mock ? "고객 요청을 기다려요" : "마이크로 말하거나 아래 칸에 적어 주세요";
  }
}

function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8.5" y="2.5" width="7" height="12" rx="3.5" />
      <path d="M5 10.5v1a7 7 0 0 0 14 0v-1M12 18.5v3M8.5 21.5h7" />
    </svg>
  );
}

/** 56px 픽셀 표시판. 4 SVG 단위가 한 칸입니다. 움직임은 실제 듣기·읽기 때만 CSS 로 돕니다. */
function VoiceCore({ display }: { display: ConsoleDisplay }) {
  let mark: ReactNode;
  if (display === "done") {
    mark = (
      <path
        className="voice-core-mark"
        d="M14 28h4v4h-4ZM18 32h4v4h-4ZM22 36h4v4h-4ZM26 32h4v4h-4ZM30 28h4v4h-4ZM34 24h4v4h-4ZM38 20h4v4h-4Z"
      />
    );
  } else if (display === "error") {
    mark = <path className="voice-core-mark" d="M26 14h4v16h-4ZM26 36h4v4h-4Z" />;
  } else if (display === "waiting") {
    mark = <path className="voice-core-mark" d="M16 26h4v4h-4ZM26 26h4v4h-4ZM36 26h4v4h-4Z" />;
  } else {
    mark = (
      <g className="voice-core-signal">
        <rect x="10" y="24" width="4" height="8" />
        <rect x="18" y="18" width="4" height="20" />
        <rect x="26" y="14" width="4" height="28" />
        <rect x="34" y="20" width="4" height="16" />
        <rect x="42" y="24" width="4" height="8" />
      </g>
    );
  }
  return (
    <svg className="voice-core" viewBox="0 0 56 56" shapeRendering="crispEdges" aria-hidden="true">
      <rect className="voice-core-tile" x="2" y="2" width="52" height="52" />
      {mark}
    </svg>
  );
}

// 팀 기록은 지난 일의 기록이라 '지금 상태'가 아니라 그때 일어난 일로 적는다.
const NOTE_LABELS: Partial<Record<TeamNote["type"], string>> = {
  "task.started": "시작",
  "task.progress": "진행",
  "task.retrying": "다시 시도",
  "task.completed": "완료",
  "task.failed": "실패",
  "task.needs_input": "고객 확인 요청",
};

function TeamNoteRow({ note }: { note: TeamNote }) {
  return (
    <li
      className="transcript-note"
      data-team={note.team}
      data-status={note.status}
      data-testid="chat-team-note"
    >
      <div className="transcript-note-meta">
        <strong>{TEAM_LABELS[note.team]}</strong>
        <span className="transcript-note-status">
          {NOTE_LABELS[note.type] ?? STATUS_LABELS[note.status]}
        </span>
        <time dateTime={note.occurredAt}>{formatMessageTime(note.occurredAt)}</time>
      </div>
      <p className="transcript-note-message">{note.message}</p>
    </li>
  );
}

export function ChatPanel({
  state,
  disabled,
  onSend,
  mock = false,
  mockDraft = "",
  mockDraftAt = null,
  notes = NO_NOTES,
  officeRunStatus,
}: Props) {
  const [text, setText] = useState("");
  const [draftAt, setDraftAt] = useState<string | null>(null);
  const [pendingAt, setPendingAt] = useState<string | null>(null);
  const [pinRequest, setPinRequest] = useState(false);
  const logRef = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const voice = useVoiceConsultation({ chat: state, onSend, disabled: !mock && disabled, mock });
  const { phase, micEnabled, speechEnabled, finalText, interimText } = voice.state;
  const chips = currentQuickReplies(state);
  const busy = disabled || state.pending !== null;
  const hearing = phase === "listening" || phase === "transcribing";
  const hasVoiceText =
    Boolean(finalText || interimText) && (mock || (phase !== "sending" && phase !== "speaking"));
  const display = consoleDisplay(phase, officeRunStatus, mock ? mockDraft : "");
  const detail = displayDetail(display, mock, micEnabled && !hearing && phase !== "error");
  const entries = mergeTranscript(state.messages, notes);
  // 팀 기록은 최근 12개까지라 개수가 그대로여도 새 기록이 올 수 있습니다. 마지막 seq 로 봅니다.
  const lastNoteSeq = notes.at(-1)?.seq ?? 0;
  const latestRequest = state.messages.findLast((message) => message.role === "user") ?? null;
  const latestTags = latestRequest ? conditionTags(latestRequest) : [];

  useEffect(() => {
    if (hasVoiceText) setDraftAt((previous) => previous ?? new Date().toISOString());
    else setDraftAt(null);
  }, [hasVoiceText]);

  useEffect(() => {
    setPendingAt(state.pending === null ? null : new Date().toISOString());
  }, [state.pending]);

  // 가장 최근 고객 요청이 기록 영역 위로 밀려났을 때만 위쪽에 요약을 고정합니다.
  const updateLogPosition = useCallback(() => {
    const log = logRef.current;
    if (!log) return;
    following.current = log.scrollHeight - log.scrollTop - log.clientHeight <= FOLLOW_GAP;
    const requests = log.querySelectorAll<HTMLElement>('[data-testid="chat-user"]');
    const request = requests[requests.length - 1];
    const hidden =
      request !== undefined &&
      log.scrollHeight > log.clientHeight &&
      request.offsetTop + request.offsetHeight <= log.scrollTop;
    setPinRequest((previous) => (previous === hidden ? previous : hidden));
  }, []);

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    if (following.current) log.scrollTop = log.scrollHeight;
    updateLogPosition();
  }, [
    state.messages.length,
    lastNoteSeq,
    state.pending,
    finalText,
    interimText,
    mockDraft,
    updateLogPosition,
  ]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    voice.sendText(trimmed, null);
    setText("");
  }

  function choose(chip: QuickReply) {
    if (busy) return;
    const picked = chip.slot && chip.value ? { slot: chip.slot, value: chip.value } : null;
    voice.sendText(chip.label, picked);
  }

  return (
    <section
      id="conversation"
      className="panel chat consultation-transcript"
      aria-label="음성 상담"
      data-mode={mock ? "mock" : "live"}
    >
      <header className="transcript-header">
        <div className="transcript-title">
          <h2>음성 상담</h2>
          {mock && <span className="transcript-mode">시연</span>}
        </div>
        <button
          type="button"
          className="voice-reply-button"
          data-testid="voice-reply"
          aria-pressed={speechEnabled}
          onClick={voice.toggleSpeech}
          disabled={!voice.synthesisSupported}
        >
          <span>음성 답</span>
          <span className="voice-reply-switch" aria-hidden="true" />
        </button>
      </header>
      <div className="transcript-voice-section">
        <div className="voice-console" data-phase={phase} data-display={display}>
          <VoiceCore display={display} />
          <div className="voice-console-copy">
            <p className="voice-indicator" role="status" data-testid="voice-status">
              {DISPLAY_LABEL[display]}
            </p>
            <p className="voice-console-detail" title={detail}>
              {detail}
            </p>
          </div>
          <div className="voice-controls">
            {phase === "speaking" ? (
              <button
                type="button"
                className="voice-stop"
                onClick={voice.stopReading}
                data-testid="voice-stop"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                </svg>
                <span>그만 읽기</span>
              </button>
            ) : (
              <button
                type="button"
                className="voice-mic-button"
                data-testid="voice-mic"
                data-variant={mock ? "secondary" : "primary"}
                aria-pressed={micEnabled}
                onClick={voice.toggleMic}
                disabled={!micEnabled && (!voice.recognitionSupported || (!mock && disabled))}
              >
                <MicrophoneIcon />
                <span className="voice-button-text">
                  {micEnabled ? "마이크 끄기" : "마이크 켜기"}
                </span>
              </button>
            )}
          </div>
        </div>
        <div className="voice-notes">
          {mock && (
            <p className="transcript-demo-note">
              시연 대본입니다. 마이크로 말한 내용은 전송하지 않습니다.
            </p>
          )}
          <details className="voice-privacy">
            <summary>음성 처리 안내</summary>
            <p>
              음성은 브라우저 음성 인식으로 글자로 바뀝니다. 녹음 파일은 만들거나 저장하지 않습니다.
            </p>
          </details>
        </div>
        {!voice.recognitionSupported && (
          <p className="voice-help">
            이 브라우저는 음성 받아쓰기를 지원하지 않습니다. 글 입력으로 상담할 수 있어요.
          </p>
        )}
        {!voice.synthesisSupported && (
          <p className="voice-help">
            이 브라우저는 음성 읽기를 지원하지 않습니다. 답변은 글로 표시됩니다.
          </p>
        )}
        {voice.state.error && (
          <p className="voice-error" role="alert">
            {voice.state.error}
          </p>
        )}
      </div>
      <div className="transcript-conversation">
        <h3 className="transcript-log-heading">대화 기록</h3>
        <div className="transcript-log-wrap">
          {pinRequest && latestRequest && (
            <div className="transcript-request" aria-hidden="true">
              <p>
                <b>고객 요청</b> {latestRequest.content}
              </p>
              {latestTags.length > 0 && (
                <p className="transcript-request-tags">
                  {latestTags.map((tag) => (
                    <span key={tag.label}>
                      {tag.label} {tag.value}
                    </span>
                  ))}
                </p>
              )}
            </div>
          )}
          <ol
            className="chat-log transcript-log"
            ref={logRef}
            onScroll={updateLogPosition}
            data-testid="chat-log"
            aria-label="대화 기록"
            aria-live="polite"
            aria-relevant="additions"
          >
            {state.messages.length === 0 &&
              notes.length === 0 &&
              state.pending === null &&
              !mockDraft &&
              !finalText &&
              !interimText && (
                <li className="transcript-empty">
                  {mock ? "고객 요청을 받아쓰고 있어요." : EMPTY}
                </li>
              )}
            {entries.map((entry) =>
              entry.kind === "notes" ? (
                <li key={`notes-${entry.notes[0].seq}`} className="transcript-note-group">
                  <p className="transcript-note-heading">팀 작업 기록</p>
                  <ol className="transcript-notes">
                    {entry.notes.map((note) => (
                      <TeamNoteRow key={note.seq} note={note} />
                    ))}
                  </ol>
                </li>
              ) : (
                <li
                  key={`message-${entry.message.id}`}
                  className={`chat-msg chat-${entry.message.role}`}
                  data-testid={`chat-${entry.message.role}`}
                >
                  <div className="transcript-meta">
                    <strong>{entry.message.role === "user" ? "고객" : "AI 상담 직원"}</strong>
                    <time dateTime={entry.message.created_at}>
                      {formatMessageTime(entry.message.created_at)}
                    </time>
                  </div>
                  <p className="transcript-content">{entry.message.content}</p>
                  {conditionTags(entry.message).length > 0 && (
                    <ul className="transcript-tags" aria-label="파악한 조건">
                      {conditionTags(entry.message).map((tag) => (
                        <li key={tag.label}>
                          <span>{tag.label}</span> {tag.value}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ),
            )}
            {state.pending !== null && (
              <li className="chat-msg chat-user chat-pending">
                <div className="transcript-meta">
                  <strong>고객</strong>
                  <span>보내는 중</span>
                  {pendingAt && <time dateTime={pendingAt}>{formatMessageTime(pendingAt)}</time>}
                </div>
                <p className="transcript-content">{state.pending}</p>
              </li>
            )}
            {mockDraft && (
              <li
                className="chat-msg chat-user transcript-draft"
                data-testid="mock-transcript-draft"
              >
                <div className="transcript-meta">
                  <strong>고객</strong>
                  <span>받아쓰는 중</span>
                  {mockDraftAt && (
                    <time dateTime={mockDraftAt}>{formatMessageTime(mockDraftAt)}</time>
                  )}
                </div>
                <p className="transcript-content">
                  {mockDraft}
                  <span className="transcript-caret" aria-hidden="true" />
                </p>
              </li>
            )}
            {hasVoiceText && (
              <li className="chat-msg chat-user transcript-draft" data-testid="voice-transcript">
                <div className="transcript-meta">
                  <strong>고객</strong>
                  <span>
                    {mock
                      ? "마이크 확인 · 보내지 않음"
                      : hearing
                        ? "받아쓰는 중"
                        : "인식 내용 · 보내지 않음"}
                  </span>
                  {draftAt && <time dateTime={draftAt}>{formatMessageTime(draftAt)}</time>}
                </div>
                <p className="transcript-content">
                  {finalText}
                  <span className="transcript-interim">
                    {finalText && interimText ? " " : ""}
                    {interimText}
                  </span>
                  <span className="transcript-caret" aria-hidden="true" />
                </p>
              </li>
            )}
          </ol>
        </div>
        {chips.length > 0 && (
          <div className="chips" role="group" aria-label="선택지">
            {chips.map((chip) => (
              <button
                type="button"
                key={`${chip.slot ?? ""}:${chip.value ?? chip.label}`}
                className="chip"
                disabled={busy}
                data-testid="chat-chip"
                onClick={() => choose(chip)}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
        <form className="chat-form" onSubmit={submit}>
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={mock ? MOCK_PLACEHOLDER : PLACEHOLDER}
            maxLength={500}
            aria-label="채팅 입력"
            disabled={disabled}
            data-testid="chat-input"
          />
          <button type="submit" disabled={busy || text.trim() === ""} data-testid="chat-send">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m12 5 7 7M12 5l-7 7M12 5v15" />
            </svg>
            <span className="transcript-sr-only">보내기</span>
          </button>
        </form>
        {state.error && (
          <p className="error" role="alert">
            {state.error}
          </p>
        )}
      </div>
    </section>
  );
}
