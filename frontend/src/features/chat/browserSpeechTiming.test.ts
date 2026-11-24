/** 문장 단위 읽기를 위한 어댑터 동작. 기본 동작은 browserSpeech.test.ts 가 지킵니다. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { START_WATCHDOG_MS, createBrowserSpeech } from "./browserSpeech";

class FakeUtterance {
  lang = "";
  voice: { lang: string; localService?: boolean } | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

class FakeRecognition {
  static latest: FakeRecognition;
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: unknown = null;
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

function synthesisWith(voices: { lang: string; localService?: boolean }[]) {
  return Object.assign(new EventTarget(), {
    getVoices: vi.fn(() => voices),
    speak: vi.fn(),
    cancel: vi.fn(),
  });
}

function install(synthesis: ReturnType<typeof synthesisWith>) {
  vi.stubGlobal("window", { speechSynthesis: synthesis });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
}

const events = () => ({ started: vi.fn(), ended: vi.fn(), failed: vi.fn() });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("sentence speaking", () => {
  it("reports the moment sound starts and does not cancel a sentence that already ended", () => {
    vi.useFakeTimers();
    const synthesis = synthesisWith([{ lang: "ko-KR", localService: true }]);
    install(synthesis);
    const callbacks = events();
    const stop = createBrowserSpeech().speak("첫 문장이에요.", callbacks);
    const utterance = synthesis.speak.mock.calls[0][0] as FakeUtterance;
    utterance.onstart?.();
    expect(callbacks.started).toHaveBeenCalledOnce();
    utterance.onend?.();
    expect(callbacks.ended).toHaveBeenCalledOnce();
    stop();
    expect(synthesis.cancel).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("prefers an on-device Korean voice and reports where the voice runs", () => {
    const remote = { lang: "ko-KR", localService: false };
    const local = { lang: "ko_KR", localService: true };
    const synthesis = synthesisWith([{ lang: "en-US", localService: true }, remote, local]);
    install(synthesis);
    const adapter = createBrowserSpeech();
    expect(adapter.voiceLocality?.()).toBe("local");
    adapter.speak("문장", events());
    expect((synthesis.speak.mock.calls[0][0] as FakeUtterance).voice).toBe(local);

    const onlyRemote = synthesisWith([remote]);
    install(onlyRemote);
    expect(createBrowserSpeech().voiceLocality?.()).toBe("remote");
  });

  it("skips a sentence whose start or end never arrives so speaking cannot get stuck", () => {
    vi.useFakeTimers();
    const synthesis = synthesisWith([{ lang: "ko-KR", localService: true }]);
    install(synthesis);
    const adapter = createBrowserSpeech();

    const silent = events();
    adapter.speak("시작 신호가 안 오는 문장", silent);
    vi.advanceTimersByTime(START_WATCHDOG_MS);
    expect(silent.ended).toHaveBeenCalledOnce();
    expect(synthesis.cancel).toHaveBeenCalledOnce();

    const endless = events();
    adapter.speak("끝 신호가 안 오는 문장", endless);
    (synthesis.speak.mock.calls[1][0] as FakeUtterance).onstart?.();
    vi.advanceTimersByTime([..."끝 신호가 안 오는 문장"].length * 200 + 2999);
    expect(endless.ended).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(endless.ended).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the leftover queue on reset and wakes the voice list early", () => {
    const synthesis = synthesisWith([{ lang: "ko-KR" }]);
    install(synthesis);
    const adapter = createBrowserSpeech();
    expect(synthesis.getVoices).toHaveBeenCalled();
    adapter.reset?.();
    expect(synthesis.cancel).toHaveBeenCalledOnce();
  });
});

describe("recognition interruption", () => {
  it("hands a browser abort to the interrupted callback when one is given", () => {
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });
    const callbacks = {
      result: vi.fn(),
      activity: vi.fn(),
      ended: vi.fn(),
      failed: vi.fn(),
      interrupted: vi.fn(),
    };
    createBrowserSpeech().listen(callbacks);
    FakeRecognition.latest.onerror?.({ error: "aborted" });
    expect(callbacks.interrupted).toHaveBeenCalledOnce();
    expect(callbacks.failed).not.toHaveBeenCalled();
    FakeRecognition.latest.onerror?.({ error: "network" });
    expect(callbacks.failed).toHaveBeenCalledWith(expect.stringContaining("연결"));
  });
});
