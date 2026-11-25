import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeakCallbacks, SpeakInfo, SpeechAdapter } from "./browserSpeech";
import {
  CIRCUIT_OPEN_MS,
  END_SLACK_MS,
  REQUEST_TIMEOUT_MS,
  STALL_MS,
  createServerSpeech,
  type AudioContextLike,
  type AudioSourceLike,
} from "./serverSpeech";

class FakeSource implements AudioSourceLike {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect() {
    return undefined;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeContext implements AudioContextLike {
  state = "running";
  currentTime = 0;
  destination = {};
  resumes = 0;
  canResume = true;
  sources: FakeSource[] = [];
  resume() {
    this.resumes += 1;
    if (this.canResume) this.state = "running";
    return Promise.resolve();
  }
  decodeAudioData(data: ArrayBuffer) {
    return Promise.resolve({ duration: data.byteLength / 1000 });
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

interface Call {
  text: string | null;
  signal: AbortSignal | undefined;
  respond: (status: number, bytes?: number, headers?: Record<string, string>) => void;
}

function fakeFetch(status: { enabled: boolean } = { enabled: true }) {
  const calls: Call[] = [];
  const fn = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    if (!init?.method) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ ...status, dictionary: [{ text: "RTX", spoken: "알티엑스" }] }),
          {
            status: 200,
          },
        ),
      );
    }
    return new Promise<Response>((resolve, reject) => {
      const signal = init.signal ?? undefined;
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      calls.push({
        text: JSON.parse(String(init.body)).text,
        signal,
        respond: (code, bytes = 1000, headers = {}) =>
          resolve(
            new Response(code === 200 ? new Uint8Array(bytes) : "실패", { status: code, headers }),
          ),
      });
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

function fakeBrowser() {
  const spoken: { text: string; callbacks: SpeakCallbacks; stopped: boolean }[] = [];
  const adapter: SpeechAdapter = {
    recognitionSupported: true,
    synthesisSupported: true,
    listen: () => () => {},
    speak(text, callbacks) {
      const item = { text, callbacks, stopped: false };
      spoken.push(item);
      return () => {
        item.stopped = true;
      };
    },
    voiceLocality: () => "remote",
  };
  return { adapter, spoken };
}

function events() {
  const log: string[] = [];
  const infos: (SpeakInfo | undefined)[] = [];
  const callbacks: SpeakCallbacks = {
    started: (info) => {
      infos.push(info);
      log.push(`started:${info?.path ?? "?"}${info?.fallback ? ":fallback" : ""}`);
    },
    ended: () => log.push("ended"),
    failed: (reason) => log.push(`failed:${reason}`),
  };
  return { log, infos, callbacks };
}

async function setup(options: { enabled?: boolean; forceBrowser?: boolean } = {}) {
  const context = new FakeContext();
  const network = fakeFetch({ enabled: options.enabled ?? true });
  const browser = fakeBrowser();
  let clock = 0;
  const speech = createServerSpeech({
    endpoint: "/api/pc-consult/sessions/s1/speech",
    fallback: browser.adapter,
    fetch: network.fn,
    createContext: () => context,
    now: () => clock,
    forceBrowser: options.forceBrowser,
  });
  const status = await speech.load?.();
  const advance = async (ms: number) => {
    clock += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };
  return { speech, context, network, browser, status, advance };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createServerSpeech", () => {
  it("loads the dictionary and plays the server voice once, start before end", async () => {
    const { speech, context, network, status } = await setup();
    expect(status).toEqual({ enabled: true, dictionary: [{ text: "RTX", spoken: "알티엑스" }] });
    expect(speech.voiceLocality?.()).toBe("local");
    const { log, infos, callbacks } = events();
    speech.speak("첫 문장이에요.", callbacks);
    expect(network.calls.map((call) => call.text)).toEqual(["첫 문장이에요."]);
    network.calls[0].respond(200);
    await flush();
    expect(log).toEqual(["started:server"]);
    expect(infos[0]?.fetchMs).toBeGreaterThanOrEqual(0);
    context.currentTime = 1;
    context.sources[0].onended?.();
    context.sources[0].onended?.();
    expect(log).toEqual(["started:server", "ended"]);
  });

  it("keeps prepared sentences when a finished sentence is stopped", async () => {
    const { speech, context, network } = await setup();
    speech.prepare?.("둘째 문장");
    const first = events();
    const stopFirst = speech.speak("첫 문장", first.callbacks);
    network.calls[1].respond(200);
    network.calls[0].respond(200);
    await flush();
    context.sources[0].onended?.();
    stopFirst(); // 훅은 문장이 바뀔 때마다 cleanup 으로 부릅니다.
    const second = events();
    speech.speak("둘째 문장", second.callbacks);
    await flush();
    expect(network.calls).toHaveLength(2);
    expect(second.log).toEqual(["started:server"]);
  });

  it("shares one request between prepare and speak, and between repeated prepares", async () => {
    const { speech, network } = await setup();
    speech.prepare?.("같은 문장");
    speech.prepare?.("같은 문장");
    speech.speak("같은 문장", events().callbacks);
    expect(network.calls).toHaveLength(1);
  });

  it("cancelAll aborts prepared sentences but keeps acks", async () => {
    const { speech, network } = await setup();
    speech.prepare?.("네, 잠시만요.", { keep: true });
    speech.prepare?.("다음 문장");
    speech.cancelAll?.();
    expect(network.calls[0].signal?.aborted).toBe(false);
    expect(network.calls[1].signal?.aborted).toBe(true);
    speech.speak("네, 잠시만요.", events().callbacks);
    speech.speak("다음 문장", events().callbacks);
    expect(network.calls.map((call) => call.text)).toEqual([
      "네, 잠시만요.",
      "다음 문장",
      "다음 문장",
    ]);
  });

  it("stop during playback silences the source and does not report end", async () => {
    const { speech, context, network } = await setup();
    const { log, callbacks } = events();
    const stop = speech.speak("문장", callbacks);
    network.calls[0].respond(200);
    await flush();
    stop();
    expect(context.sources[0].stopped).toBe(true);
    context.sources[0].onended?.();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(log).toEqual(["started:server"]);
  });

  it("falls back to the browser voice when audio cannot resume", async () => {
    const { speech, context, network, browser } = await setup();
    context.state = "suspended";
    context.canResume = false;
    const { log, callbacks } = events();
    speech.speak("문장", callbacks);
    network.calls[0].respond(200);
    await vi.advanceTimersByTimeAsync(300);
    expect(context.resumes).toBe(1);
    expect(context.sources).toHaveLength(0);
    expect(browser.spoken.map((item) => item.text)).toEqual(["문장"]);
    browser.spoken[0].callbacks.started?.();
    browser.spoken[0].callbacks.ended();
    expect(log).toEqual(["started:browser:fallback", "ended"]);
  });

  it("hands over to the browser when the audio clock does not move", async () => {
    const { speech, context, network, browser } = await setup();
    speech.speak("문장", events().callbacks);
    network.calls[0].respond(200);
    await flush();
    await vi.advanceTimersByTimeAsync(STALL_MS);
    expect(context.sources[0].stopped).toBe(true);
    expect(browser.spoken).toHaveLength(1);
  });

  it("ends by watchdog when the source never reports the end", async () => {
    const { speech, context, network } = await setup();
    const { log, callbacks } = events();
    speech.speak("문장", callbacks);
    network.calls[0].respond(200, 2000); // 2초 음성
    await flush();
    context.currentTime = 0.5;
    await vi.advanceTimersByTimeAsync(2000 + END_SLACK_MS);
    expect(log).toEqual(["started:server", "ended"]);
  });

  it("times out, reads with the browser, and ignores the late response", async () => {
    const { speech, context, network, browser, advance } = await setup();
    const { callbacks } = events();
    speech.speak("문장", callbacks);
    await advance(REQUEST_TIMEOUT_MS);
    expect(network.calls[0].signal?.aborted).toBe(true);
    expect(browser.spoken).toHaveLength(1);
    network.calls[0].respond(200);
    await flush();
    expect(context.sources).toHaveLength(0);
  });

  it("opens the circuit after two provider failures, then closes on a good trial", async () => {
    const { speech, network, browser, advance } = await setup();
    for (const text of ["하나", "둘"]) {
      speech.speak(text, events().callbacks);
      network.calls.at(-1)?.respond(503);
      await flush();
    }
    expect(browser.spoken).toHaveLength(2);
    speech.speak("셋", events().callbacks);
    speech.prepare?.("넷");
    expect(network.calls).toHaveLength(2);
    expect(browser.spoken.map((item) => item.text)).toEqual(["하나", "둘", "셋"]);
    expect(speech.voiceLocality?.()).toBe("remote");
    await advance(CIRCUIT_OPEN_MS);
    speech.prepare?.("미리"); // 시험 중에는 미리 받기를 안 합니다.
    speech.speak("다섯", events().callbacks);
    speech.speak("여섯", events().callbacks);
    expect(network.calls.map((call) => call.text)).toEqual(["하나", "둘", "다섯"]);
    network.calls[2].respond(200);
    await flush();
    speech.prepare?.("일곱");
    expect(network.calls.at(-1)?.text).toBe("일곱");
  });

  it("honours Retry-After on 429 and does not count 422 as an outage", async () => {
    const { speech, network, browser, advance } = await setup();
    speech.speak("거절", events().callbacks);
    network.calls[0].respond(422);
    await flush();
    speech.speak("한도", events().callbacks);
    network.calls[1].respond(429, 0, { "Retry-After": "30" });
    await flush();
    speech.speak("대기", events().callbacks);
    expect(network.calls).toHaveLength(2);
    expect(browser.spoken.map((item) => item.text)).toEqual(["거절", "한도", "대기"]);
    await advance(30_000);
    speech.speak("재시도", events().callbacks);
    expect(network.calls).toHaveLength(3);
  });

  it("uses the browser when the server voice is off, forced off, or the text is too long", async () => {
    for (const options of [{ enabled: false }, { forceBrowser: true }]) {
      const { speech, network, browser, status } = await setup(options);
      expect(status?.enabled).toBe(false);
      speech.prepare?.("문장");
      speech.speak("문장", events().callbacks);
      expect(network.calls).toHaveLength(0);
      expect(browser.spoken).toHaveLength(1);
    }
    const { speech, network, browser } = await setup();
    speech.speak("가".repeat(501), events().callbacks);
    expect(network.calls).toHaveLength(0);
    expect(browser.spoken).toHaveLength(1);
  });

  it("unlock resumes a suspended context inside the user gesture", async () => {
    const { speech, context } = await setup();
    context.state = "suspended";
    speech.unlock?.();
    expect(context.resumes).toBe(1);
    expect(context.state).toBe("running");
  });
});
