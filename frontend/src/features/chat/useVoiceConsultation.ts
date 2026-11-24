import { useCallback, useEffect, useRef, useState } from "react";
import type { QuickReplyIn } from "../../api/client";
import { createBrowserSpeech, type SpeechAdapter } from "./browserSpeech";
import type { ChatState } from "./chatState";
import { endpointDelay, type EndpointPolicy } from "./endpointPolicy";
import { createMicActivityDetector, type ActivityDetector } from "./micActivity";
import { speakable, splitSentences } from "./sentenceSplitter";
import { TurnTimer, type TurnMark } from "./turnTiming";
import {
  createVoiceReducer,
  findVoiceReply,
  initialVoiceState,
  isListening,
  type VoiceAction,
  type VoiceReplyBoundary,
} from "./voiceState";

/** 실험 화면과 시험에서 바꿔 끼우는 부품. 없으면 브라우저 기본값을 씁니다. */
export interface VoiceEngineOptions {
  speech?: SpeechAdapter;
  detector?: ActivityDetector;
  /** 끼어들기. 자기 목소리 오인 비율을 재기 전까지 기본은 끔입니다. */
  bargeIn?: boolean;
  timer?: TurnTimer;
  policy?: EndpointPolicy;
  /** 말 끝 판정 뒤 답이 이만큼 안 오면 즉시 반응을 읽습니다. null 이면 끕니다. */
  ackDelayMs?: number | null;
}

interface Options {
  chat: ChatState;
  onSend: (text: string, quickReply: QuickReplyIn | null) => void | Promise<void>;
  disabled: boolean;
  engine?: VoiceEngineOptions;
}

type ActiveTurn = VoiceReplyBoundary & { turnId: number };

/** 즉시 반응. 짧게(1초 안쪽) 두고 대화 기록에는 남기지 않습니다. */
export const ACKS = ["네, 잠시만요.", "네, 확인할게요.", "네, 알겠어요.", "좋아요, 잠시만요."];
export const ACK_DELAY_MS = 350;
/** 끼어든 직후 브라우저가 인식을 끊으면(aborted) 이 안에서 한 번만 다시 켭니다. */
const RETRY_WINDOW_MS = 2000;

const noop = () => {};

