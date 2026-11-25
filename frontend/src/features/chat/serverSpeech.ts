/**
 * 서버 음성 읽기. 받아쓰기는 브라우저 그대로 두고, 읽기만 서버가 만든 음성(WAV)으로 바꿉니다.
 * 서버 음성이 꺼져 있거나 실패하면 그 문장은 브라우저 음성으로 읽습니다.
 *
 * - 문장 하나를 다 받은 뒤 재생합니다(서버가 끝까지 만든 음성만 줍니다).
 * - 문장 하나의 stop 은 재생만 멈춥니다. 미리 받은 것은 cancelAll 이 버립니다.
 * - started 는 소리를 예약한 시각입니다. 실제 스피커 출력은 장치 지연만큼 늦습니다.
 */
import type { SpeakCallbacks, SpeechAdapter, SpeechStatus } from "./browserSpeech";

export interface AudioBufferLike {
  duration: number;
}

export interface AudioSourceLike {
  buffer: AudioBufferLike | null;
  onended: (() => void) | null;
  connect(destination: unknown): unknown;
  start(): void;
  stop(): void;
}

export interface AudioContextLike {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: unknown;
  resume(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  createBufferSource(): AudioSourceLike;
}

export interface ServerSpeechOptions {
  /** `/api/pc-consult/sessions/{id}/speech` */
  endpoint: string;
  /** 받아쓰기와 대체 읽기. 보통 브라우저 음성입니다. */
  fallback: SpeechAdapter;
  fetch?: typeof fetch;
  createContext?: () => AudioContextLike | null;
  now?: () => number;
  /** ?tts=browser. 사전만 받고 읽기는 브라우저로 합니다. */
  forceBrowser?: boolean;
  timeoutMs?: number;
}

/** 서버가 받는 가장 긴 읽기 글. 넘으면 그 문장은 브라우저로 읽습니다. */
export const MAX_SERVER_CHARS = 500;
export const REQUEST_TIMEOUT_MS = 4000;
/** 재생을 예약한 뒤 이 안에 오디오 시계가 안 움직이면 브라우저로 넘깁니다. */
export const STALL_MS = 600;
/** 끝 신호가 오지 않을 때 음성 길이에 더해 기다리는 시간. */
export const END_SLACK_MS = 2000;
export const CIRCUIT_OPEN_MS = 60_000;
const FAILURES_TO_OPEN = 2;
const MAX_ENTRIES = 6;
const MAX_BYTES = 8_000_000;

type Failure = "provider" | "limit" | "rejected" | "aborted";
type Result =
  | { ok: true; buffer: AudioBufferLike; fetchMs: number; bytes: number }
  | { ok: false; failure: Failure; retryAfterMs?: number };

interface Entry {
  keep: boolean;
  controller: AbortController;
  promise: Promise<Result>;
  settled: Result | null;
}

function audioConstructor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

function defaultContext(): AudioContextLike | null {
  const Constructor = audioConstructor();
  return Constructor ? (new Constructor() as unknown as AudioContextLike) : null;
}

export function createServerSpeech(options: ServerSpeechOptions): SpeechAdapter & {
  /** 시험용: 지금 서버 경로를 쓰는지. */
  usingServer(): boolean;
} {
  const fallback = options.fallback;
  const request = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const createContext = options.createContext ?? defaultContext;
  // 화면을 그릴 때마다 오디오 장치를 열지 않도록, 지원 여부만 먼저 봅니다.
  const audioSupported = options.createContext !== undefined || audioConstructor() !== undefined;
  const entries = new Map<string, Entry>();
  let context: AudioContextLike | null | undefined;
  let enabled = false;
  let failures = 0;
  let openUntil = 0;
  let trialRunning = false;

  function audio(): AudioContextLike | null {
    if (context === undefined) {
      try {
        context = createContext();
      } catch {
        context = null;
      }
    }
    return context;
  }

  /** 회로: 닫힘이면 씀. 열린 시간이 지나면 시험 요청 하나만 보냅니다. */
  function available(): boolean {
    if (!enabled || options.forceBrowser || !audioSupported || context === null) return false;
    if (openUntil === 0) return true;
    if (now() < openUntil) return false;
    return !trialRunning;
  }

  function record(result: Result, trial: boolean) {
    if (trial) trialRunning = false;
    if (result.ok) {
      failures = 0;
      openUntil = 0;
      return;
    }
    if (result.failure === "limit") {
      openUntil = now() + (result.retryAfterMs ?? CIRCUIT_OPEN_MS);
      failures = 0;
      return;
    }
    if (result.failure !== "provider") return; // 취소·거절(422 등)은 장애로 세지 않습니다.
    failures += 1;
    if (trial || failures >= FAILURES_TO_OPEN) {
      openUntil = now() + CIRCUIT_OPEN_MS;
      failures = 0;
    }
  }

  function totalBytes(): number {
    let total = 0;
    for (const entry of entries.values()) if (entry.settled?.ok) total += entry.settled.bytes;
    return total;
  }

  function evict() {
    for (const [text, entry] of entries) {
      if (entries.size <= MAX_ENTRIES && totalBytes() <= MAX_BYTES) return;
      if (entry.keep) continue;
      if (!entry.settled) entry.controller.abort();
      entries.delete(text);
    }
  }

  function start(text: string, keep: boolean): Entry {
    const controller = new AbortController();
    const trial = openUntil !== 0;
    if (trial) trialRunning = true;
    const startedAt = now();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const entry: Entry = {
      keep,
      controller,
      settled: null,
      promise: (async (): Promise<Result> => {
        try {
          const response = await request(options.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
            credentials: "same-origin",
            signal: controller.signal,
          });
          if (!response.ok) {
            if (response.status === 429) {
              const seconds = Number(response.headers.get("Retry-After"));
              return {
                ok: false,
                failure: "limit",
                retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined,
              };
            }
            return {
              ok: false,
              failure: response.status >= 500 ? "provider" : "rejected",
            };
          }
          const data = await response.arrayBuffer();
          const context = audio();
          if (!context || !data.byteLength) return { ok: false, failure: "provider" };
          const buffer = await context.decodeAudioData(data);
          return { ok: true, buffer, fetchMs: now() - startedAt, bytes: data.byteLength };
        } catch {
          if (controller.signal.aborted && !timedOut) return { ok: false, failure: "aborted" };
          return { ok: false, failure: "provider" };
        } finally {
          clearTimeout(timer);
        }
      })(),
    };
    void entry.promise.then((result) => {
      entry.settled = result;
      record(result, trial);
      if (!result.ok && entries.get(text) === entry) entries.delete(text);
      evict();
    });
    entries.set(text, entry);
    evict();
    return entry;
  }

