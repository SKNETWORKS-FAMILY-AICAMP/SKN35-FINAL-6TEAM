/** 즉시 반응 · 문장 큐 · 끼어들기 · 가변 말 끝 판정 상태 전이. 예전 동작은 voiceState.test.ts 가 지킵니다. */
import { describe, expect, it } from "vitest";
import { CONTINUATION_DELAY_MS, FINAL_DELAY_MS, endpointDelay } from "./endpointPolicy";
import {
  WAIT_NOTICE,
  createVoiceReducer,
  initialVoiceState,
  isListening,
  type VoiceAction,
  type VoiceState,
} from "./voiceState";

const reduce = createVoiceReducer(endpointDelay);

function apply(state: VoiceState, ...actions: VoiceAction[]) {
  return actions.reduce(reduce, state);
}

function ready(speech = true) {
  return apply(
    initialVoiceState(),
    { type: "mic", enabled: true },
    { type: "speech", enabled: speech },
  );
}

function said(state: VoiceState, text: string, now = 100) {
  return apply(state, {
    type: "result",
    recognitionId: state.recognitionId,
    finalText: text,
    interimText: "",
    now,
  });
}

/** 말하고 말 끝 판정까지 가서 보낸 상태. */
function sent(speech = true, text = "그래픽카드 추천해 주세요") {
  const heard = said(ready(speech), text);
  return apply(heard, {
    type: "silence",
    recognitionId: heard.recognitionId,
    deadline: heard.silenceAt ?? 0,
    now: heard.silenceAt ?? 0,
  });
}

function acking() {
  const state = sent();
  return apply(state, { type: "ack_due", turnId: state.turnId, text: "네, 잠시만요." });
}

const SENTENCES = ["첫 문장이에요.", "둘째 문장이에요.", "셋째 문장이에요."];

describe("variable endpointing", () => {
  it("waits less after a finished sentence and more when the sentence is still going", () => {
    const finished = said(ready(), "그래픽카드 추천해 주세요", 200);
    expect(finished.silenceAt).toBe(200 + FINAL_DELAY_MS);
    expect(finished.endpoint?.rule).toBe("final");
    const going = said(ready(), "예산은 백오십만 원인데 그래픽카드는", 200);
    expect(going.silenceAt).toBe(200 + CONTINUATION_DELAY_MS);
  });

  it("records why and when the turn was sent, apart from the request", () => {
    const state = sent();
    expect(state.request).toEqual({ id: 1, text: "그래픽카드 추천해 주세요" });
    expect(state.sentEndpoint).toEqual({
      turnId: 1,
      at: 100 + FINAL_DELAY_MS,
      rule: "final",
      delayMs: FINAL_DELAY_MS,
    });
    expect(state.ackFor).toBe(1);
    expect(sent(false).ackFor).toBeNull();
  });
});

describe("immediate acknowledgment", () => {
  it("speaks the ack only for the turn that is still waiting", () => {
    const state = acking();
    expect(state.phase).toBe("speaking");
    expect(state.speakingKind).toBe("ack");
    expect(state.speakingText).toBe("네, 잠시만요.");
    expect(state.awaitingReply).toBe(true);
    expect(state.ackFor).toBeNull();
  });

  it("ignores a late, stale or disabled ack timer", () => {
    const waiting = sent();
    const answered = apply(waiting, { type: "reply", text: "답", sentences: ["답이에요."] });
    expect(apply(answered, { type: "ack_due", turnId: 1, text: "네" })).toBe(answered);
    expect(apply(waiting, { type: "ack_due", turnId: 0, text: "네" })).toBe(waiting);
    const typed = apply(waiting, { type: "manual_send" });
    expect(typed.turnId).toBe(2);
    expect(typed.ackFor).toBeNull();
    expect(apply(typed, { type: "ack_due", turnId: 1, text: "네" })).toBe(typed);
    expect(apply(typed, { type: "ack_due", turnId: 2, text: "네" })).toBe(typed);
    const muted = apply(waiting, { type: "speech", enabled: false });
    expect(apply(muted, { type: "ack_due", turnId: 1, text: "네" })).toBe(muted);
  });

  it("queues the reply after the ack and then reads it as content", () => {
    let state = apply(acking(), { type: "reply", text: "x", sentences: SENTENCES });
    expect(state.speakingKind).toBe("ack");
    expect(state.speechQueue).toEqual(SENTENCES);
    expect(state.awaitingReply).toBe(false);
    state = apply(state, { type: "speech_ended", speechId: state.speechId });
    expect(state).toMatchObject({ speakingText: SENTENCES[0], speakingKind: "content" });
    expect(state.speakingTurn).toBe(1);
  });

  it("goes back to waiting, not listening, when the ack ends before the reply", () => {
    const state = acking();
    const after = apply(state, { type: "speech_ended", speechId: state.speechId });
    expect(after.phase).toBe("sending");
    expect(isListening(after)).toBe(false);
    expect(after.recognitionId).toBe(state.recognitionId);
    const answered = apply(after, { type: "reply", text: "x", sentences: SENTENCES });
    expect(answered).toMatchObject({ phase: "speaking", speakingKind: "content" });
  });

  it("keeps the reply silent after the ack was stopped by the button", () => {
    const stopped = apply(acking(), { type: "stop_reading" });
    expect(stopped).toMatchObject({ phase: "sending", silentReply: true, notice: null });
    const answered = apply(stopped, { type: "reply", text: "x", sentences: SENTENCES });
    expect(answered.phase).toBe("listening");
    expect(answered.silentReply).toBe(false);
    expect(answered.speakingText).toBe("");
  });

  it("survives mic off, failure and disable during the ack", () => {
    let state = apply(acking(), { type: "mic", enabled: false });
    expect(state.phase).toBe("speaking");
    state = apply(state, { type: "speech_ended", speechId: state.speechId });
    state = apply(state, { type: "reply", text: "x", sentences: ["답이에요. 끝."] });
    expect(state.phase).toBe("speaking");
    state = apply(state, { type: "speech_ended", speechId: state.speechId });
    expect(state.phase).toBe("idle");

    const failed = apply(acking(), { type: "failed", source: "send", error: "실패" });
    expect(failed).toMatchObject({ phase: "error", speakingKind: null, ackFor: null });
    const disabled = apply(acking(), { type: "disabled" });
    expect(disabled).toMatchObject({ phase: "idle", speakingKind: null, awaitingReply: false });
  });
});

