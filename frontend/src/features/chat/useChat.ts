import { useCallback, useEffect, useReducer, useRef, type RefObject } from "react";
import type { PcApi } from "../pc-consult/data/apiSource";
import type { SelectionMap, Survey } from "../pc-consult/types";
import { chatReducer, initialChatState } from "./chatState";

/** 대화에 필요한 것은 두 가지뿐이라 그만큼만 받습니다(실험 화면이 가짜 api 를 넣을 수 있게). */
export type ChatApi = Pick<PcApi, "messages" | "send">;

export function useChat(
  api: ChatApi,
  context: RefObject<{ survey: Survey | null; selected: SelectionMap }>,
) {
  const [chat, dispatch] = useReducer(chatReducer, undefined, initialChatState);
  const active = useRef(true);
  const sending = useRef(false);
  useEffect(() => {
    let subscribed = true;
    active.current = true;
    void api
      .messages()
      .then((messages) => {
        if (subscribed) dispatch({ type: "loaded", messages });
      })
      .catch((cause: unknown) => {
        if (subscribed)
          dispatch({
            type: "failed",
            error: cause instanceof Error ? cause.message : "대화를 불러오지 못했습니다.",
          });
      });
    return () => {
      subscribed = false;
      active.current = false;
    };
  }, [api]);
  const sendChat = useCallback(
    async (text: string) => {
      if (sending.current || !text.trim()) return false;
      sending.current = true;
      dispatch({ type: "sent", text });
      try {
        const { survey, selected } = context.current;
        const messages = await api.send(text, survey, selected);
        if (active.current) dispatch({ type: "answered", messages });
        return active.current;
      } catch (cause) {
        if (active.current)
          dispatch({
            type: "failed",
            error: cause instanceof Error ? cause.message : "답변을 받지 못했습니다.",
          });
        return false;
      } finally {
        sending.current = false;
      }
    },
    [api, context],
  );
  return { chat, sendChat };
}
