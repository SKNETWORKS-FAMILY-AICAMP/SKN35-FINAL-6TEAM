/**
 * 주소로 켜는 음성 실험 기능. 제품 기본값은 모두 꺼져 있습니다.
 * ?barge-in   읽는 중에 말하면 멈추기(자기 목소리 오인 비율을 재기 전까지 기본 끔)
 * ?voice-debug 턴 시간 기록 표
 * ?tts=browser 서버 음성이 켜져 있어도 브라우저 음성으로 읽기(비교용)
 * ?tts=server  실험 화면에서 서버 음성 경로를 쓰기
 */
export interface VoiceFlags {
  bargeIn: boolean;
  debug: boolean;
  tts: "auto" | "browser" | "server";
}

export function voiceFlags(search: string): VoiceFlags {
  const params = new URLSearchParams(search);
  const tts = params.get("tts");
  return {
    bargeIn: params.has("barge-in"),
    debug: params.has("voice-debug"),
    tts: tts === "browser" || tts === "server" ? tts : "auto",
  };
}

export const PAGE_VOICE_FLAGS: VoiceFlags =
  typeof window === "undefined"
    ? { bargeIn: false, debug: false, tts: "auto" }
    : voiceFlags(window.location.search);