describe("sentence queue", () => {
  it("reads sentences one by one and falls back to the whole text without sentences", () => {
    let state = apply(sent(), { type: "reply", text: "x", sentences: SENTENCES });
    for (const sentence of SENTENCES) {
      expect(state.speakingText).toBe(sentence);
      state = apply(state, { type: "speech_ended", speechId: state.speechId });
    }
    expect(state.phase).toBe("listening");
    const whole = apply(sent(), { type: "reply", text: "한 덩어리 답" });
    expect(whole.speakingText).toBe("한 덩어리 답");
  });

  it("stops reading when the user sends text", () => {
    const reading = apply(sent(), { type: "reply", text: "x", sentences: SENTENCES });
    const typed = apply(reading, { type: "manual_send" });
    expect(typed).toMatchObject({ phase: "sending", speechQueue: [], speakingKind: null });
    expect(typed.speechId).toBe(reading.speechId + 1);
  });
});

describe("barge-in", () => {
  it("stops the reply and listens again when the user talks over it", () => {
    const reading = apply(sent(), { type: "reply", text: "x", sentences: SENTENCES });
    const cut = apply(reading, { type: "barge_in", speechId: reading.speechId });
    expect(cut).toMatchObject({ phase: "listening", speechQueue: [], speakingKind: null });
    expect(cut.speechId).toBe(reading.speechId + 1);
    expect(apply(cut, { type: "speech_ended", speechId: reading.speechId })).toBe(cut);
  });

  it("only stops the ack while the request is still running, and keeps that reply silent", () => {
    const cut = apply(acking(), { type: "barge_in", speechId: acking().speechId });
    expect(cut).toMatchObject({ phase: "sending", silentReply: true, notice: WAIT_NOTICE });
    const answered = apply(cut, { type: "reply", text: "x", sentences: SENTENCES });
    expect(answered.phase).toBe("listening");
    expect(answered.notice).toBe(WAIT_NOTICE);
    expect(said(answered, "다시 말해요").notice).toBeNull();
  });

  it("ignores stale signals and signals while the mic is off", () => {
    const reading = apply(sent(), { type: "reply", text: "x", sentences: SENTENCES });
    expect(apply(reading, { type: "barge_in", speechId: reading.speechId - 1 })).toBe(reading);
    const micOff = apply(reading, { type: "mic", enabled: false });
    expect(apply(micOff, { type: "barge_in", speechId: micOff.speechId })).toBe(micOff);
    const idle = ready();
    expect(apply(idle, { type: "barge_in", speechId: idle.speechId })).toBe(idle);
  });
});

describe("recovery", () => {
  it("stops waiting when the request ended without a matching reply", () => {
    const waiting = sent();
    expect(apply(waiting, { type: "reply_missing" })).toMatchObject({
      phase: "listening",
      awaitingReply: false,
    });
    let state = apply(acking(), { type: "reply_missing" });
    expect(state).toMatchObject({ phase: "speaking", awaitingReply: false });
    state = apply(state, { type: "speech_ended", speechId: state.speechId });
    expect(state.phase).toBe("listening");
    const quiet = ready();
    expect(apply(quiet, { type: "reply_missing" })).toBe(quiet);
  });

  it("restarts recognition once for the current listening session only", () => {
    const state = ready();
    const retried = apply(state, { type: "recognition_retry", recognitionId: state.recognitionId });
    expect(retried.recognitionId).toBe(state.recognitionId + 1);
    expect(apply(retried, { type: "recognition_retry", recognitionId: state.recognitionId })).toBe(
      retried,
    );
    const waiting = sent();
    expect(
      apply(waiting, { type: "recognition_retry", recognitionId: waiting.recognitionId }),
    ).toBe(waiting);
  });
});
