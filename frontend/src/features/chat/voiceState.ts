/** Voice conversation state. Time and browser events are supplied by the adapter. */
import type { ChatMessage } from "../../api/client";
import {
  fixedEndpoint,
  type EndpointDecision,
  type EndpointPolicy,
  type EndpointRule,
} from "./endpointPolicy";

export type VoicePhase = "idle" | "listening" | "transcribing" | "sending" | "speaking" | "error";

/** 읽는 것이 즉시 반응(ack)인지 실제 답(content)인지. 끼어들기와 화면 표시가 다르게 처리합니다. */
export type SpeakingKind = "ack" | "content";

export interface VoiceRequest {
  id: number;
  text: string;
}

/** 마지막 음성 턴을 보낸 근거. 시간 기록에만 씁니다. */
export interface SentEndpoint {
  turnId: number;
  /** 말 끝 판정 시각(ms). */
  at: number;
  rule: EndpointRule;
  delayMs: number;
}

export interface VoiceState {
  phase: VoicePhase;
  micEnabled: boolean;
  speechEnabled: boolean;
  finalText: string;
  interimText: string;
  error: string | null;
  recognitionId: number;
  recognitionBase: string;
  speechActive: boolean;
  silenceAt: number | null;
  /** silenceAt 을 정한 말 끝 판정. 전송할 때 시간 기록에 같이 남깁니다. */
  endpoint: EndpointDecision | null;
  awaitingReply: boolean;
  turnId: number;
  request: VoiceRequest | null;
  sentEndpoint: SentEndpoint | null;
  speechId: number;
  speakingText: string;
  speechQueue: string[];
  speakingKind: SpeakingKind | null;
  speakingTurn: number | null;
  /** 이 턴의 답을 기다리는 동안 즉시 반응을 읽어도 되는지. 답·글 전송·실패에서 지웁니다. */
  ackFor: number | null;
  /** 즉시 반응 중에 멈추거나 끼어든 턴. 그 답은 소리 없이 화면에만 둡니다. */
  silentReply: boolean;
  /** 상태 줄에 잠깐 보여 줄 안내. 다음 말이나 전송에서 지웁니다. */
  notice: string | null;
}

/** 고정 대기 정책(시험과 예전 동작). 가변 정책은 useVoiceConsultation 이 endpointDelay 로 만듭니다. */
export const SILENCE_MS = 1000;

export const WAIT_NOTICE =
  "답을 준비하는 동안에는 말씀을 받지 못해요. 답이 나온 뒤 다시 말씀해 주세요.";

export interface VoiceReplyBoundary {
  afterId: number;
  text: string;
  sawPending: boolean;
  completed: boolean;
}

/** A loaded history alone cannot complete a newly submitted voice/text turn. */
export function findVoiceReply(
  messages: readonly ChatMessage[],
  boundary: VoiceReplyBoundary,
  pending: string | null,
): ChatMessage | null {
  if (pending !== null || (!boundary.sawPending && !boundary.completed)) return null;
  const userIndex = messages.findLastIndex(
    (message) =>
      message.role === "user" &&
      message.id > boundary.afterId &&
      message.content.trim() === boundary.text.trim(),
  );
  if (userIndex < 0) return null;
  const user = messages[userIndex];
  const reply = messages[userIndex + 1];
  return reply?.role === "assistant" && reply.id > user.id && reply.session_id === user.session_id
    ? reply
    : null;
}

export function initialVoiceState(): VoiceState {
  return {
    phase: "idle",
    micEnabled: false,
    speechEnabled: false,
    finalText: "",
    interimText: "",
    error: null,
    recognitionId: 0,
    recognitionBase: "",
    speechActive: false,
    silenceAt: null,
    endpoint: null,
    awaitingReply: false,
    turnId: 0,
    request: null,
    sentEndpoint: null,
    speechId: 0,
    speakingText: "",
    speechQueue: [],
    speakingKind: null,
    speakingTurn: null,
    ackFor: null,
    silentReply: false,
    notice: null,
  };
}

export type VoiceAction =
  | { type: "mic"; enabled: boolean }
  | { type: "speech"; enabled: boolean }
  | { type: "result"; recognitionId: number; finalText: string; interimText: string; now: number }
  | { type: "activity"; recognitionId: number; speaking: boolean; now: number }
  | { type: "recognition_ended"; recognitionId: number; now: number }
  | { type: "recognition_retry"; recognitionId: number }
  | { type: "silence"; recognitionId: number; deadline: number; now: number }
  | { type: "manual_send" }
  | { type: "ack_due"; turnId: number; text: string }
  | { type: "reply"; text: string; sentences?: string[] }
  | { type: "reply_missing" }
  | { type: "speech_ended"; speechId: number }
  | { type: "barge_in"; speechId: number }
  | { type: "stop_reading" }
  | { type: "failed"; error: string; source: "recognition" | "synthesis" | "send" }
  | { type: "disabled" };

export function isListening(state: VoiceState): boolean {
  return state.micEnabled && (state.phase === "listening" || state.phase === "transcribing");
}

