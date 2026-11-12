/** Voice conversation state. Time and browser events are supplied by the adapter. */
import type { ChatMessage } from "../../api/client";

export type VoicePhase = "idle" | "listening" | "transcribing" | "sending" | "speaking" | "error";

export interface VoiceState {
  phase: VoicePhase;
  micEnabled: boolean;
  speechEnabled: boolean;
  finalText: string;
  interimText: string;
  error: string | null;
  mock: boolean;
  recognitionId: number;
  recognitionBase: string;
  speechActive: boolean;
  silenceAt: number | null;
  awaitingReply: boolean;
  turnId: number;
  request: { id: number; text: string } | null;
  speechId: number;
  speakingText: string;
  speechQueue: string[];
}

export const SILENCE_MS = 1000;

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

export function initialVoiceState(mock = false): VoiceState {
  return {
    phase: "idle",
    micEnabled: false,
    speechEnabled: false,
    finalText: "",
    interimText: "",
    error: null,
    mock,
    recognitionId: 0,
    recognitionBase: "",
    speechActive: false,
    silenceAt: null,
    awaitingReply: false,
    turnId: 0,
    request: null,
    speechId: 0,
    speakingText: "",
    speechQueue: [],
  };
}

export type VoiceAction =
  | { type: "mic"; enabled: boolean }
  | { type: "speech"; enabled: boolean }
  | { type: "result"; recognitionId: number; finalText: string; interimText: string; now: number }
  | { type: "activity"; recognitionId: number; speaking: boolean; now: number }
  | { type: "recognition_ended"; recognitionId: number; now: number }
  | { type: "silence"; recognitionId: number; deadline: number; now: number }
  | { type: "manual_send" }
  | { type: "reply"; text: string }
  | { type: "speech_ended"; speechId: number }
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
    recognitionBase: state.mock ? state.finalText : "",
    finalText: state.mock ? state.finalText : "",
    interimText: "",
    speechActive: false,
    silenceAt: null,
    speakingText: "",
    speechQueue: [],
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
    request: null,
    awaitingReply: false,
    recognitionId: state.recognitionId + 1,
    speechId: state.speechId + 1,
    speakingText: "",
    speechQueue: [],
  };
}

export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case "mic": {
      const occupied = state.phase === "speaking" || state.phase === "sending";
      return {
        ...state,
        micEnabled: action.enabled,
        error: null,
        phase: occupied ? state.phase : action.enabled ? "listening" : "idle",
        recognitionId: state.recognitionId + 1,
        finalText: action.enabled ? "" : state.finalText,
        recognitionBase: "",
        interimText: "",
        speechActive: false,
        silenceAt: null,
      };
    }
    case "speech": {
      const next: VoiceState = {
        ...state,
        speechEnabled: action.enabled,
        error: null,
        phase: state.phase === "error" ? "idle" : state.phase,
      };
      return !action.enabled && state.phase === "speaking"
        ? { ...resume(next), speechId: state.speechId + 1 }
        : next;
    }
    case "result": {
      if (!isListening(state) || action.recognitionId !== state.recognitionId) return state;
      const finalText = [state.recognitionBase, action.finalText.trim()].filter(Boolean).join(" ");
      const interimText = action.interimText.trim();
      // Recognition result lists are cumulative: replace the current session's text.
      if (state.finalText === finalText && state.interimText === interimText) return state;
      return {
        ...state,
        finalText,
        interimText,
        phase: finalText || interimText ? "transcribing" : "listening",
        silenceAt:
          finalText && !interimText && !state.speechActive ? action.now + SILENCE_MS : null,
      };
    }
    case "activity":
      if (!isListening(state) || action.recognitionId !== state.recognitionId) return state;
      return {
        ...state,
        speechActive: action.speaking,
        silenceAt:
          !action.speaking && state.finalText && !state.interimText
            ? action.now + SILENCE_MS
            : null,
      };
    case "recognition_ended":
      if (!isListening(state) || action.recognitionId !== state.recognitionId) return state;
      if (state.interimText) {
        return fail(
          state,
          "말씀의 일부를 확정하지 못했습니다. 마이크를 다시 켜거나 글로 입력해 주세요.",
          "recognition",
        );
      }
      return {
        ...state,
        recognitionId: state.recognitionId + 1,
        recognitionBase: state.finalText,
        speechActive: false,
        silenceAt: state.finalText ? (state.silenceAt ?? action.now + SILENCE_MS) : null,
      };
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
      if (state.mock) return { ...state, silenceAt: null };
      if (state.finalText.length > 500) {
        return fail(
          state,
          "한 번에 500자까지 보낼 수 있습니다. 짧게 다시 말하거나 글로 나누어 입력해 주세요.",
          "recognition",
        );
      }
      const turnId = state.turnId + 1;
      return {
        ...state,
        phase: "sending",
        speechActive: false,
        silenceAt: null,
        turnId,
        recognitionId: state.recognitionId + 1,
        awaitingReply: true,
        request: { id: turnId, text: state.finalText },
      };
    }
    case "manual_send":
      return {
        ...state,
        phase: "sending",
        error: null,
        awaitingReply: true,
        finalText: "",
        interimText: "",
        recognitionBase: "",
        speechActive: false,
        silenceAt: null,
        request: null,
        recognitionId: state.recognitionId + 1,
        speechId: state.speechId + 1,
        speakingText: "",
        speechQueue: [],
      };
    case "reply": {
      // Silent demo replies must not interrupt a live microphone test.
      if (state.mock && !state.speechEnabled && !state.awaitingReply) return state;
      const next = { ...state, request: null, awaitingReply: false, error: null };
      if (!state.speechEnabled || !action.text.trim()) return resume(next);
      if (state.phase === "speaking")
        return { ...next, speechQueue: [...state.speechQueue, action.text] };
      return {
        ...next,
        phase: "speaking",
        recognitionId: state.recognitionId + 1,
        speechActive: false,
        silenceAt: null,
        interimText: "",
        speechId: state.speechId + 1,
        speakingText: action.text,
      };
    }
    case "speech_ended": {
      if (state.phase !== "speaking" || action.speechId !== state.speechId) return state;
      const [next, ...queue] = state.speechQueue;
      return next
        ? { ...state, speakingText: next, speechQueue: queue, speechId: state.speechId + 1 }
        : resume(state);
    }
    case "stop_reading":
      return state.phase === "speaking"
        ? { ...resume(state), speechId: state.speechId + 1 }
        : state;
    case "failed":
      return fail(state, action.error, action.source);
    case "disabled":
      return {
        ...initialVoiceState(state.mock),
        recognitionId: state.recognitionId + 1,
        speechId: state.speechId + 1,
        turnId: state.turnId,
      };
  }
}
