import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../api/client";
import {
  findVoiceReply,
  initialVoiceState,
  isListening,
  voiceReducer,
  type VoiceAction,
  type VoiceState,
  type VoiceReplyBoundary,
} from "./voiceState";

function listening(mock = false) {
  return voiceReducer(initialVoiceState(mock), { type: "mic", enabled: true });
}

function result(state: VoiceState, finalText: string, interimText = "", now = 0) {
  return voiceReducer(state, {
    type: "result",
    recognitionId: state.recognitionId,
    finalText,
    interimText,
    now,
  });
}

function silence(state: VoiceState, now = 1000) {
  return voiceReducer(state, {
    type: "silence",
    recognitionId: state.recognitionId,
    deadline: state.silenceAt ?? now,
    now,
  });
}

describe("voiceReducer", () => {
  it("starts quietly and waits a full second after the latest confirmed result", () => {
    expect(initialVoiceState().speechEnabled).toBe(false);
    let state = result(listening(), "노트북이 필요해요", "", 200);
    expect(state.phase).toBe("transcribing");
    expect(silence(state, 1199).request).toBeNull();
    state = silence(state, 1200);
    expect(state.request).toEqual({ id: 1, text: "노트북이 필요해요" });
    expect(state.phase).toBe("sending");
    expect(isListening(state)).toBe(false);
  });

  it("shows cumulative interim text without submitting any unconfirmed words", () => {
    let state = result(listening(), "", "개발용 노트북", 0);
    expect(state.interimText).toBe("개발용 노트북");
    expect(silence(state, 20000).request).toBeNull();
    state = result(state, "개발용 노트북", "예산은", 22000);
    expect(state.finalText).toBe("개발용 노트북");
    expect(silence(state, 30000).request).toBeNull();
    state = result(state, "개발용 노트북 예산은 300만 원", "", 31000);
    expect(silence(state, 32000).request?.text).toBe("개발용 노트북 예산은 300만 원");
  });

  it("continued speech cancels a stale silence timer and restarts it at speech end", () => {
    let state = result(listening(), "노트북", "", 0);
    const oldId = state.recognitionId;
    state = voiceReducer(state, {
      type: "activity",
      recognitionId: oldId,
      speaking: true,
      now: 900,
    });
    state = voiceReducer(state, {
      type: "silence",
      recognitionId: oldId,
      deadline: 1000,
      now: 1000,
    });
    expect(state.request).toBeNull();
    state = voiceReducer(state, {
      type: "activity",
      recognitionId: oldId,
      speaking: false,
      now: 1500,
    });
    expect(silence(state, 2499).request).toBeNull();
    expect(silence(state, 2500).request?.text).toBe("노트북");
  });

  it("does not duplicate cumulative finals, stale results, or repeated timer callbacks", () => {
    let state = result(listening(), "예산 300만 원");
    const oldId = state.recognitionId;
    expect(result(state, "예산 300만 원", "", 500)).toBe(state);
    state = silence(state);
    const sent = state;
    state = voiceReducer(state, {
      type: "result",
      recognitionId: oldId,
      finalText: "중복",
      interimText: "",
      now: 1500,
    });
    state = voiceReducer(state, {
      type: "silence",
      recognitionId: oldId,
      deadline: 1000,
      now: 1500,
    });
    expect(state).toBe(sent);
    expect(state.turnId).toBe(1);
  });

  it("does not submit a finalized segment while the customer is still speaking", () => {
    let state = listening();
    state = voiceReducer(state, {
      type: "activity",
      recognitionId: state.recognitionId,
      speaking: true,
      now: 0,
    });
    state = result(state, "중간 확정", "", 300);
    expect(state.speechActive).toBe(true);
    expect(state.silenceAt).toBeNull();
    expect(silence(state, 5000).request).toBeNull();
    state = result(state, "중간 확정 다음에 계속 말해요", "", 5100);
    expect(silence(state, 6100).request).toBeNull();
    state = voiceReducer(state, {
      type: "activity",
      recognitionId: state.recognitionId,
      speaking: false,
      now: 6300,
    });
    expect(state.speechActive).toBe(false);
    expect(silence(state, 7299).request).toBeNull();
    expect(silence(state, 7300).request?.text).toBe("중간 확정 다음에 계속 말해요");
  });

  it("starts the silence window when recognition ends without a speech-end callback", () => {
    let state = listening();
    state = voiceReducer(state, {
      type: "activity",
      recognitionId: state.recognitionId,
      speaking: true,
      now: 0,
    });
    state = result(state, "확정된 문장", "", 300);
    state = voiceReducer(state, {
      type: "recognition_ended",
      recognitionId: state.recognitionId,
      now: 800,
    });
    expect(state.speechActive).toBe(false);
    expect(silence(state, 1799).request).toBeNull();
    expect(silence(state, 1800).request?.text).toBe("확정된 문장");
  });

  it.each<VoiceAction>([
    { type: "mic", enabled: false },
    { type: "manual_send" },
    { type: "failed", source: "recognition", error: "인식 실패" },
    { type: "disabled" },
  ])("clears active speech on $type", (action) => {
    let state = listening();
    state = voiceReducer(state, {
      type: "activity",
      recognitionId: state.recognitionId,
      speaking: true,
      now: 0,
    });
    state = voiceReducer(state, action);
    expect(state.speechActive).toBe(false);
    expect(state.silenceAt).toBeNull();
  });

  it("pauses listening for a reply and resumes only after reading finishes", () => {
    let state = voiceReducer(listening(), { type: "speech", enabled: true });
    state = silence(result(state, "노트북"));
    state = voiceReducer(state, { type: "reply", text: "서버에서 받은 답" });
    expect(state.phase).toBe("speaking");
    expect(state.speakingText).toBe("서버에서 받은 답");
    expect(state.micEnabled).toBe(true);
    expect(isListening(state)).toBe(false);
    const reading = state;
    expect(result(state, "자기 목소리")).toBe(reading);
    state = voiceReducer(state, { type: "speech_ended", speechId: state.speechId });
    expect(isListening(state)).toBe(true);
    expect(state.finalText).toBe("");
  });

  it("stop reading ignores a late speech-end callback and clears queued answers", () => {
    let state = voiceReducer(listening(), { type: "speech", enabled: true });
    state = voiceReducer(state, { type: "reply", text: "첫 번째 답" });
    const speechId = state.speechId;
    state = voiceReducer(state, { type: "reply", text: "다음 답" });
    state = voiceReducer(state, { type: "stop_reading" });
    expect(isListening(state)).toBe(true);
    expect(state.speechQueue).toEqual([]);
    expect(voiceReducer(state, { type: "speech_ended", speechId })).toBe(state);
  });

  it("turning off the microphone cancels pending automatic submission", () => {
    let state = result(listening(), "보내지 마세요");
    const recognitionId = state.recognitionId;
    state = voiceReducer(state, { type: "mic", enabled: false });
    state = voiceReducer(state, { type: "silence", recognitionId, deadline: 1000, now: 1000 });
    expect(state.request).toBeNull();
    expect(state.phase).toBe("idle");
    state = voiceReducer(state, { type: "reply", text: "도착한 답" });
    expect(isListening(state)).toBe(false);
  });

  it("turning the microphone off during reading keeps it off after reading", () => {
    let state = voiceReducer(listening(), { type: "speech", enabled: true });
    state = voiceReducer(state, { type: "reply", text: "서버 답" });
    state = voiceReducer(state, { type: "mic", enabled: false });
    expect(state.phase).toBe("speaking");
    state = voiceReducer(state, { type: "speech_ended", speechId: state.speechId });
    expect(state.phase).toBe("idle");
  });

  it("mock microphone results remain a test transcript and never create a send request", () => {
    let state = result(listening(true), "시험 중인 내 말");
    state = silence(state, 1000);
    expect(state.finalText).toBe("시험 중인 내 말");
    expect(state.request).toBeNull();
    expect(state.awaitingReply).toBe(false);
    expect(isListening(state)).toBe(true);
    state = voiceReducer(state, { type: "reply", text: "가상 대본의 답" });
    expect(state.speakingText).toBe("");
    expect(state.finalText).toBe("시험 중인 내 말");
  });

  it("preserves confirmed words over a natural recognition restart", () => {
    let state = result(listening(), "개발용");
    const oldId = state.recognitionId;
    state = voiceReducer(state, { type: "recognition_ended", recognitionId: oldId, now: 200 });
    expect(state.recognitionId).not.toBe(oldId);
    state = result(state, "노트북", "", 400);
    expect(silence(state, 1400).request?.text).toBe("개발용 노트북");
  });

  it("silent mock replies do not clear or restart microphone test transcription", () => {
    const state = result(listening(true), "내 말", "아직 말하는 중");
    const next = voiceReducer(state, { type: "reply", text: "대본의 답" });
    expect(next.recognitionId).toBe(state.recognitionId);
    expect(next.finalText).toBe("내 말");
    expect(next.interimText).toBe("아직 말하는 중");
    expect(next.phase).toBe("transcribing");
  });

  it("silent mock replies preserve microphone error reasons", () => {
    const state = voiceReducer(listening(true), {
      type: "failed",
      source: "recognition",
      error: "마이크 권한이 거부되었습니다.",
    });
    const next = voiceReducer(state, { type: "reply", text: "다음 대본의 답" });
    expect(next).toBe(state);
    expect(next.phase).toBe("error");
    expect(next.error).toBe("마이크 권한이 거부되었습니다.");
  });

  it("speech output can be reenabled after a synthesis error", () => {
    let state = voiceReducer(initialVoiceState(), {
      type: "failed",
      source: "synthesis",
      error: "음성 없음",
    });
    state = voiceReducer(state, { type: "speech", enabled: true });
    expect(state.phase).toBe("idle");
    expect(state.speechEnabled).toBe(true);
    expect(state.error).toBeNull();
  });

  it("never silently sends a partial utterance when recognition ends with interim words", () => {
    let state = result(listening(), "예산은", "300만");
    state = voiceReducer(state, {
      type: "recognition_ended",
      recognitionId: state.recognitionId,
      now: 1000,
    });
    expect(state.phase).toBe("error");
    expect(state.micEnabled).toBe(false);
    expect(silence(state, 10000).request).toBeNull();
  });

  it.each(["recognition", "synthesis", "send"] as const)(
    "%s failure leaves text sending recoverable",
    (source) => {
      let state = voiceReducer(listening(), { type: "failed", source, error: "실패 이유" });
      expect(state.phase).toBe("error");
      expect(state.error).toBe("실패 이유");
      expect(state.micEnabled).toBe(false);
      state = voiceReducer(state, { type: "manual_send" });
      expect(state.phase).toBe("sending");
      expect(state.error).toBeNull();
      state = voiceReducer(state, { type: "reply", text: "글 입력에 대한 서버 답" });
      expect(state.phase).toBe("idle");
    },
  );

  it("text sending interrupts listening and reading without submitting a voice draft", () => {
    let state = result(listening(), "미완성 음성");
    state = voiceReducer(state, { type: "manual_send" });
    expect(isListening(state)).toBe(false);
    expect(state.finalText).toBe("");
    expect(state.request).toBeNull();
    state = voiceReducer(state, { type: "speech", enabled: true });
    state = voiceReducer(state, { type: "reply", text: "서버 답" });
    state = voiceReducer(state, { type: "manual_send" });
    expect(state.phase).toBe("sending");
    expect(state.speakingText).toBe("");
  });

  it("rejects oversized utterances rather than truncating the customer's words", () => {
    const state = silence(result(listening(), "가".repeat(501)));
    expect(state.phase).toBe("error");
    expect(state.request).toBeNull();
    expect(state.finalText).toHaveLength(501);
  });
});