  function prepare(text: string, prepareOptions?: { keep?: boolean }) {
    if (!text || text.length > MAX_SERVER_CHARS || !available()) return;
    const existing = entries.get(text);
    if (existing) {
      if (prepareOptions?.keep) existing.keep = true;
      return;
    }
    // 회로 시험 중에는 미리 받기를 하지 않습니다.
    if (openUntil !== 0) return;
    start(text, prepareOptions?.keep ?? false);
  }

  function cancelAll() {
    for (const [text, entry] of entries) {
      if (entry.keep) continue;
      if (!entry.settled) entry.controller.abort();
      entries.delete(text);
    }
  }

  function speakWithBrowser(text: string, callbacks: SpeakCallbacks, fallbackUsed: boolean) {
    return fallback.speak(text, {
      started: () => callbacks.started?.({ path: "browser", fallback: fallbackUsed }),
      ended: callbacks.ended,
      failed: callbacks.failed,
    });
  }

  function speak(text: string, callbacks: SpeakCallbacks): () => void {
    const cached = entries.get(text);
    if (!cached && (text.length > MAX_SERVER_CHARS || !available())) {
      return speakWithBrowser(text, callbacks, false);
    }
    const entry = cached ?? start(text, false);
    let stopped = false;
    let done = false;
    let source: AudioSourceLike | null = null;
    let stopBrowser: (() => void) | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const finish = (report: () => void) => {
      if (stopped || done) return;
      done = true;
      for (const timer of timers) clearTimeout(timer);
      if (!entry.keep && entries.get(text) === entry) entries.delete(text);
      report();
    };
    const silence = () => {
      if (!source) return;
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* 이미 끝남 */
      }
      source = null;
    };
    const toBrowser = () => {
      if (stopped || done || stopBrowser) return;
      for (const timer of timers) clearTimeout(timer);
      silence();
      stopBrowser = speakWithBrowser(
        text,
        {
          started: callbacks.started,
          ended: () => finish(callbacks.ended),
          failed: (reason) => finish(() => callbacks.failed(reason)),
        },
        true,
      );
    };
    const play = (buffer: AudioBufferLike, fetchMs: number) => {
      const context = audio();
      if (stopped || done || !context) return toBrowser();
      if (context.state !== "running") return toBrowser();
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(context.destination);
      node.onended = () => {
        if (source !== node) return;
        source = null;
        finish(callbacks.ended);
      };
      source = node;
      const scheduledAt = context.currentTime;
      try {
        node.start();
      } catch {
        source = null;
        return toBrowser();
      }
      callbacks.started?.({ path: "server", fetchMs });
      timers.push(
        setTimeout(() => {
          // 오디오 시계가 멈춰 있으면(탭 백그라운드·장치 문제) 브라우저로 넘깁니다.
          if (source === node && context.currentTime <= scheduledAt) toBrowser();
        }, STALL_MS),
        setTimeout(
          () => {
            if (source !== node) return;
            silence();
            finish(callbacks.ended);
          },
          buffer.duration * 1000 + END_SLACK_MS,
        ),
      );
    };

    void entry.promise.then(async (result) => {
      if (stopped || done) return;
      if (!result.ok) return toBrowser();
      const context = audio();
      if (context && context.state !== "running") {
        // 사용자 동작 없이 읽게 된 경우 한 번 깨워 보고, 안 되면 브라우저로 읽습니다.
        await Promise.race([
          context.resume().catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 300)),
        ]);
      }
      play(result.buffer, result.fetchMs);
    });

    return () => {
      if (done || stopped) return;
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      silence();
      stopBrowser?.();
    };
  }

  return {
    get recognitionSupported() {
      return fallback.recognitionSupported;
    },
    get synthesisSupported() {
      return fallback.synthesisSupported || (enabled && audioSupported);
    },
    listen: (callbacks) => fallback.listen(callbacks),
    speak,
    prepare,
    cancelAll,
    voiceLocality() {
      // 즉시 반응을 미리 받아 두므로 서버 경로는 기기 음성처럼 바로 읽힙니다.
      return available() ? "local" : (fallback.voiceLocality?.() ?? null);
    },
    reset() {
      cancelAll();
      fallback.reset?.();
    },
    unlock() {
      const context = audio();
      if (context && context.state !== "running") void context.resume().catch(() => undefined);
    },
    async load(): Promise<SpeechStatus | null> {
      try {
        const response = await request(options.endpoint, {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return null;
        const status = (await response.json()) as SpeechStatus;
        enabled = status.enabled === true;
        return {
          enabled: enabled && !options.forceBrowser && audioSupported,
          dictionary: Array.isArray(status.dictionary) ? status.dictionary : [],
        };
      } catch {
        return null;
      }
    },
    usingServer: () => available(),
  };
}
