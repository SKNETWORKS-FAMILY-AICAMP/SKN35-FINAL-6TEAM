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
import { consoleDisplay, mergeTranscript, type ConsoleDisplay } from "./transcriptDisplay";
import { conditionTags, formatMessageTime } from "./transcript";
import { useVoiceConsultation, type VoiceEngineOptions } from "./useVoiceConsultation";
import { PAGE_VOICE_FLAGS } from "./voiceFlags";
import { VoiceTimingPanel } from "./VoiceTimingPanel";
import "./transcript.css";

interface Props {
  state: ChatState;
  disabled: boolean;
  onSend: (text: string, quickReply: QuickReplyIn | null) => void | Promise<void>;
  /** 팀 작업 기록(오피스 상태에서 파생). 대화 말풍선 사이에 시각 순으로 끼웁니다. */
  notes?: TeamNote[];
  /** 오피스 실행 상태. 음성이 대기일 때 콘솔 표시 단계를 고르는 데만 씁니다. */
  officeRunStatus?: DisplayStatus;
  /** 선택형 설문 등 상담 안에서 작성할 화면. 기존 음성·대화 상태는 유지합니다. */
  children?: ReactNode;
  /** 설문을 음성 상담 안에 넓게 펼치는 시작 단계 배치. */
  intakeMode?: boolean;
  /** 시작 단계에서는 대화 기록을 접어 두고 입력칸은 그대로 보여 줍니다. */
  compactWelcome?: boolean;
  /** 음성 엔진 부품(실험 화면·시험용). 없으면 주소 플래그(?barge-in)와 브라우저 기본값을 씁니다. */
  voiceEngine?: VoiceEngineOptions;
  /** 턴 시간 표. 없으면 ?voice-debug 일 때만 보입니다. */
  showTimings?: boolean;
  /** 실제 상담 세션 id. 있으면 서버 음성(켜져 있을 때)과 상품 이름 읽기 사전을 씁니다.
   * 처음 값으로 읽기 경로를 정하므로, 세션이 바뀌면 key 로 다시 마운트해야 합니다. */
  speechSession?: string;
}

const PLACEHOLDER = "예: 노트북 추천, 예산 300만 원";
const EMPTY = "무엇을 도와드릴까요? 사려는 장비 · 예산 · 용도를 말씀해 주세요.";
const NO_NOTES: TeamNote[] = [];
const PAGE_ENGINE: VoiceEngineOptions = {
  bargeIn: PAGE_VOICE_FLAGS.bargeIn,
  tts: PAGE_VOICE_FLAGS.tts === "browser" ? "browser" : "auto",
};
// 바닥에서 이만큼 안쪽에 있으면 새 기록이 올 때 따라 내려갑니다.
const FOLLOW_GAP = 48;

const DISPLAY_LABEL: Record<ConsoleDisplay, string> = {
  idle: "음성 상담 대기",
  listening: "듣는 중",
  transcribing: "듣는 중 · 받아쓰는 중",
  sending: "보내는 중 · 답변을 기다려요",
  speaking: "AI 상담 직원이 읽는 중",
  error: "음성 기능 확인 필요",
  working: "팀이 작업 중이에요",
  waiting: "고객 확인을 기다려요",
  done: "답변 준비됨",
};

