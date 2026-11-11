/**
 * 화면 상태를 한곳에서 관리합니다.
 * - 기업을 고르면 상담 세션을 새로 만들고 이벤트 스트림을 구독합니다.
 * - 이벤트로 오피스 상태를 바꾸고, 결과물이 생겼다는 이벤트가 오면 후보·견적을 다시 불러옵니다.
 * - ?mock=1 이면 백엔드 없이 가짜 이벤트 대본만 재생합니다.
 */
import { useCallback, useEffect, useReducer, useState } from "react";
import {
  api,
  errorMessage,
  type AgentEvent,
  type Company,
  type Quotation,
  type Recommendation,
  type RequirementsIn,
} from "../api/client";
import type { ConnectionState } from "../events/eventStream";
import { createMockEventStream } from "../events/mockEventStream";
import { createServerEventStream } from "../events/serverEventStream";
import { initialOfficeState, officeReducer } from "../features/office/officeState";

const REFRESH_TYPES = new Set<AgentEvent["type"]>([
  "task.progress",
  "task.completed",
  "task.failed",
  "run.completed",
  "run.failed",
  "run.needs_revision",
  "run.needs_input",
]);

export function useConsultation(company: Company | null, mock: boolean) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [office, dispatch] = useReducer(officeReducer, undefined, initialOfficeState);
  const [connection, setConnection] = useState<ConnectionState>("closed");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const companyId = company?.id ?? null;

  // 기업이 바뀌면 새 세션
  useEffect(() => {
    if (mock || companyId === null) return;
    let cancelled = false;
    api
      .POST("/api/sessions", { params: { header: { "X-Company-Id": companyId } } })
      .then(({ data, error: failure }) => {
        if (cancelled) return;
        if (data) setSessionId(data.id);
        else setError(errorMessage(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, mock]);

  // 이벤트 구독
  useEffect(() => {
    if (!mock && (sessionId === null || companyId === null)) return;
    const stream =
      mock || sessionId === null || companyId === null
        ? createMockEventStream()
        : createServerEventStream(sessionId, companyId);
    return stream.subscribe((event) => {
      dispatch(event);
      if (REFRESH_TYPES.has(event.type)) setRefreshTick((tick) => tick + 1);
    }, setConnection);
  }, [sessionId, companyId, mock]);

  // 결과물 다시 불러오기
  useEffect(() => {
    if (mock || sessionId === null || companyId === null || refreshTick === 0) return;
    const header = { "X-Company-Id": companyId };
    const path = { session_id: sessionId };
    let cancelled = false;
    void Promise.all([
      api.GET("/api/sessions/{session_id}/recommendations", { params: { header, path } }),
      api.GET("/api/sessions/{session_id}/quotation", { params: { header, path } }),
    ]).then(([recs, quote]) => {
      if (cancelled) return;
      setRecommendations(recs.data ?? []);
      setQuotation(quote.data ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshTick, sessionId, companyId, mock]);

  const submit = useCallback(
    async (requirements: RequirementsIn) => {
      if (sessionId === null || companyId === null) return;
      setError(null);
      const { error: failure } = await api.PUT("/api/sessions/{session_id}/requirements", {
        params: { header: { "X-Company-Id": companyId }, path: { session_id: sessionId } },
        body: requirements,
      });
      if (failure) setError(errorMessage(failure));
    },
    [sessionId, companyId],
  );

  const retry = useCallback(async () => {
    if (sessionId === null || companyId === null) return;
    const { error: failure } = await api.POST("/api/sessions/{session_id}/retry", {
      params: { header: { "X-Company-Id": companyId }, path: { session_id: sessionId } },
    });
    if (failure) setError(errorMessage(failure));
  }, [sessionId, companyId]);

  return { sessionId, office, connection, recommendations, quotation, error, submit, retry };
}
