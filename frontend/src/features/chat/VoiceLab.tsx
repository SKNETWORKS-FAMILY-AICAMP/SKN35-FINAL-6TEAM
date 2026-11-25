/**
 * 음성 엔진 실험 화면(개발 서버 전용, ?voice-lab). 백엔드 없이 말 끝 판정 · 즉시 반응 · 문장 단위 읽기 · 끼어들기를 돌려 봅니다.
 * ?voice-lab              진짜 마이크와 브라우저 받아쓰기·읽기, 가짜 대화 서버
 * ?voice-lab&fake-speech  받아쓰기·읽기·감지기까지 가짜(자동 시험용, window.__voiceLab)
 * &tts=server              읽기는 서버 음성 경로(/api/pc-consult/sessions/voice-lab/speech)와 실제 오디오로, 실패하면 위 읽기로
 */
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { SelectionMap, Survey } from "../pc-consult/types";
import { createBrowserSpeech } from "./browserSpeech";
import { ChatPanel } from "./ChatPanel";
import { createServerSpeech } from "./serverSpeech";
import { TurnTimer, type TurnRecord } from "./turnTiming";
import { useChat } from "./useChat";
import type { VoiceEngineOptions } from "./useVoiceConsultation";
import {
  createFakeDetector,
  createFakeSpeech,
  createLabApi,
  type LabReplyLength,
  type LabSettings,
} from "./voiceLabFakes";

const FAKE = new URLSearchParams(window.location.search).has("fake-speech");
const SERVER_TTS = new URLSearchParams(window.location.search).get("tts") === "server";
export const LAB_SPEECH_ENDPOINT = "/api/pc-consult/sessions/voice-lab/speech";
const LATENCIES = [200, 1000, 2000, 4000];

declare global {
  interface Window {
    __voiceLab?: {
      say: (text: string) => boolean;
      userSpeaks: () => boolean;
      speaking: () => boolean;
      setLatency: (ms: number) => void;
      setLength: (length: LabReplyLength) => void;
      /** 턴마다 서버·브라우저로 읽은 문장 수. */
      readings: () => TurnRecord["reading"][];
    };
  }
}

export default function VoiceLab() {
  const [settings, setSettings] = useState<LabSettings>({ latencyMs: 2000, length: "long" });
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const [api] = useState(() => createLabApi(() => settingsRef.current));
  const context = useRef<{ survey: Survey | null; selected: SelectionMap }>({
    survey: null,
    selected: {},
  });
  const { chat, sendChat } = useChat(api, context);
  const [fakes] = useState(() =>
    FAKE ? { speech: createFakeSpeech(refresh), detector: createFakeDetector() } : null,
  );
  const engine = useMemo<VoiceEngineOptions>(() => {
    const reading = fakes?.speech ?? createBrowserSpeech();
    const speech = SERVER_TTS
      ? createServerSpeech({ endpoint: LAB_SPEECH_ENDPOINT, fallback: reading })
      : fakes?.speech;
    return {
      bargeIn: true,
      timer: new TurnTimer(),
      ...(speech ? { speech } : {}),
      ...(fakes ? { detector: fakes.detector } : {}),
    };
  }, [fakes]);

  useEffect(() => {
    if (!fakes) return;
    window.__voiceLab = {
      say: (text) => fakes.speech.say(text),
      userSpeaks: () => fakes.detector.userSpeaks(),
      speaking: () => fakes.speech.speaking(),
      setLatency: (latencyMs) => setSettings((current) => ({ ...current, latencyMs })),
      setLength: (length) => setSettings((current) => ({ ...current, length })),
      readings: () => engine.timer?.snapshot().map((record) => record.reading) ?? [],
    };
    return () => {
      delete window.__voiceLab;
    };
  }, [engine, fakes]);

  return (
    <main className="voice-lab">
      <header className="voice-lab-head">
        <h1>음성 엔진 실험실</h1>
        <p>
          개발 서버 전용 화면입니다. 대화 서버는 가짜이고 답은 실험용 문장입니다.
          {FAKE ? " 받아쓰기와 읽기도 가짜입니다." : " 마이크와 읽기는 이 브라우저 것을 씁니다."}
          {SERVER_TTS && " 읽기는 서버 음성 경로를 먼저 씁니다."}
        </p>
        <div className="voice-lab-controls">
          <label>
            답 지연
            <select
              value={settings.latencyMs}
              onChange={(event) =>
                setSettings((current) => ({ ...current, latencyMs: Number(event.target.value) }))
              }
            >
              {LATENCIES.map((ms) => (
                <option key={ms} value={ms}>
                  {ms}ms
                </option>
              ))}
            </select>
          </label>
          <label>
            답 길이
            <select
              value={settings.length}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  length: event.target.value as LabReplyLength,
                }))
              }
            >
              <option value="short">한 문장</option>
              <option value="long">네 문장</option>
            </select>
          </label>
        </div>
      </header>
      <ChatPanel
        state={chat}
        disabled={false}
        onSend={(text) => void sendChat(text)}
        voiceEngine={engine}
        showTimings
      />
      {fakes && (
        <ol className="voice-lab-spoken" data-testid="voice-lab-spoken">
          {fakes.speech.spoken.map((entry, index) => (
            <li
              key={index}
              data-cancelled={entry.cancelled || undefined}
              data-ended={entry.endedAt !== null || undefined}
            >
              {entry.text}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