export function useVoiceConsultation({ chat, onSend, disabled, engine }: Options) {
  const [adapter] = useState<SpeechAdapter>(() => engine?.speech ?? createBrowserSpeech());
  const [detector] = useState<ActivityDetector>(
    () => engine?.detector ?? createMicActivityDetector(),
  );
  const [timer] = useState(() => engine?.timer ?? new TurnTimer());
  const [reducer] = useState(() => createVoiceReducer(engine?.policy ?? endpointDelay));
  const bargeIn = engine?.bargeIn ?? false;
  const ackDelayOption = engine?.ackDelayMs;
  const [state, setState] = useState(() => initialVoiceState());
  const [bargeInError, setBargeInError] = useState<string | null>(null);
  // Synchronous transitions invalidate old browser callbacks before React commits.
  const current = useRef(state);
  const mounted = useRef(true);
  const stopRecognition = useRef<() => void>(noop);
  const stopSpeech = useRef<() => void>(noop);
  const lastSent = useRef(0);
  const activeTurn = useRef<ActiveTurn | null>(null);
  const [completionRevision, setCompletionRevision] = useState(0);
  const seen = useRef(
    new Set(chat.messages.map((message) => `${message.session_id}:${message.id}`)),
  );
  /** 아직 보내지 않은 말의 시작·끝 시각. 보낼 때 시간 기록으로 옮깁니다. */
  const draft = useRef<{ start?: number; end?: number }>({});
  const utteranceStartedAt = useRef<number | null>(null);
  const lastContentEnd = useRef<{ turn: number; at: number } | null>(null);
  const bargedInAt = useRef(0);
  const retried = useRef(false);

  const dispatch = useCallback(
    (action: VoiceAction) => {
      if (!mounted.current) return;
      const next = reducer(current.current, action);
      if (next !== current.current) {
        current.current = next;
        setState(next);
      }
    },
    [reducer],
  );

  const transmit = useCallback(
    (text: string, quickReply: QuickReplyIn | null, turnId: number) => {
      const turn: ActiveTurn = {
        afterId: chat.messages.reduce((id, message) => Math.max(id, message.id), 0),
        text,
        sawPending: false,
        completed: false,
        turnId,
      };
      activeTurn.current = turn;
      stopRecognition.current();
      stopSpeech.current();
      timer.mark(turnId, "requestSent", Date.now());
      const failed = () => {
        if (activeTurn.current !== turn) return;
        activeTurn.current = null;
        dispatch({
          type: "failed",
          source: "send",
          error: "메시지를 보내지 못했습니다. 연결을 확인하고 글로 다시 보내 주세요.",
        });
      };
      try {
        void Promise.resolve(onSend(text, quickReply))
          .then(() => {
            if (!mounted.current || activeTurn.current !== turn) return;
            turn.completed = true;
            // Also observe a fast response whose pending state React batched away.
            setCompletionRevision((revision) => revision + 1);
          })
          .catch(failed);
      } catch {
        failed();
      }
    },
    [chat.messages, dispatch, onSend, timer],
  );

  useEffect(() => {
    mounted.current = true;
    // 새로고침 전에 남은 읽기 큐가 있으면 비웁니다.
    adapter.reset?.();
    return () => {
      mounted.current = false;
      stopRecognition.current();
      stopSpeech.current();
    };
  }, [adapter]);

  useEffect(() => {
    if (!disabled) return;
    activeTurn.current = null;
    stopRecognition.current();
    stopSpeech.current();
    dispatch({ type: "disabled" });
  }, [disabled, dispatch]);

  const listening = isListening(state) && !disabled && chat.pending === null;
  useEffect(() => {
    if (!listening) return;
    const recognitionId = state.recognitionId;
    stopSpeech.current();
    const stop = adapter.listen({
      result: (finalText, interimText) => {
        const now = Date.now();
        if (finalText || interimText) {
          draft.current.start ??= now;
          draft.current.end = now;
        }
        dispatch({ type: "result", recognitionId, finalText, interimText, now });
      },
      activity: (speaking) => {
        const now = Date.now();
        if (speaking) draft.current.start ??= now;
        else if (draft.current.start !== undefined) draft.current.end = now;
        dispatch({ type: "activity", recognitionId, speaking, now });
      },
      ended: () => dispatch({ type: "recognition_ended", recognitionId, now: Date.now() }),
      failed: (error) => {
        if (current.current.recognitionId === recognitionId && isListening(current.current)) {
          dispatch({ type: "failed", source: "recognition", error });
        }
      },
      interrupted: () => {
        if (current.current.recognitionId !== recognitionId || !isListening(current.current))
          return;
        // 끼어든 직후 다시 켠 인식이 끊긴 경우만 한 번 더 켭니다. 그 밖에는 예전처럼 실패로 알립니다.
        if (!retried.current && Date.now() - bargedInAt.current < RETRY_WINDOW_MS) {
          retried.current = true;
          dispatch({ type: "recognition_retry", recognitionId });
          return;
        }
        dispatch({
          type: "failed",
          source: "recognition",
          error: "음성 인식이 중단되었습니다. 마이크를 다시 켜거나 글로 입력해 주세요.",
        });
      },
    });
    stopRecognition.current = stop;
    return () => {
      stop();
      stopRecognition.current = noop;
    };
  }, [adapter, dispatch, listening, state.recognitionId]);

  useEffect(() => {
    if (!listening || state.silenceAt === null) return;
    const deadline = state.silenceAt;
    const recognitionId = state.recognitionId;
    const timeout = setTimeout(
      () => {
        dispatch({ type: "silence", recognitionId, deadline, now: Date.now() });
      },
      Math.max(0, deadline - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [dispatch, listening, state.recognitionId, state.silenceAt]);

  useEffect(() => {
    const request = state.request;
    if (!request || request.id <= lastSent.current || disabled) return;
    lastSent.current = request.id;
    const sent = state.sentEndpoint?.turnId === request.id ? state.sentEndpoint : null;
    const marks: Partial<Record<TurnMark, number>> = {};
    if (draft.current.start !== undefined) marks.speechStart = draft.current.start;
    if (draft.current.end !== undefined) marks.speechEnd = draft.current.end;
    if (sent) marks.endpoint = sent.at;
    timer.begin(
      request.id,
      "voice",
      marks,
      sent ? { rule: sent.rule, delayMs: sent.delayMs } : null,
    );
    draft.current = {};
    transmit(request.text, null, request.id);
  }, [disabled, transmit, state.request, state.sentEndpoint, timer]);

  // 즉시 반응: 음성으로 보낸 턴의 답이 늦으면 짧은 말을 먼저 읽습니다.
  const ackDelay =
    ackDelayOption !== undefined
      ? ackDelayOption
      : adapter.voiceLocality?.() === "remote"
        ? 0
        : ACK_DELAY_MS;
  useEffect(() => {
    if (state.phase !== "sending" || state.ackFor === null || !state.speechEnabled || disabled)
      return;
    if (ackDelay === null) return;
    const turnId = state.ackFor;
    const timeout = setTimeout(() => {
      dispatch({ type: "ack_due", turnId, text: ACKS[turnId % ACKS.length] });
    }, ackDelay);
    return () => clearTimeout(timeout);
  }, [ackDelay, disabled, dispatch, state.ackFor, state.phase, state.speechEnabled]);

  useEffect(() => {
    const fresh = chat.messages.filter(
      (message) => !seen.current.has(`${message.session_id}:${message.id}`),
    );
    if (disabled) {
      for (const message of fresh) seen.current.add(`${message.session_id}:${message.id}`);
      return;
    }
    if (chat.pending !== null) {
      if (activeTurn.current?.text === chat.pending) activeTurn.current.sawPending = true;
      if (!current.current.awaitingReply) {
        stopRecognition.current();
        stopSpeech.current();
        dispatch({ type: "manual_send" });
      }
      return;
    }
    for (const message of fresh) seen.current.add(`${message.session_id}:${message.id}`);
    const turn = activeTurn.current;
    if (
      chat.error &&
      current.current.awaitingReply &&
      turn &&
      (turn.sawPending || turn.completed)
    ) {
      activeTurn.current = null;
      dispatch({ type: "failed", source: "send", error: chat.error });
      return;
    }
    if (!current.current.awaitingReply) return;
    // Speak a reply only for the active user submission.
    if (turn) {
      const reply = findVoiceReply(chat.messages, turn, chat.pending);
      if (reply) {
        activeTurn.current = null;
        timer.mark(turn.turnId, "firstReply", Date.now());
        const sentences = splitSentences(reply.content).map(speakable).filter(Boolean);
        dispatch({ type: "reply", text: reply.content, sentences });
        return;
      }
      // 요청은 끝났는데 짝이 되는 답이 없으면(서버가 문장을 바꿨거나 보내지 못함) 기다림을 풉니다.
      if (turn.completed) {
        activeTurn.current = null;
        dispatch({ type: "reply_missing" });
      }
      return;
    }
    // 이 훅을 거치지 않고 보낸 요청이 끝났으면 기다림을 풉니다.
    dispatch({ type: "reply_missing" });
  }, [chat.error, chat.messages, chat.pending, completionRevision, disabled, dispatch, timer]);

  useEffect(() => {
    if (state.phase !== "speaking" || disabled) return;
    const speechId = state.speechId;
    const kind = state.speakingKind;
    const turn = state.speakingTurn;
    stopRecognition.current();
    const stop = adapter.speak(state.speakingText, {
      started: () => {
        const now = Date.now();
        utteranceStartedAt.current = now;
        if (turn === null) return;
        timer.mark(turn, "firstAudio", now);
        if (kind === "ack") timer.flag(turn, "ack");
        if (kind !== "content") return;
        timer.mark(turn, "firstContentAudio", now);
        const last = lastContentEnd.current;
        if (last?.turn === turn) timer.gap(turn, now - last.at);
      },
      ended: () => {
        utteranceStartedAt.current = null;
        if (kind === "content" && turn !== null) lastContentEnd.current = { turn, at: Date.now() };
        dispatch({ type: "speech_ended", speechId });
      },
      failed: (error) => {
        utteranceStartedAt.current = null;
        if (current.current.phase === "speaking" && current.current.speechId === speechId) {
          dispatch({ type: "failed", source: "synthesis", error });
        }
      },
    });
    stopSpeech.current = stop;
    return () => {
      stop();
      stopSpeech.current = noop;
    };
  }, [
    adapter,
    disabled,
    dispatch,
    state.phase,
    state.speakingKind,
    state.speakingText,
    state.speakingTurn,
    state.speechId,
    timer,
  ]);

  // 끼어들기: 읽는 중에 사람 소리가 잡히면 읽기를 멈추고 다시 듣습니다.
  useEffect(() => {
    if (!bargeIn || !state.micEnabled || disabled || !detector.supported) return;
    return detector.start(
      (speaking, at) => {
        const now = current.current;
        if (!speaking || now.phase !== "speaking") return;
        if (now.speakingTurn !== null) timer.flag(now.speakingTurn, "bargeIn");
        bargedInAt.current = at;
        retried.current = false;
        utteranceStartedAt.current = null;
        stopSpeech.current();
        dispatch({ type: "barge_in", speechId: now.speechId });
      },
      () => ({
        speaking: current.current.phase === "speaking",
        utteranceStartedAt: utteranceStartedAt.current,
      }),
      (reason) => {
        if (mounted.current) setBargeInError(reason);
      },
    );
  }, [bargeIn, detector, disabled, dispatch, state.micEnabled, timer]);

  function toggleMic() {
    if (disabled) return;
    if (!current.current.micEnabled && !adapter.recognitionSupported) {
      dispatch({
        type: "failed",
        source: "recognition",
        error: "이 브라우저는 음성 인식을 지원하지 않습니다. Chrome에서 열거나 글로 입력해 주세요.",
      });
      return;
    }
    if (current.current.micEnabled) stopRecognition.current();
    setBargeInError(null);
    draft.current = {};
    dispatch({ type: "mic", enabled: !current.current.micEnabled });
  }

  function toggleSpeech() {
    if (!current.current.speechEnabled && !adapter.synthesisSupported) {
      dispatch({
        type: "failed",
        source: "synthesis",
        error: "이 브라우저는 음성 읽기를 지원하지 않습니다. 화면의 답을 확인해 주세요.",
      });
      return;
    }
    if (current.current.speechEnabled) stopSpeech.current();
    dispatch({ type: "speech", enabled: !current.current.speechEnabled });
  }

  function stopReading() {
    stopSpeech.current();
    dispatch({ type: "stop_reading" });
  }

  function beforeTextSend() {
    stopRecognition.current();
    stopSpeech.current();
    draft.current = {};
    dispatch({ type: "manual_send" });
  }

  function sendText(text: string, quickReply: QuickReplyIn | null) {
    if (disabled || chat.pending !== null || !text.trim()) return;
    beforeTextSend();
    const turnId = current.current.turnId;
    timer.begin(turnId, "text");
    transmit(text, quickReply, turnId);
  }

  return {
    state,
    recognitionSupported: adapter.recognitionSupported,
    synthesisSupported: adapter.synthesisSupported,
    bargeIn: bargeIn && detector.supported && bargeInError === null,
    bargeInError,
    timer,
    toggleMic,
    toggleSpeech,
    stopReading,
    beforeTextSend,
    sendText,
  };
}