function resume(state: VoiceState): VoiceState {
  return {
    ...state,
    phase: state.micEnabled ? "listening" : "idle",
    recognitionId: state.recognitionId + 1,
    recognitionBase: "",
    finalText: "",
    interimText: "",
    speechActive: false,
    silenceAt: null,
    endpoint: null,
    speakingText: "",
    speechQueue: [],
    speakingKind: null,
    speakingTurn: null,
  };
}

/**
 * 읽기가 끝나거나 멈췄을 때 가는 곳은 여기 하나입니다.
 * 답을 아직 기다리면(즉시 반응만 읽은 경우) 듣기로 돌아가지 않고 '보내는 중'에 머뭅니다.
 */
function afterSpeech(state: VoiceState, invalidate: boolean): VoiceState {
  const base = invalidate ? { ...state, speechId: state.speechId + 1 } : state;
  if (!state.awaitingReply) return resume(base);
  return {
    ...base,
    phase: "sending",
    speakingText: "",
    speechQueue: [],
    speakingKind: null,
    speakingTurn: null,
  };
}

function fail(
  state: VoiceState,
  error: string,
  source: "recognition" | "synthesis" | "send",
): VoiceState {
  return {
    ...state,
    phase: "error",
    error,
    micEnabled: false,
    speechEnabled: source === "synthesis" ? false : state.speechEnabled,
    interimText: "",
    speechActive: false,
    silenceAt: null,
    endpoint: null,
    request: null,
    awaitingReply: false,
    recognitionId: state.recognitionId + 1,
    speechId: state.speechId + 1,
    speakingText: "",
    speechQueue: [],
    speakingKind: null,
    speakingTurn: null,
    ackFor: null,
    silentReply: false,
  };
}

