import createClient from "openapi-fetch";
import type { components, paths } from "../../../api/pcSchema";
import type { AgentEvent, ChatMessage } from "../../../api/client";
import type { ConnectionState } from "../../../events/eventStream";
import type { ConsultDataSource } from "./ConsultDataSource";
import type { CandidateRequest, SelectionMap, Survey } from "../types";

const api = createClient<paths>({ baseUrl: "", credentials: "same-origin" });
const route = "/api/pc-consult/sessions/{session_id}" as const;

async function result<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;
  if (response.ok && data !== undefined) return data;
  const detail = error && typeof error === "object" && "detail" in error ? error.detail : null;
  throw new Error(
    typeof detail === "string"
      ? detail
      : `상담 서버가 요청을 처리하지 못했습니다 (HTTP ${response.status}).`,
  );
}

export function openSession() {
  return result(api.POST("/api/pc-consult/sessions"));
}

function surveyBody(survey: Survey): components["schemas"]["Survey"] {
  return {
    ...survey,
    owned: Object.fromEntries(
      Object.values(survey.owned).map((owned) => [
        owned.category,
        { category: owned.category, name: owned.name, part_id: owned.part?.part_id ?? null },
      ]),
    ),
  };
}

function selectionIds(selected: SelectionMap) {
  return Object.fromEntries(
    Object.entries(selected).map(([category, part]) => [category, part.part_id]),
  );
}

function coolingBody(selected: SelectionMap) {
  const cooling = selected.cooler?.cooling;
  return cooling
    ? {
        cooling: {
          mode: cooling.mode,
          fans: cooling.fans.map(({ part, quantity }) => ({ part_id: part.part_id, quantity })),
        },
      }
    : {};
}

function candidateBody(input: CandidateRequest) {
  return {
    ...input,
    ...coolingBody(input.selected),
    selected: selectionIds(input.selected),
    survey: surveyBody(input.survey),
  };
}

export function createApiSource(sessionId: string) {
  const params = { path: { session_id: sessionId } };
  const toMessage = (row: components["schemas"]["MessageOut"]): ChatMessage => ({
    ...row,
    session_id: sessionId,
    quick_replies: [],
    nlu: null,
  });
  const source: ConsultDataSource = {
    searchParts: (category, query) =>
      result(api.GET(`${route}/parts`, { params: { ...params, query: { category, query } } })),
    planConsultation: (survey) =>
      result(api.POST(`${route}/plan`, { params, body: { survey: surveyBody(survey) } })),
    getCandidates: (input) =>
      result(api.POST(`${route}/candidates`, { params, body: candidateBody(input) })),
    validate: (survey, selected) =>
      result(
        api.POST(`${route}/validations`, {
          params,
          body: {
            survey: surveyBody(survey),
            selected: selectionIds(selected),
            ...coolingBody(selected),
          },
        }),
      ),
    rebalance: (input, amount) =>
      result(api.POST(`${route}/rebalance`, { params, body: { ...candidateBody(input), amount } })),
    createQuote: ({ version, survey, selected }) =>
      result(
        api.POST(`${route}/quotes`, {
          params,
          body: {
            version,
            survey: surveyBody(survey),
            selected: selectionIds(selected),
            ...coolingBody(selected),
          },
        }),
      ),
    confirmQuote: ({ quote_id, version, acceptConditions }) =>
      result(
        api.POST(`${route}/quotes/{version}/confirm`, {
          params: { path: { ...params.path, version } },
          body: { quote_id, accept_conditions: acceptConditions },
        }),
      ),
  };
  return {
    ...source,
    async messages() {
      return (await result(api.GET(`${route}/messages`, { params }))).map(toMessage);
    },
    async send(text: string, survey: Survey | null, selected: SelectionMap) {
      const reply = await result(
        api.POST(`${route}/messages`, {
          params,
          body: {
            text,
            survey: survey ? surveyBody(survey) : undefined,
            selected: selectionIds(selected),
            ...coolingBody(selected),
          },
        }),
      );
      return reply.messages.map(toMessage);
    },
    subscribe(onEvent: (event: AgentEvent) => void, onState: (state: ConnectionState) => void) {
      const events = new EventSource(
        "/api/pc-consult/sessions/" + encodeURIComponent(sessionId) + "/events/stream?after=0",
      );
      onState("connecting");
      events.onopen = () => onState("open");
      events.onmessage = ({ data }) => onEvent(JSON.parse(data) as AgentEvent);
      events.onerror = () =>
        onState(events.readyState === EventSource.CLOSED ? "closed" : "reconnecting");
      return () => events.close();
    },
  };
}
export type PcApi = ReturnType<typeof createApiSource>;
