/** Browser-only boundary; no audio blobs, recorder, storage, or application API calls. */
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
}

export interface SpeechAdapter {
  recognitionSupported: boolean;
  synthesisSupported: boolean;
  listen(callbacks: RecognitionCallbacks): () => void;
  speak(
    text: string,
    callbacks: { ended: () => void; failed: (reason: string) => void },
  ): () => void;
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
  return {
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
        if (!stopped && error !== "no-speech") callbacks.failed(recognitionError(error));
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
      let utterance: SpeechSynthesisUtterance | null = null;
      const speakKorean = () => {
        if (stopped || utterance) return;
        const korean = synthesis.getVoices().find((voice) => /^ko(?:[-_]|$)/i.test(voice.lang));
        if (!korean) return;
        clearTimeout(waitTimer);
        synthesis.removeEventListener("voiceschanged", speakKorean);
        utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "ko-KR";
        utterance.voice = korean;
        utterance.onend = () => {
          if (!stopped) callbacks.ended();
        };
        utterance.onerror = () => {
          if (!stopped)
            callbacks.failed(
              "음성 답을 읽지 못했습니다. 화면의 답을 확인하고 음성 답을 다시 켜 주세요.",
            );
        };
        try {
          synthesis.speak(utterance);
        } catch {
          callbacks.failed("음성 읽기를 시작하지 못했습니다. 화면의 답을 확인해 주세요.");
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
        stopped = true;
        clearTimeout(waitTimer);
        synthesis.removeEventListener("voiceschanged", speakKorean);
        if (utterance) {
          utterance.onend = null;
          utterance.onerror = null;
          synthesis.cancel();
        }
      };
    },
  };
}
