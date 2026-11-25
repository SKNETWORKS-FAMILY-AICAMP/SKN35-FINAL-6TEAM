/** Browser-only boundary; no audio blobs, recorder, storage, or application API calls. */
import type { ReadingEntry } from "./speechText";

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  start(): void;
  abort(): void;
}

type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export interface RecognitionCallbacks {
  result: (finalText: string, interimText: string) => void;
  activity: (speaking: boolean) => void;
  ended: () => void;
  failed: (reason: string) => void;
  /** 있으면 브라우저가 인식을 스스로 끊은 경우(aborted)를 실패 대신 여기로 알립니다. 끼어든 직후 다시 켜는 데 씁니다. */
  interrupted?: () => void;
}

/** 어느 경로로 읽었는지. 시간 기록에만 씁니다. */
export interface SpeakInfo {
  path: "server" | "browser";
  /** 서버 음성 요청부터 재생 준비까지(ms). */
  fetchMs?: number;
  /** 서버 음성이 실패해 브라우저로 넘긴 경우. */
  fallback?: boolean;
}

export interface SpeakCallbacks {
  /** 소리가 나기 시작한 때. 첫 소리 시각을 잽니다. */
  started?: (info?: SpeakInfo) => void;
  ended: () => void;
  failed: (reason: string) => void;
}

/** 서버가 내려 주는 읽기 설정. */
export interface SpeechStatus {
  enabled: boolean;
  dictionary: ReadingEntry[];
}

export interface SpeechAdapter {
  recognitionSupported: boolean;
  synthesisSupported: boolean;
  listen(callbacks: RecognitionCallbacks): () => void;
  speak(text: string, callbacks: SpeakCallbacks): () => void;
  /** 고를 한국어 목소리가 기기 안 음성인지. 모르면 null. 원격 음성이면 즉시 반응을 기다리지 않고 바로 읽습니다. */
  voiceLocality?(): "local" | "remote" | null;
  /** 화면을 열 때 지난 페이지에서 남은 읽기 큐를 비웁니다. */
  reset?(): void;
  /** 곧 읽을 문장을 미리 받아 둡니다. keep 이면 cancelAll 에도 남깁니다(즉시 반응). */
  prepare?(text: string, options?: { keep?: boolean }): void;
  /** 미리 받은 것과 진행 중인 요청을 모두 버립니다. 그만 읽기·끼어들기·새 질문 때 부릅니다. */
  cancelAll?(): void;
  /** 사용자 동작(클릭·Enter) 안에서 불러 소리 재생을 허용받습니다. */
  unlock?(): void;
  /** 서버 읽기 설정과 상품 이름 사전을 불러옵니다. 없거나 실패하면 null. */
  load?(): Promise<SpeechStatus | null>;
}

/** 시작 신호가 이 안에 없으면 그 문장을 건너뜁니다. */
export const START_WATCHDOG_MS = 3000;
/** 끝 신호는 글자 수 × 이 값 + 여유까지 기다립니다. */
const MS_PER_CHAR = 200;
const END_SLACK_MS = 3000;

type KoreanVoice = { lang: string; localService?: boolean };

/** 기기 안 한국어 음성을 먼저 고릅니다. 원격 음성은 문장마다 합성 왕복이 붙습니다. */
function pickKorean<T extends KoreanVoice>(voices: readonly T[]): T | undefined {
  const korean = voices.filter((voice) => /^ko(?:[-_]|$)/i.test(voice.lang));
  return korean.find((voice) => voice.localService === true) ?? korean[0];
}

export function recognitionError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "마이크 또는 음성 인식 권한이 허용되지 않았습니다. 브라우저 사이트 설정에서 허용하거나 글로 입력해 주세요.";
    case "audio-capture":
      return "사용할 수 있는 마이크를 찾지 못했습니다. 마이크 연결을 확인하거나 글로 입력해 주세요.";
    case "network":
      return "브라우저 음성 인식 서비스에 연결하지 못했습니다. 인터넷 연결을 확인하거나 글로 입력해 주세요.";
    case "language-not-supported":
      return "이 브라우저에서 한국어 음성 인식을 지원하지 않습니다. 글로 입력해 주세요.";
    default:
      return "음성 인식이 중단되었습니다. 마이크를 다시 켜거나 글로 입력해 주세요.";
  }
}

