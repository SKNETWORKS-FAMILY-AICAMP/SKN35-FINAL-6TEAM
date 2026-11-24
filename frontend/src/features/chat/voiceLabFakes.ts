/**
 * 음성 실험 화면(?voice-lab)용 가짜 부품. 개발 서버에서만 불러옵니다.
 * 가짜 대화 api 는 실제 useChat 에 들어가 실제 대기(pending) 경로를 탑니다.
 * 가짜 받아쓰기·읽기·감지기는 Playwright 가 window.__voiceLab 으로 움직입니다.
 */
import type { ChatMessage } from "../../api/client";
import type { RecognitionCallbacks, SpeakCallbacks, SpeechAdapter } from "./browserSpeech";
import type { ActivityDetector } from "./micActivity";
import type { ChatApi } from "./useChat";

const SESSION = "voice-lab";

/** 실험용 문장. 실제 상품 정보가 아닙니다. */
export const LAB_REPLIES = {
  short: "실험용 답입니다. 지금 조합이면 게임과 로컬 모델 실습 둘 다 무리 없어요.",
  long: [
    "실험용 답입니다. 지금 조합이면 게임과 로컬 모델 실습 둘 다 무리 없어요.",
    "그래픽카드 메모리가 16GB 라서 7B 모델 실습까지는 여유가 있어요.",
    "파워는 850W 라 권장 정격보다 넉넉해요.",
    "다만 가격은 테스트 가격이라 구매 전에 판매가를 확인해 주세요.",
  ].join(" "),
} as const;

export type LabReplyLength = keyof typeof LAB_REPLIES;

export interface LabSettings {
  latencyMs: number;
  length: LabReplyLength;
}

export function createLabApi(settings: () => LabSettings): ChatApi {
  const history: ChatMessage[] = [];
  const message = (role: ChatMessage["role"], content: string): ChatMessage => ({
    id: history.length + 1,
    session_id: SESSION,
    role,
    content,
    created_at: new Date().toISOString(),
    quick_replies: [],
    nlu: null,
  });
  return {
    async messages() {
      return [...history];
    },
    async send(text: string) {
      const { latencyMs, length } = settings();
      history.push(message("user", text));
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
      history.push(message("assistant", LAB_REPLIES[length]));
      return [...history];
    },
  };
}

export interface SpokenEntry {
  text: string;
  startedAt: number;
  endedAt: number | null;
  cancelled: boolean;
}

/** 글자당 읽는 시간. 실제보다 빠르게 잡아 시험을 짧게 합니다. */
const FAKE_MS_PER_CHAR = 25;
const FAKE_START_MS = 20;

export interface FakeSpeech extends SpeechAdapter {
  /** 사용자가 이 말을 하고 멈춘 것처럼 확정 결과와 말 끝 신호를 보냅니다. */
  say(text: string): boolean;
  /** 지금 소리가 나는 문장이 있는지. */
  speaking(): boolean;
  spoken: SpokenEntry[];
}

export function createFakeSpeech(onChange: () => void): FakeSpeech {
  let listener: RecognitionCallbacks | null = null;
  const spoken: SpokenEntry[] = [];
  return {
    recognitionSupported: true,
    synthesisSupported: true,
    spoken,
    speaking: () => spoken.some((entry) => entry.endedAt === null),
    voiceLocality: () => "local",
    reset() {},
    listen(callbacks) {
      listener = callbacks;
      return () => {
        if (listener === callbacks) listener = null;
      };
    },
    say(text) {
      const current = listener;
      if (!current) return false;
      current.activity(true);
      current.result(text, "");
      current.activity(false);
      return true;
    },
    speak(text: string, callbacks: SpeakCallbacks) {
      let entry: SpokenEntry | null = null;
      let endTimer: ReturnType<typeof setTimeout> | undefined;
      const startTimer = setTimeout(() => {
        entry = { text, startedAt: Date.now(), endedAt: null, cancelled: false };
        spoken.push(entry);
        onChange();
        callbacks.started?.();
        endTimer = setTimeout(
          () => {
            if (!entry) return;
            entry.endedAt = Date.now();
            onChange();
            callbacks.ended();
          },
          [...text].length * FAKE_MS_PER_CHAR,
        );
      }, FAKE_START_MS);
      return () => {
        clearTimeout(startTimer);
        clearTimeout(endTimer);
        if (entry && entry.endedAt === null) {
          entry.cancelled = true;
          entry.endedAt = Date.now();
          onChange();
        }
      };
    },
  };
}

export interface FakeDetector extends ActivityDetector {
  /** 사용자가 끼어들어 말한 것처럼 감지 신호를 보냅니다. */
  userSpeaks(): boolean;
}

export function createFakeDetector(): FakeDetector {
  let listener: ((speaking: boolean, at: number) => void) | null = null;
  return {
    supported: true,
    start(onActivity) {
      listener = onActivity;
      return () => {
        if (listener === onActivity) listener = null;
      };
    },
    userSpeaks() {
      if (!listener) return false;
      const at = Date.now();
      listener(true, at);
      listener(false, at + 300);
      return true;
    },
  };
}
