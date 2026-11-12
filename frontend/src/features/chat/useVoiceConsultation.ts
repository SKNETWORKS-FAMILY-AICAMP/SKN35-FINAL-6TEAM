import { useCallback, useEffect, useRef, useState } from "react";
import type { QuickReplyIn } from "../../api/client";
import { createBrowserSpeech } from "./browserSpeech";
import type { ChatState } from "./chatState";
import {
  findVoiceReply,
  initialVoiceState,
  isListening,
  voiceReducer,
  type VoiceAction,
  type VoiceReplyBoundary,
} from "./voiceState";

interface Options {
  chat: ChatState;
  onSend: (text: string, quickReply: QuickReplyIn | null) => void | Promise<void>;
  disabled: boolean;
  mock: boolean;
}

const noop = () => {};

export function useVoiceConsultation({ chat, onSend, disabled, mock }: Options) {
  const [adapter] = useState(createBrowserSpeech);
  const [state, setState] = useState(() => initialVoiceState(mock));
  // Synchronous transitions invalidate old browser callbacks before React commits.
  const current = useRef(state);
  const mounted = useRef(true);
  const stopRecognition = useRef<() => void>(noop);
  const stopSpeech = useRef<() => void>(noop);
  const lastSent = useRef(0);
  const activeTurn = useRef<VoiceReplyBoundary | null>(null);
  const [completionRevision, setCompletionRevision] = useState(0);
  const seen = useRef(
    new Set(chat.messages.map((message) => `${message.session_id}:${message.id}`)),
  );

  const dispatch = useCallback((action: VoiceAction) => {
    if (!mounted.current) return;
    const next = voiceReducer(current.current, action);
    if (next !== current.current) {
      current.current = next;
      setState(next);
    }
  }, []);

  const transmit = useCallback(
    (text: string, quickReply: QuickReplyIn | null) => {
      const turn: VoiceReplyBoundary = {
        afterId: chat.messages.reduce((id, message) => Math.max(id, message.id), 0),
        text,
        sawPending: false,
        completed: false,
      };
      activeTurn.current = turn;
      stopRecognition.current();
      stopSpeech.current();
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
    [chat.messages, dispatch, onSend],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopRecognition.current();
      stopSpeech.current();
    };
  }, []);

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
      result: (finalText, interimText) =>
        dispatch({
          type: "result",
          recognitionId,
          finalText,
          interimText,
          now: Date.now(),
        }),
      activity: (speaking) =>
        dispatch({ type: "activity", recognitionId, speaking, now: Date.now() }),
      ended: () => dispatch({ type: "recognition_ended", recognitionId, now: Date.now() }),
      failed: (error) => {
        if (current.current.recognitionId === recognitionId && isListening(current.current)) {
          dispatch({ type: "failed", source: "recognition", error });
        }
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
    if (!request || request.id <= lastSent.current || disabled || mock) return;
    lastSent.current = request.id;
    transmit(request.text, null);
  }, [disabled, mock, transmit, state.request]);

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
    if (
      chat.error &&
      current.current.awaitingReply &&
      activeTurn.current &&
      (activeTurn.current.sawPending || activeTurn.current.completed)
    ) {
      activeTurn.current = null;
      dispatch({ type: "failed", source: "send", error: chat.error });
      return;
    }
    // Loaded history is never spoken. Mock lines are explicitly scripted new turns.
    if (mock) {
      const replies = fresh.filter((message) => message.role === "assistant");
      for (const reply of replies) dispatch({ type: "reply", text: reply.content });
    } else if (current.current.awaitingReply && activeTurn.current) {
      const reply = findVoiceReply(chat.messages, activeTurn.current, chat.pending);
      if (reply) {
        activeTurn.current = null;
        dispatch({ type: "reply", text: reply.content });
      }
    }
  }, [chat.error, chat.messages, chat.pending, completionRevision, disabled, dispatch, mock]);

  useEffect(() => {
    if (state.phase !== "speaking" || disabled) return;
    const speechId = state.speechId;
    stopRecognition.current();
    const stop = adapter.speak(state.speakingText, {
      ended: () => dispatch({ type: "speech_ended", speechId }),
      failed: (error) => {
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
  }, [adapter, disabled, dispatch, state.phase, state.speakingText, state.speechId]);

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
    dispatch({ type: "manual_send" });
  }

  function sendText(text: string, quickReply: QuickReplyIn | null) {
    if (disabled || mock || chat.pending !== null || !text.trim()) return;
    beforeTextSend();
    transmit(text, quickReply);
  }

  return {
    state,
    recognitionSupported: adapter.recognitionSupported,
    synthesisSupported: adapter.synthesisSupported,
    toggleMic,
    toggleSpeech,
    stopReading,
    beforeTextSend,
    sendText,
  };
}