export function createBrowserSpeech(): SpeechAdapter {
  const browser = typeof window === "undefined" ? undefined : (window as SpeechWindow);
  const Constructor = browser?.SpeechRecognition ?? browser?.webkitSpeechRecognition;
  const synthesis = browser?.speechSynthesis;
  const synthesisSupported = !!synthesis && typeof SpeechSynthesisUtterance !== "undefined";
  // Chrome 은 첫 getVoices 호출에서 목록을 불러오기 시작합니다. 첫 답 전에 미리 깨워 둡니다.
  if (synthesisSupported) synthesis?.getVoices();
  return {
    voiceLocality() {
      if (!synthesisSupported || !synthesis) return null;
      const voice = pickKorean(synthesis.getVoices());
      return voice ? (voice.localService ? "local" : "remote") : null;
    },
    reset() {
      if (synthesisSupported) synthesis?.cancel();
    },
    recognitionSupported: !!Constructor,
    synthesisSupported,
    listen(callbacks) {
      if (!Constructor) {
        callbacks.failed(
          "이 브라우저는 음성 인식을 지원하지 않습니다. Chrome에서 열거나 글로 입력해 주세요.",
        );
        return () => {};
      }
      const recognition = new Constructor();
      let stopped = false;
      recognition.lang = "ko-KR";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onresult = ({ results }) => {
        if (stopped) return;
        const confirmed: string[] = [];
        const interim: string[] = [];
        for (let index = 0; index < results.length; index++) {
          const result = results[index];
          (result.isFinal ? confirmed : interim).push(result[0].transcript);
        }
        callbacks.result(confirmed.join(" "), interim.join(" "));
      };
      recognition.onspeechstart = () => {
        if (!stopped) callbacks.activity(true);
      };
      recognition.onspeechend = () => {
        if (!stopped) callbacks.activity(false);
      };
      recognition.onerror = ({ error }) => {
        if (stopped || error === "no-speech") return;
        if (error === "aborted" && callbacks.interrupted) callbacks.interrupted();
        else callbacks.failed(recognitionError(error));
      };
      recognition.onend = () => {
        if (!stopped) callbacks.ended();
      };
      try {
        recognition.start();
      } catch {
        callbacks.failed(
          "마이크를 시작하지 못했습니다. 브라우저 권한을 확인하거나 글로 입력해 주세요.",
        );
      }
      return () => {
        stopped = true;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.onspeechstart = null;
        recognition.onspeechend = null;
        try {
          recognition.abort();
        } catch {
          /* Already ended. */
        }
      };
    },
    speak(text, callbacks) {
      if (!synthesisSupported || !synthesis) {
        callbacks.failed("이 브라우저는 음성 읽기를 지원하지 않습니다. 화면의 답을 확인해 주세요.");
        return () => {};
      }
      let stopped = false;
      let finished = false;
      let utterance: SpeechSynthesisUtterance | null = null;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const finish = (report: () => void) => {
        if (stopped || finished) return;
        finished = true;
        clearTimeout(watchdog);
        report();
      };
      // 시작이나 끝 신호가 오지 않으면 그 문장을 건너뜁니다. 읽기 상태에 갇혀 듣기가 다시 안 켜지는 일을 막습니다.
      const skip = () => {
        if (stopped || finished) return;
        synthesis.cancel();
        finish(callbacks.ended);
      };
      const speakKorean = () => {
        if (stopped || utterance) return;
        const korean = pickKorean(synthesis.getVoices());
        if (!korean) return;
        clearTimeout(waitTimer);
        synthesis.removeEventListener("voiceschanged", speakKorean);
        utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "ko-KR";
        utterance.voice = korean;
        utterance.onstart = () => {
          if (stopped || finished) return;
          clearTimeout(watchdog);
          watchdog = setTimeout(skip, [...text].length * MS_PER_CHAR + END_SLACK_MS);
          callbacks.started?.();
        };
        utterance.onend = () => finish(callbacks.ended);
        utterance.onerror = () =>
          finish(() =>
            callbacks.failed(
              "음성 답을 읽지 못했습니다. 화면의 답을 확인하고 음성 답을 다시 켜 주세요.",
            ),
          );
        try {
          synthesis.speak(utterance);
          watchdog = setTimeout(skip, START_WATCHDOG_MS);
        } catch {
          finish(() =>
            callbacks.failed("음성 읽기를 시작하지 못했습니다. 화면의 답을 확인해 주세요."),
          );
        }
      };
      synthesis.addEventListener("voiceschanged", speakKorean);
      const waitTimer = setTimeout(() => {
        if (!stopped && !utterance) {
          synthesis.removeEventListener("voiceschanged", speakKorean);
          callbacks.failed(
            "한국어 음성을 찾지 못했습니다. 기기의 한국어 음성을 설치하거나 화면의 답을 확인해 주세요.",
          );
        }
      }, 2000);
      speakKorean();
      return () => {
        const playing = utterance !== null && !finished;
        stopped = true;
        clearTimeout(waitTimer);
        clearTimeout(watchdog);
        synthesis.removeEventListener("voiceschanged", speakKorean);
        if (utterance) {
          utterance.onstart = null;
          utterance.onend = null;
          utterance.onerror = null;
          // 이미 끝난 문장은 다시 cancel 하지 않습니다. 다음 문장이 바로 이어 나올 때 끊기는 일을 막습니다.
          if (playing) synthesis.cancel();
        }
      };
    },
  };
}
