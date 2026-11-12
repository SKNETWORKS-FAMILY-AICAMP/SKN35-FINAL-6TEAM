/**
 * 음성 전사 · 텍스트 입력 · 선택지를 같은 상담 흐름에서 표시합니다.
 * 상담 직원의 답은 서버(규칙 기반 Mock)가 만든 것만 보여 줍니다.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { QuickReply, QuickReplyIn } from "../../api/client";
import { currentQuickReplies, type ChatState } from "./chatState";
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
}

const PLACEHOLDER = "예: 7B 모델 파인튜닝할 노트북 추천해 주세요, 예산 300만 원";
const EMPTY = "무엇을 도와드릴까요? 사려는 장비 · 예산 · 용도를 말씀해 주세요.";

function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8.5" y="2.5" width="7" height="12" rx="3.5" />
      <path d="M5 10.5v1a7 7 0 0 0 14 0v-1M12 18.5v3M8.5 21.5h7" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m11 4-5 4H3v8h3l5 4V4Z" />
      <path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
    </svg>
  );
}

function VoiceCore() {
  const gradientId = useId();

  return (
    <svg className="voice-core" viewBox="0 0 300 88" fill="none" aria-hidden="true">
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="113"
          y1="14"
          x2="187"
          y2="76"
        >
          <stop stopColor="#245d46" />
          <stop offset="1" stopColor="#719767" />
        </linearGradient>
      </defs>
      <path className="voice-core-guide" d="M12 44h84m108 0h84M28 39v10m16-7v4m212-4v4m16-7v10" />
      <circle className="voice-core-orbit" cx="150" cy="44" r="41" />
      <path
        className="voice-core-arc"
        d="M113.5 26A41 41 0 0 1 171 8.8m15.5 53.2A41 41 0 0 1 129 79.2"
      />
      <circle className="voice-core-shell" cx="150" cy="44" r="31" />
      <circle className="voice-core-inner" cx="150" cy="44" r="24" />
      <g className="voice-core-signal" stroke={`url(#${gradientId})`}>
        <path d="M134 41v6" />
        <path d="M142 34v20" />
        <path d="M150 28v32" />
        <path d="M158 36v16" />
        <path d="M166 40v8" />
      </g>
      <circle className="voice-core-node" cx="109" cy="44" r="2" />
      <circle className="voice-core-node" cx="191" cy="44" r="2" />
    </svg>
  );
}

export function ChatPanel({
  state,
  disabled,
  onSend,
  mock = false,
  mockDraft = "",
  mockDraftAt = null,
}: Props) {
  const [text, setText] = useState("");
  const [draftAt, setDraftAt] = useState<string | null>(null);
  const [pendingAt, setPendingAt] = useState<string | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const voice = useVoiceConsultation({ chat: state, onSend, disabled: !mock && disabled, mock });
  const { phase, micEnabled, speechEnabled, finalText, interimText } = voice.state;
  const chips = currentQuickReplies(state);
  const busy = disabled || state.pending !== null;
  const hearing = phase === "listening" || phase === "transcribing";
  const hasVoiceText =
    Boolean(finalText || interimText) && (mock || (phase !== "sending" && phase !== "speaking"));
  const phaseLabel = {
    idle: "음성 상담 대기",
    listening: "듣는 중",
    transcribing: "듣는 중 · 받아쓰는 중",
    sending: "보내는 중 · 답변을 기다려요",
    speaking: "AI 상담 직원이 읽는 중",
    error: "음성 기능 확인 필요",
  }[phase];

  useEffect(() => {
    if (hasVoiceText) setDraftAt((previous) => previous ?? new Date().toISOString());
    else setDraftAt(null);
  }, [hasVoiceText]);

  useEffect(() => {
    setPendingAt(state.pending === null ? null : new Date().toISOString());
  }, [state.pending]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [state.messages.length, state.pending, finalText, interimText, mockDraft]);

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
      aria-label="채팅 상담"
    >
      <header className="transcript-header">
        <div className="transcript-title">
          <span className="transcript-brand-icon" aria-hidden="true">
            <svg viewBox="0 0 28 28" fill="none">
              <path d="M8 10.5v7M12 7v14M16 11v6M20 9v10" />
            </svg>
          </span>
          <div>
            <p className="transcript-eyebrow">VOICE CONSOLE</p>
            <h2>실시간 상담</h2>
          </div>
        </div>
        <span className="transcript-mode">{mock ? "시험 대본" : "음성 · 텍스트"}</span>
      </header>
      <div className="transcript-voice-section">
        <div className="voice-console" data-phase={phase}>
          <div className="voice-indicator" role="status" data-testid="voice-status">
            <span className="voice-status-light" aria-hidden="true">
              {phase === "error" ? "!" : ""}
            </span>
            <span className="voice-status-copy">
              {phaseLabel}
              {mock && hearing && <small> · 마이크 시험</small>}
            </span>
          </div>
          <VoiceCore />
          {micEnabled && !hearing && (
            <p className="voice-mic-notice">
              마이크 켜짐 · 듣기 일시정지
              {phase === "speaking" ? " (답 읽기가 끝나면 다시 들어요)" : ""}
            </p>
          )}
          <div className="voice-controls">
            <button
              type="button"
              className="voice-mic-button"
              data-testid="voice-mic"
              aria-pressed={micEnabled}
              onClick={voice.toggleMic}
              disabled={!micEnabled && (!voice.recognitionSupported || (!mock && disabled))}
            >
              <MicrophoneIcon />
              <span>{micEnabled ? "마이크 끄기" : "마이크 켜기"}</span>
            </button>
            <button
              type="button"
              className="voice-reply-button"
              data-testid="voice-reply"
              aria-pressed={speechEnabled}
              onClick={voice.toggleSpeech}
              disabled={!voice.synthesisSupported}
            >
              <SpeakerIcon />
              <span>{speechEnabled ? "음성 답 끄기" : "음성 답 켜기"}</span>
              <span className="voice-reply-switch" aria-hidden="true" />
            </button>
            {phase === "speaking" && (
              <button
                type="button"
                className="voice-stop"
                onClick={voice.stopReading}
                data-testid="voice-stop"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                </svg>
                그만 읽기
              </button>
            )}
          </div>
        </div>
        <p className="voice-privacy">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="m10 2 6 2.5V9c0 4-3.3 6.7-6 8-2.7-1.3-6-4-6-8V4.5L10 2Z" />
            <path d="m7 9.5 2 2 4-4" />
          </svg>
          <span>
            음성은 브라우저 음성 인식으로 글자로 바뀝니다. 녹음 파일은 만들거나 저장하지 않습니다.
          </span>
        </p>
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
        {mock && (
          <p className="transcript-demo-note">
            <span className="transcript-demo-icon" aria-hidden="true">
              i
            </span>
            <span>
              시험 대본 · 오피스 진행에 맞춰 표시됩니다. 마이크 시험 내용은 전송하지 않습니다.
            </span>
          </p>
        )}
      </div>
      <div className="transcript-conversation">
        <div className="transcript-log-heading">
          <span>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M4 3.5h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H8L4 17v-2.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
              <path d="M6.5 7h7M6.5 10.5H11" />
            </svg>
            대화 전사
          </span>
          <span>{mock ? "DEMO" : "LIVE"}</span>
        </div>
        <ol
          className="chat-log transcript-log"
          ref={logRef}
          data-testid="chat-log"
          aria-label="상담 전사"
          aria-live="polite"
          aria-relevant="additions"
        >
          {state.messages.length === 0 &&
            state.pending === null &&
            !mockDraft &&
            !finalText &&
            !interimText && (
              <li className="transcript-empty">
                {mock ? "고객의 시험 요청을 받아쓰고 있어요." : EMPTY}
              </li>
            )}
          {state.messages.map((message) => (
            <li
              key={message.id}
              className={`chat-msg chat-${message.role}`}
              data-testid={`chat-${message.role}`}
            >
              <div className="transcript-meta">
                <strong>
                  <span className="transcript-avatar" aria-hidden="true">
                    {message.role === "user" ? (
                      <svg viewBox="0 0 20 20" fill="none">
                        <circle cx="10" cy="7" r="2.5" />
                        <path d="M5 15a5 4 0 0 1 10 0" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 20 20" fill="none">
                        <path d="m10 3 1.8 4.9L17 10l-5.2 2.1L10 17l-1.8-4.9L3 10l5.2-2.1L10 3Z" />
                      </svg>
                    )}
                  </span>
                  {message.role === "user" ? "고객" : "AI 상담 직원"}
                </strong>
                <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>
                {mock && <span>시험</span>}
              </div>
              <p className="transcript-content">{message.content}</p>
              {conditionTags(message).length > 0 && (
                <ul className="transcript-tags" aria-label="파악한 조건">
                  {conditionTags(message).map((tag) => (
                    <li key={tag.label}>
                      <span>{tag.label}</span> {tag.value}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {state.pending !== null && (
            <li className="chat-msg chat-user chat-pending">
              <div className="transcript-meta">
                <strong>고객</strong>
                {pendingAt && <time dateTime={pendingAt}>{formatMessageTime(pendingAt)}</time>}
                <span>보내는 중</span>
              </div>
              <p className="transcript-content">{state.pending}</p>
            </li>
          )}
          {mockDraft && (
            <li className="chat-msg chat-user transcript-draft" data-testid="mock-transcript-draft">
              <div className="transcript-meta">
                <strong>고객</strong>
                {mockDraftAt && (
                  <time dateTime={mockDraftAt}>{formatMessageTime(mockDraftAt)}</time>
                )}
                <span>시험 · 받아쓰는 중</span>
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
                {draftAt && <time dateTime={draftAt}>{formatMessageTime(draftAt)}</time>}
                <span>
                  {mock ? "마이크 시험 · 미전송" : hearing ? "받아쓰는 중" : "인식 내용 · 미전송"}
                </span>
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
            placeholder={mock ? "시험 모드에서는 마이크 받아쓰기만 확인해요" : PLACEHOLDER}
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
        <p className="transcript-footer">
          {mock
            ? "실제 상담은 Mock 모드를 끄고 시작해 주세요."
            : "마지막 확정 후 약 1초간 조용하면 보냅니다. 글과 선택지로도 이어갈 수 있어요."}
        </p>
        {state.error && (
          <p className="error" role="alert">
            {state.error}
          </p>
        )}
      </div>
    </section>
  );
}
