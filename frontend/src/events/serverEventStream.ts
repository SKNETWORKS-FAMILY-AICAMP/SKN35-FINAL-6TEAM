/**
 * 실제 백엔드 이벤트(SSE).
 * 연결이 끊기면 브라우저가 알아서 다시 붙고, 마지막으로 받은 순번(Last-Event-ID) 다음부터 다시 받습니다.
 */
import type { AgentEvent } from "../api/client";
import type { EventStream } from "./eventStream";

export function createServerEventStream(sessionId: string, companyId: number): EventStream {
  return {
    subscribe(onEvent, onState) {
      const params = new URLSearchParams({ company_id: String(companyId), after: "0" });
      const source = new EventSource(`/api/sessions/${sessionId}/events/stream?${params}`);
      onState("connecting");
      source.onopen = () => onState("open");
      source.onerror = () =>
        onState(source.readyState === EventSource.CLOSED ? "closed" : "reconnecting");
      source.addEventListener("agent_event", (message) => {
        onEvent(JSON.parse((message as MessageEvent<string>).data) as AgentEvent);
      });
      return () => {
        source.close();
        onState("closed");
      };
    },
  };
}