export function createVoiceReducer(policy: EndpointPolicy) {
  function schedule(text: string, now: number) {
    const endpoint = policy(text);
    return { silenceAt: now + endpoint.delayMs, endpoint };
  }

  return function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
    switch (action.type) {
      case "mic": {
        const occupied = state.phase === "speaking" || state.phase === "sending";
        return {
          ...state,
          micEnabled: action.enabled,
          error: null,
          notice: null,
          phase: occupied ? state.phase : action.enabled ? "listening" : "idle",
          recognitionId: state.recognitionId + 1,
          finalText: action.enabled ? "" : state.finalText,
          recognitionBase: "",
          interimText: "",
          speechActive: false,
          silenceAt: null,
          endpoint: null,
        };
      }
      case "speech": {
        const next: VoiceState = {
          ...state,
          speechEnabled: action.enabled,
          error: null,
          phase: state.phase === "error" ? "idle" : state.phase,
          ackFor: action.enabled ? state.ackFor : null,
        };
        return !action.enabled && state.phase === "speaking" ? afterSpeech(next, true) : next;
      }
      case "result": {
        if (!isListening(state) || action.recognitionId !== state.recognitionId) return state;
        const finalText = [state.recognitionBase, action.finalText.trim()]
          .filter(Boolean)
          .join(" ");
        const interimText = action.interimText.trim();
        // Recognition result lists are cumulative: replace the current session's text.
        if (state.finalText === finalText && state.interimText === interimText) return state;
        const waiting = finalText && !interimText && !state.speechActive;
        return {
          ...state,
          finalText,
          interimText,
          notice: finalText || interimText ? null : state.notice,
          phase: finalText || interimText ? "transcribing" : "listening",
          ...(waiting ? schedule(finalText, action.now) : { silenceAt: null, endpoint: null }),
        };
      }
      case "activity": {
        if (!isListening(state) || action.recognitionId !== state.recognitionId) return state;
        const waiting = !action.speaking && state.finalText && !state.interimText;
        return {
          ...state,
          speechActive: action.speaking,
          ...(waiting
            ? schedule(state.finalText, action.now)
            : { silenceAt: null, endpoint: null }),
        };
      }
      case "recognition_ended": {
        if (!isListening(state) || action.recognitionId !== state.recognitionId) return state;
        if (state.interimText) {
          return fail(
            state,
            "말씀의 일부를 확정하지 못했습니다. 마이크를 다시 켜거나 글로 입력해 주세요.",
            "recognition",
          );
        }
        const kept =
          state.finalText && state.silenceAt !== null
            ? { silenceAt: state.silenceAt, endpoint: state.endpoint }
            : state.finalText
              ? schedule(state.finalText, action.now)
              : { silenceAt: null, endpoint: null };
        return {
          ...state,
          recognitionId: state.recognitionId + 1,
          recognitionBase: state.finalText,
          speechActive: false,
          ...kept,
        };
      }
      case "recognition_retry":
        if (!isListening(state) || action.recognitionId !== state.recognitionId) return state;
        return { ...state, recognitionId: state.recognitionId + 1, speechActive: false };
      case "silence": {
        if (
          !isListening(state) ||
          action.recognitionId !== state.recognitionId ||
          state.silenceAt !== action.deadline ||
          action.now < action.deadline ||
          state.speechActive ||
          !state.finalText ||
          state.interimText
        )
          return state;
        if (state.finalText.length > 500) {
          return fail(
            state,
            "한 번에 500자까지 보낼 수 있습니다. 짧게 다시 말하거나 글로 나누어 입력해 주세요.",
            "recognition",
          );
        }
        const turnId = state.turnId + 1;
        const endpoint = state.endpoint ?? policy(state.finalText);
        return {
          ...state,
          phase: "sending",
          speechActive: false,
          silenceAt: null,
          endpoint: null,
          turnId,
          recognitionId: state.recognitionId + 1,
          awaitingReply: true,
          request: { id: turnId, text: state.finalText },
          sentEndpoint: {
            turnId,
            at: action.now,
            rule: endpoint.rule,
            delayMs: endpoint.delayMs,
          },
          ackFor: state.speechEnabled ? turnId : null,
          silentReply: false,
          notice: null,
        };
      }
      case "manual_send":
        return {
          ...state,
          phase: "sending",
          error: null,
          notice: null,
          awaitingReply: true,
          turnId: state.turnId + 1,
          finalText: "",
          interimText: "",
          recognitionBase: "",
          speechActive: false,
          silenceAt: null,
          endpoint: null,
          request: null,
          recognitionId: state.recognitionId + 1,
          speechId: state.speechId + 1,
          speakingText: "",
          speechQueue: [],
          speakingKind: null,
          speakingTurn: null,
          // 글로 보낸 턴에는 즉시 반응을 하지 않습니다. 앞 턴의 타이머도 여기서 무효가 됩니다.
          ackFor: null,
          silentReply: false,
        };
      case "ack_due":
        if (
          state.phase !== "sending" ||
          !state.awaitingReply ||
          !state.speechEnabled ||
          state.ackFor !== action.turnId ||
          !action.text.trim()
        )
          return state;
        return {
          ...state,
          phase: "speaking",
          ackFor: null,
          recognitionId: state.recognitionId + 1,
          speechId: state.speechId + 1,
          speakingText: action.text,
          speechQueue: [],
          speakingKind: "ack",
          speakingTurn: action.turnId,
        };
      case "reply": {
        // A late response must not interrupt dictation for a different turn.
        if (!state.speechEnabled && !state.awaitingReply) return state;
        const sentences = (action.sentences ?? [action.text]).filter((text) => text.trim());
        const next: VoiceState = {
          ...state,
          request: null,
          awaitingReply: false,
          error: null,
          ackFor: null,
        };
        if (state.silentReply) {
          const silent = { ...next, silentReply: false };
          return state.phase === "speaking" ? silent : resume(silent);
        }
        if (!state.speechEnabled || !sentences.length) {
          return state.phase === "speaking" ? next : resume(next);
        }
        if (state.phase === "speaking")
          return { ...next, speechQueue: [...state.speechQueue, ...sentences] };
        return {
          ...next,
          phase: "speaking",
          recognitionId: state.recognitionId + 1,
          speechActive: false,
          silenceAt: null,
          endpoint: null,
          interimText: "",
          speechId: state.speechId + 1,
          speakingText: sentences[0],
          speechQueue: sentences.slice(1),
          speakingKind: "content",
          speakingTurn: state.turnId,
        };
      }
      case "reply_missing": {
        if (!state.awaitingReply) return state;
        const next: VoiceState = {
          ...state,
          awaitingReply: false,
          request: null,
          ackFor: null,
          silentReply: false,
        };
        return state.phase === "speaking" ? next : resume(next);
      }
      case "speech_ended": {
        if (state.phase !== "speaking" || action.speechId !== state.speechId) return state;
        const [nextText, ...queue] = state.speechQueue;
        return nextText
          ? {
              ...state,
              speakingText: nextText,
              speechQueue: queue,
              speechId: state.speechId + 1,
              speakingKind: "content",
            }
          : afterSpeech(state, false);
      }
      case "barge_in": {
        if (state.phase !== "speaking" || action.speechId !== state.speechId || !state.micEnabled)
          return state;
        // 즉시 반응 중이면 요청이 처리 중이라 말을 받을 수 없습니다. 반응만 끊고 답은 화면에만 둡니다.
        return state.awaitingReply
          ? { ...afterSpeech(state, true), silentReply: true, notice: WAIT_NOTICE }
          : afterSpeech(state, true);
      }
      case "stop_reading":
        if (state.phase !== "speaking") return state;
        return state.awaitingReply
          ? { ...afterSpeech(state, true), silentReply: true }
          : afterSpeech(state, true);
      case "failed":
        return fail(state, action.error, action.source);
      case "disabled":
        return {
          ...initialVoiceState(),
          recognitionId: state.recognitionId + 1,
          speechId: state.speechId + 1,
          turnId: state.turnId,
        };
    }
  };
}

/** 고정 1초 대기 리듀서. 시험과 예전 동작 비교용입니다. */
export const voiceReducer = createVoiceReducer(fixedEndpoint(SILENCE_MS));
