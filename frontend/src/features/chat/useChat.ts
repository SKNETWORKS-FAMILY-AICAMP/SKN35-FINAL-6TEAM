/**
 * 채팅 상담 — 이력 불러오기 · 메시지 보내기. 조건이 다 모이면 서버가 업무팀 실행을 시작하고,
 * 그 진행은 기존 이벤트 스트림(SSE)으로 오피스 · 후보 · 견적 화면에 그대로 나타납니다.
 */
import { useCallback, useEffect, useReducer } from "react";
import { api, errorMessage, type QuickReplyIn } from "../../api/client";
import { chatReducer, initialChatState } from "./chatState";

export function useChat(sessionId: string | null, companyId: number | null) {
  const [state, dispatch] = useReducer(chatReducer, undefined, initialChatState);

  useEffect(() => {
    if (sessionId === null || companyId === null) return;
    let cancelled = false;
    const params = { header: { "X-Company-Id": companyId }, path: { session_id: sessionId } };
    void api.GET("/api/sessions/{session_id}/messages", { params }).then(({ data }) => {
      if (!cancelled && data) dispatch({ type: "loaded", messages: data });
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, companyId]);

  const send = useCallback(
    async (text: string, quickReply: QuickReplyIn | null = null) => {
      if (sessionId === null || companyId === null) return;
      dispatch({ type: "sent", text });
      const params = { header: { "X-Company-Id": companyId }, path: { session_id: sessionId } };
      const body = { text, quick_reply: quickReply };
      const { data, error } = await api.POST("/api/sessions/{session_id}/messages", {
        params,
        body,
      });
      if (data) dispatch({ type: "received", turn: data });
      else dispatch({ type: "failed", error: errorMessage(error) });
    },
    [sessionId, companyId],
  );

  return { chat: state, sendChat: send };
}
