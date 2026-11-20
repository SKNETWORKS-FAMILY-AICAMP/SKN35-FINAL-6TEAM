import { useEffect, useRef, useState } from "react";
import type { ConnectionState } from "../events/eventStream";
import { createApiSource, openSession, type PcApi } from "../features/pc-consult/data/apiSource";
import { initialOfficeState, officeReducer } from "../features/office/officeState";

export function useConsultation(enabled: boolean, attempt: number) {
  const opening = useRef<ReturnType<typeof openSession> | null>(null);
  const [session, setSession] = useState<{
    id: string;
    api: PcApi;
    office: ReturnType<typeof initialOfficeState>;
  } | null>(null);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  useEffect(() => {
    if (!enabled) {
      opening.current = null;
      setSession(null);
      setError("");
      return;
    }
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setConnection("connecting");
    setError("");
    opening.current ??= openSession();
    void opening.current
      .then(({ session_id: id }) => {
        if (!active) return;
        const api = createApiSource(id);
        setSession({ id, api, office: initialOfficeState() });
        unsubscribe = api.subscribe(
          (event) =>
            setSession((current) =>
              current && current.id === id
                ? { ...current, office: officeReducer(current.office, event) }
                : current,
            ),
          setConnection,
        );
      })
      .catch((cause: unknown) => {
        if (!active) return;
        opening.current = null;
        setError(cause instanceof Error ? cause.message : "상담 세션을 열지 못했습니다.");
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [enabled, attempt]);
  return { session, error, connection };
}
