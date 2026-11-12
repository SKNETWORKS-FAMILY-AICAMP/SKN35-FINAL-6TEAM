/**
 * 채팅 상담 패널 — 텍스트 입력 + 선택지(칩). 음성 상담은 확장 예정입니다.
 * 상담 직원의 답은 서버(규칙 기반 Mock)가 만든 것만 보여 줍니다.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { QuickReply, QuickReplyIn } from "../../api/client";
import { currentQuickReplies, type ChatState } from "./chatState";

interface Props {
  state: ChatState;
  disabled: boolean;
  onSend: (text: string, quickReply: QuickReplyIn | null) => void;
}

const PLACEHOLDER = "예: 7B 모델 파인튜닝할 노트북 추천해 주세요, 예산 300만 원";
const EMPTY = "무엇을 도와드릴까요? 사려는 장비 · 예산 · 용도를 말씀해 주세요.";

export function ChatPanel({ state, disabled, onSend }: Props) {
  const [text, setText] = useState("");
  const logRef = useRef<HTMLOListElement>(null);
  const chips = currentQuickReplies(state);
  const busy = disabled || state.pending !== null;

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [state.messages.length, state.pending]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onSend(trimmed, null);
    setText("");
  }

  function choose(chip: QuickReply) {
    const picked = chip.slot && chip.value ? { slot: chip.slot, value: chip.value } : null;
    onSend(chip.label, picked);
  }

  return (
    <section className="panel chat" aria-label="채팅 상담">
      <h2>채팅 상담</h2>
      <ol className="chat-log" ref={logRef} data-testid="chat-log">
        {state.messages.length === 0 && state.pending === null && (
          <li className="muted">{EMPTY}</li>
        )}
        {state.messages.map((message) => (
          <li
            key={message.id}
            className={`chat-msg chat-${message.role}`}
            data-testid={`chat-${message.role}`}
          >
            {message.content}
          </li>
        ))}
        {state.pending !== null && (
          <li className="chat-msg chat-user chat-pending">
            {state.pending} <span className="muted">보내는 중…</span>
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
          placeholder={PLACEHOLDER}
          maxLength={500}
          aria-label="채팅 입력"
          disabled={disabled}
          data-testid="chat-input"
        />
        <button type="submit" disabled={busy || text.trim() === ""} data-testid="chat-send">
          보내기
        </button>
      </form>
      <p className="muted">규칙 기반 응답(Mock) · 음성 상담은 확장 예정</p>
      {state.error && <p className="error">{state.error}</p>}
    </section>
  );
}
