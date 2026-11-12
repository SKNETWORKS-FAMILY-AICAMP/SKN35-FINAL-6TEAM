import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserSpeech, recognitionError } from "./browserSpeech";

class FakeRecognition {
  static latest: FakeRecognition;
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult:
    ((event: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  start = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.latest = this;
  }
}

class FakeUtterance {
  lang = "";
  voice: { lang: string } | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

function callbacks() {
  return { result: vi.fn(), activity: vi.fn(), ended: vi.fn(), failed: vi.fn() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("browser speech adapter", () => {
  it("is safe without window and reports unsupported capabilities", () => {
    const adapter = createBrowserSpeech();
    expect(adapter.recognitionSupported).toBe(false);
    expect(adapter.synthesisSupported).toBe(false);
    const events = callbacks();
    adapter.listen(events);
    expect(events.failed).toHaveBeenCalledWith(expect.stringContaining("지원하지 않습니다"));
  });

  it("uses Korean continuous/interim recognition and forwards cumulative confirmed/interim text", () => {
    vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition });
    const events = callbacks();
    const stop = createBrowserSpeech().listen(events);
    const recognition = FakeRecognition.latest;
    expect(recognition.lang).toBe("ko-KR");
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    expect(recognition.start).toHaveBeenCalledOnce();
    recognition.onresult?.({
      results: [
        { isFinal: true, 0: { transcript: "노트북" } },
        { isFinal: true, 0: { transcript: "예산은" } },
        { isFinal: false, 0: { transcript: "300만" } },
      ],
    });
    expect(events.result).toHaveBeenCalledWith("노트북 예산은", "300만");
    const late = recognition.onresult;
    stop();
    late?.({ results: [{ isFinal: true, 0: { transcript: "늦은 콜백" } }] });
    expect(events.result).toHaveBeenCalledOnce();
    expect(recognition.abort).toHaveBeenCalledOnce();
  });

  it("shows permission failures and leaves ordinary silence to the restart handler", () => {
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });
    const events = callbacks();
    const stop = createBrowserSpeech().listen(events);
    FakeRecognition.latest.onerror?.({ error: "no-speech" });
    expect(events.failed).not.toHaveBeenCalled();
    FakeRecognition.latest.onend?.();
    expect(events.ended).toHaveBeenCalledOnce();
    FakeRecognition.latest.onerror?.({ error: "not-allowed" });
    expect(events.failed).toHaveBeenCalledWith(expect.stringContaining("권한"));
    const late = FakeRecognition.latest.onerror;
    stop();
    late?.({ error: "aborted" });
    expect(events.failed).toHaveBeenCalledOnce();
  });

  it.each([
    ["audio-capture", "마이크"],
    ["network", "연결"],
    ["language-not-supported", "한국어"],
    ["service-not-allowed", "권한"],
  ])("explains %s and offers text input", (code, reason) => {
    expect(recognitionError(code)).toContain(reason);
    expect(recognitionError(code)).toContain("글로 입력");
  });

  it("selects a Korean voice and cancels both output and late callbacks on cleanup", () => {
    vi.useFakeTimers();
    const synthesis = Object.assign(new EventTarget(), {
      getVoices: () => [{ lang: "en-US" }, { lang: "ko-KR" }],
      speak: vi.fn(),
      cancel: vi.fn(),
    });
    vi.stubGlobal("window", { speechSynthesis: synthesis });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const events = callbacks();
    const stop = createBrowserSpeech().speak("서버 답만 읽기", events);
    const utterance = synthesis.speak.mock.calls[0][0] as FakeUtterance;
    expect(utterance.text).toBe("서버 답만 읽기");
    expect(utterance.lang).toBe("ko-KR");
    expect(utterance.voice?.lang).toBe("ko-KR");
    const late = utterance.onend;
    stop();
    late?.();
    expect(synthesis.cancel).toHaveBeenCalledOnce();
    expect(events.ended).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for delayed voices and reports missing Korean audio instead of using another language", () => {
    vi.useFakeTimers();
    const voices: { lang: string }[] = [];
    const synthesis = Object.assign(new EventTarget(), {
      getVoices: () => voices,
      speak: vi.fn(),
      cancel: vi.fn(),
    });
    vi.stubGlobal("window", { speechSynthesis: synthesis });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const adapter = createBrowserSpeech();
    const delayed = callbacks();
    const stopDelayed = adapter.speak("답", delayed);
    expect(synthesis.speak).not.toHaveBeenCalled();
    voices.push({ lang: "ko-KR" });
    synthesis.dispatchEvent(new Event("voiceschanged"));
    expect(synthesis.speak).toHaveBeenCalledOnce();
    stopDelayed();
    voices.length = 0;
    const missing = callbacks();
    const stopMissing = adapter.speak("답", missing);
    vi.advanceTimersByTime(2000);
    expect(missing.failed).toHaveBeenCalledWith(expect.stringContaining("한국어 음성"));
    expect(synthesis.speak).toHaveBeenCalledOnce();
    stopMissing();
  });
});
