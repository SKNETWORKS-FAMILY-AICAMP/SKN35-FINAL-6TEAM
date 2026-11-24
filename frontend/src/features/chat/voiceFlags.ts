/**
 * 주소로 켜는 음성 실험 기능. 제품 기본값은 모두 꺼져 있습니다.
 * ?barge-in   읽는 중에 말하면 멈추기(자기 목소리 오인 비율을 재기 전까지 기본 끔)
 * ?voice-debug 턴 시간 기록 표
 */
export interface VoiceFlags {
  bargeIn: boolean;
  debug: boolean;
}

export function voiceFlags(search: string): VoiceFlags {
  const params = new URLSearchParams(search);
  return { bargeIn: params.has("barge-in"), debug: params.has("voice-debug") };
}

export const PAGE_VOICE_FLAGS: VoiceFlags =
  typeof window === "undefined"
    ? { bargeIn: false, debug: false }
    : voiceFlags(window.location.search);
