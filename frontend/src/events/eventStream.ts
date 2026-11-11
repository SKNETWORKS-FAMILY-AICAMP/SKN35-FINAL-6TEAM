/**
 * 이벤트 스트림 공통 인터페이스.
 * 실제 백엔드(serverEventStream)와 가짜 대본(mockEventStream)이 같은 모양이라,
 * 화면 코드는 어느 쪽에서 오는지 몰라도 됩니다.
 */
import type { AgentEvent } from "../api/client";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";

export interface EventStream {
  /** 구독을 시작하고, 끝낼 때 부를 함수를 돌려줍니다. */
  subscribe(
    onEvent: (event: AgentEvent) => void,
    onState: (state: ConnectionState) => void,
  ): () => void;
}
