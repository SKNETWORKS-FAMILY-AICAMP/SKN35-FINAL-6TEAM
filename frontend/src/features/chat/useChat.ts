import { useCallback, useEffect, useReducer, useRef, type RefObject } from "react";
import type { PcApi } from "../pc-consult/data/apiSource";
import type { SelectionMap, Survey } from "../pc-consult/types";
import { chatReducer, initialChatState } from "./chatState";

export function useChat(
  api: PcApi,
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
      if (sending.current || !text.trim()) return;
      sending.current = true;
      dispatch({ type: "sent", text });
      try {
        const { survey, selected } = context.current;
        const messages = await api.send(text, survey, selected);
        if (active.current) dispatch({ type: "answered", messages });
      } catch (cause) {
        if (active.current)
          dispatch({
            type: "failed",
            error: cause instanceof Error ? cause.message : "답변을 받지 못했습니다.",
          });
      } finally {
        sending.current = false;
      }
    },
    [api, context],
  );
  return { chat, sendChat };
}