function displayDetail(display: ConsoleDisplay, micPaused: boolean, bargeIn: boolean): string {
  if (micPaused) {
    if (display !== "speaking") return "마이크 켜짐 · 듣기 일시정지";
    return bargeIn
      ? "마이크 켜짐 · 말씀하시면 읽기를 멈춰요"
      : "마이크 켜짐 · 답 읽기가 끝나면 다시 들어요";
  }
  switch (display) {
    case "listening":
    case "transcribing":
      return "말씀을 마치면 바로 보내요";
    case "sending":
      return "글과 선택지로도 이어갈 수 있어요";
    case "speaking":
      return "그만 읽기를 누르면 멈춰요";
    case "error":
      return "아래 안내를 확인해 주세요";
    case "working":
      return "상담 직원이 팀 결과를 기다려요";
    case "waiting":
      return "대화 기록의 질문에 답해 주세요";
    case "done":
      return "대화 기록에서 결과를 확인하세요";
    default:
      return "마이크로 말하거나 아래 칸에 적어 주세요";
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
  notes = NO_NOTES,
  officeRunStatus,
  children,
  intakeMode = false,
  compactWelcome = false,
  voiceEngine = PAGE_ENGINE,
  showTimings = PAGE_VOICE_FLAGS.debug,
  speechSession,
}: Props) {
  const History = compactWelcome ? "details" : "div";
  const [text, setText] = useState("");
  const [draftAt, setDraftAt] = useState<string | null>(null);
  const [pendingAt, setPendingAt] = useState<string | null>(null);
  const [pinRequest, setPinRequest] = useState(false);
  const logRef = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const voice = useVoiceConsultation({
    chat: state,
    onSend,
    disabled,
    engine: voiceEngine,
    speechEndpoint: speechSession
      ? `/api/pc-consult/sessions/${encodeURIComponent(speechSession)}/speech`
      : undefined,
  });
  const { micEnabled, speechEnabled, finalText, interimText, speakingKind } = voice.state;
  // 즉시 반응을 읽는 동안은 아직 답을 기다리는 중이라 '보내는 중'으로 보여 줍니다.
  const phase =
    voice.state.phase === "speaking" && speakingKind === "ack" ? "sending" : voice.state.phase;
  const chips = currentQuickReplies(state);
  const busy = disabled || state.pending !== null;
  const hearing = phase === "listening" || phase === "transcribing";
  const hasVoiceText =
    Boolean(finalText || interimText) && phase !== "sending" && phase !== "speaking";
  const display = consoleDisplay(phase, officeRunStatus);
  const detail = displayDetail(display, micEnabled && !hearing && phase !== "error", voice.bargeIn);
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
      request.getBoundingClientRect().bottom <= log.getBoundingClientRect().top + 1;
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
      data-mode="live"
      data-intake={intakeMode || undefined}
    >
      <header className="transcript-header">
        <div className="transcript-title">
          <h2>{intakeMode ? "상담 시작하기" : "음성 상담"}</h2>
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
                data-variant="primary"
                aria-pressed={micEnabled}
                onClick={voice.toggleMic}
                disabled={!micEnabled && (!voice.recognitionSupported || disabled)}
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
          <details className="voice-privacy">
            <summary>음성 처리 안내</summary>
            <p>
              음성은 Chrome 음성 인식 서비스로 보내 글자로 바꿉니다. 녹음 파일은 만들거나 저장하지
              않습니다. 음성 답은 AI 가 만든 목소리로 읽습니다.
              {voice.serverVoice &&
                " 서버 음성이 켜져 있어 답 글을 음성 합성 서비스로 보내 소리로 바꿉니다."}
              {voice.bargeIn &&
                " 끼어들기를 켜면 말소리를 알아채려고 마이크가 계속 켜져 있고, 소리 크기만 브라우저 안에서 확인합니다."}
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
        {voice.state.notice && (
          <p className="voice-help" role="status" data-testid="voice-notice">
            {voice.state.notice}
          </p>
        )}
        {voice.bargeInError && <p className="voice-help">{voice.bargeInError}</p>}
        {voice.state.error && (
          <p className="voice-error" role="alert">
            {voice.state.error}
          </p>
        )}
        {showTimings && <VoiceTimingPanel timer={voice.timer} />}
      </div>
      {children}
      <div className="transcript-conversation">
        <History className="transcript-history">
          {compactWelcome ? (
            <summary className="transcript-log-heading">대화 기록 펼쳐 보기</summary>
          ) : (
            <h3 className="transcript-log-heading">대화 기록</h3>
          )}
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
                !finalText &&
                !interimText && <li className="transcript-empty">{EMPTY}</li>}
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
                    {Boolean(entry.message.sources?.length) && (
                      <ul aria-label="답변 근거">
                        {entry.message.sources?.map((source, index) => (
                          <li key={index}>
                            {source.url && /^https?:\/\//i.test(source.url) ? (
                              <a href={source.url} target="_blank" rel="noreferrer">
                                {source.title || source.url}
                              </a>
                            ) : (
                              source.title
                            )}
                            {source.text && <p>{source.text}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
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
              {hasVoiceText && (
                <li className="chat-msg chat-user transcript-draft" data-testid="voice-transcript">
                  <div className="transcript-meta">
                    <strong>고객</strong>
                    <span>{hearing ? "받아쓰는 중" : "인식 내용 · 보내지 않음"}</span>
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
        </History>
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
            placeholder={PLACEHOLDER}
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
