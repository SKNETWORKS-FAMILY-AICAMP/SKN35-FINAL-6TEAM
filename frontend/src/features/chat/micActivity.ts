/**
 * 끼어들기용 사람 소리 감지. 마이크 소리 크기만 브라우저 안에서 보고, 녹음하거나 어디에도 보내지 않습니다.
 * 판정(createEnergyGate)은 순수 함수라 합성 신호로 시험하고, 브라우저 연결(createMicActivityDetector)은 얇게 둡니다.
 * ActivityDetector 모양만 지키면 나중에 Silero VAD 로 바꿀 수 있습니다.
 */

export interface SpeakingContext {
  /** 지금 상담 직원 목소리가 나가는 중인지. */
  speaking: boolean;
  /** 지금 문장 소리가 시작된 시각(ms). 없으면 null. */
  utteranceStartedAt: number | null;
}

export interface ActivityDetector {
  supported: boolean;
  /** 감지를 시작하고 멈추는 함수를 바로 돌려줍니다. 권한이 없으면 failed 를 부르고 상담은 계속됩니다. */
  start(
    listener: (speaking: boolean, at: number) => void,
    context: () => SpeakingContext,
    failed: (reason: string) => void,
  ): () => void;
}

export interface GateOptions {
  /** 마이크를 켠 뒤 바닥값만 배우는 시간. */
  warmupMs: number;
  /** 문장 소리가 시작된 직후 무시하는 시간. */
  utteranceGuardMs: number;
  /** 이 창 안에서 */
  windowMs: number;
  /** 이 비율 이상의 프레임이 문턱을 넘으면 말소리로 봅니다. */
  ratio: number;
  /** 평소 바닥값 위로 이만큼(dB). */
  idleMarginDb: number;
  /** 우리 목소리가 나갈 때의 바닥값 위로 이만큼(dB). 평소 기준과 둘 중 큰 쪽을 씁니다. */
  echoMarginDb: number;
  /** 말소리가 끝났다고 보는 조용한 시간. */
  releaseMs: number;
  /** 어떤 경우에도 이보다 작은 소리는 말로 보지 않습니다(dBFS). */
  minDb: number;
}

export const DEFAULT_GATE: GateOptions = {
  warmupMs: 500,
  utteranceGuardMs: 300,
  windowMs: 300,
  ratio: 0.8,
  idleMarginDb: 15,
  echoMarginDb: 10,
  releaseMs: 400,
  minDb: -55,
};

export interface GateFrame {
  at: number;
  db: number;
  speaking: boolean;
  utteranceStartedAt: number | null;
}

export type GateEvent = "start" | "end" | null;

/** 바닥값을 천천히 따라가는 비율. 말소리일 때는 배우지 않습니다. */
const FLOOR_ALPHA = 0.05;
const FAST_ALPHA = 0.3;
const INITIAL_FLOOR_DB = -70;

export function rmsToDb(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < samples.length; index++) sum += samples[index] * samples[index];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return 20 * Math.log10(rms + 1e-9);
}

export function createEnergyGate(options: GateOptions = DEFAULT_GATE) {
  let startedAt: number | null = null;
  let idleFloor = INITIAL_FLOOR_DB;
  let echoFloor = INITIAL_FLOOR_DB;
  let active = false;
  let lastLoudAt = 0;
  const window: { at: number; loud: boolean }[] = [];

  function threshold(speaking: boolean): number {
    const idle = idleFloor + options.idleMarginDb;
    const value = speaking ? Math.max(idle, echoFloor + options.echoMarginDb) : idle;
    return Math.max(value, options.minDb);
  }

  return {
    update(frame: GateFrame): GateEvent {
      startedAt ??= frame.at;
      const warming = frame.at - startedAt < options.warmupMs;
      const guarded =
        frame.speaking &&
        frame.utteranceStartedAt !== null &&
        frame.at - frame.utteranceStartedAt < options.utteranceGuardMs;
      const loud = !warming && !guarded && frame.db > threshold(frame.speaking);

      if (!active) {
        // 바닥값은 말소리가 아닐 때만 배웁니다. 준비 시간과 문장 시작 직후에는 빨리 배웁니다.
        // 문장 시작 직후에 들리는 소리는 거의 우리 목소리가 되돌아온 것이라 그 크기를 기준으로 삼습니다.
        if (frame.speaking) {
          if (guarded || !loud)
            echoFloor += (guarded ? FAST_ALPHA : FLOOR_ALPHA) * (frame.db - echoFloor);
        } else if (!loud) {
          idleFloor += (warming ? FAST_ALPHA : FLOOR_ALPHA) * (frame.db - idleFloor);
        }
      }
      if (warming || guarded) {
        window.length = 0;
        return null;
      }

      window.push({ at: frame.at, loud });
      while (window.length && frame.at - window[0].at > options.windowMs) window.shift();
      if (loud) lastLoudAt = frame.at;

      if (!active) {
        const span = window.length ? frame.at - window[0].at : 0;
        const loudCount = window.filter((item) => item.loud).length;
        if (span >= options.windowMs * 0.9 && loudCount / window.length >= options.ratio) {
          active = true;
          return "start";
        }
        return null;
      }
      if (frame.at - lastLoudAt >= options.releaseMs) {
        active = false;
        window.length = 0;
        return "end";
      }
      return null;
    },
    get floors() {
      return { idleFloor, echoFloor };
    },
  };
}

const FRAME_INTERVAL_MS = 25;

/** getUserMedia + AnalyserNode. 숨은 탭에서도 돌도록 rAF 대신 setInterval 로 잽니다. */
export function createMicActivityDetector(): ActivityDetector {
  const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  const AudioContextClass =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  const supported = !!media?.getUserMedia && !!AudioContextClass;
  return {
    supported,
    start(listener, context, failed) {
      if (!supported || !media || !AudioContextClass) {
        failed("이 브라우저에서는 끼어들기를 쓸 수 없습니다.");
        return () => {};
      }
      let cancelled = false;
      let stream: MediaStream | null = null;
      let audio: AudioContext | null = null;
      let timer: ReturnType<typeof setInterval> | null = null;
      const gate = createEnergyGate();
      const stop = () => {
        cancelled = true;
        if (timer) clearInterval(timer);
        stream?.getTracks().forEach((track) => track.stop());
        void audio?.close().catch(() => {});
        stream = null;
        audio = null;
      };
      media
        .getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        })
        .then((opened) => {
          if (cancelled) {
            // 정리한 뒤에 열린 스트림은 바로 닫아 마이크 표시등이 남지 않게 합니다.
            opened.getTracks().forEach((track) => track.stop());
            return;
          }
          stream = opened;
          audio = new AudioContextClass();
          void audio.resume().catch(() => {});
          const analyser = audio.createAnalyser();
          analyser.fftSize = 1024;
          audio.createMediaStreamSource(opened).connect(analyser);
          const samples = new Float32Array(analyser.fftSize);
          timer = setInterval(() => {
            if (cancelled) return;
            analyser.getFloatTimeDomainData(samples);
            const now = Date.now();
            const { speaking, utteranceStartedAt } = context();
            const event = gate.update({
              at: now,
              db: rmsToDb(samples),
              speaking,
              utteranceStartedAt,
            });
            if (event) listener(event === "start", now);
          }, FRAME_INTERVAL_MS);
        })
        .catch(() => {
          if (!cancelled)
            failed("마이크를 열지 못해 끼어들기를 껐습니다. 그만 읽기 버튼으로 멈출 수 있어요.");
        });
      return stop;
    },
  };
}