function message(id: number, role: "user" | "assistant", content: string): ChatMessage {
  return {
    id,
    session_id: "session",
    role,
    content,
    quick_replies: [],
    nlu: null,
    created_at: "2026-11-12T00:00:00Z",
  };
}

describe("voice reply boundary", () => {
  const history = [message(1, "user", "노트북"), message(2, "assistant", "과거 답")];
  const current = [...history, message(3, "user", "노트북"), message(4, "assistant", "이번 답")];
  const boundary: VoiceReplyBoundary = {
    afterId: 2,
    text: "노트북",
    sawPending: false,
    completed: false,
  };

  it("does not consume loaded history in the same render as a new submission", () => {
    // The first GET may contain the exact same words as this new request.
    expect(findVoiceReply(history, { ...boundary, afterId: 0 }, null)).toBeNull();
    expect(findVoiceReply(current, boundary, null)).toBeNull();
  });

  it("accepts the current pair after observing pending followed by a settled response", () => {
    const observed = { ...boundary, sawPending: true };
    expect(findVoiceReply(current, observed, "노트북")).toBeNull();
    expect(findVoiceReply(history, observed, null)).toBeNull();
    expect(findVoiceReply(current, observed, null)?.content).toBe("이번 답");
  });

  it("handles a fast Promise response even if React never committed pending", () => {
    const completed = { ...boundary, completed: true };
    expect(findVoiceReply(history, completed, null)).toBeNull();
    expect(findVoiceReply(current, completed, null)?.id).toBe(4);
  });

  it("requires a matching new customer message followed by its own assistant reply", () => {
    const completed = { ...boundary, completed: true };
    expect(
      findVoiceReply([...history, message(3, "assistant", "관련 없는 답")], completed, null),
    ).toBeNull();
    expect(
      findVoiceReply(
        [...history, message(3, "user", "다른 질문"), message(4, "assistant", "다른 답")],
        completed,
        null,
      ),
    ).toBeNull();
    expect(
      findVoiceReply(
        [
          ...history,
          message(3, "user", "노트북"),
          message(4, "user", "다른 질문"),
          message(5, "assistant", "다른 답"),
        ],
        completed,
        null,
      ),
    ).toBeNull();
  });
});
