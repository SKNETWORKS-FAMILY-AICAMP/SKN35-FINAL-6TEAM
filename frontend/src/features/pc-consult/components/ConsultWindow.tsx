import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import "./consultWindow.css";

/** Keeps the survey mounted when folded, so unsent input and product searches stay intact. */
export function ConsultWindow({
  active,
  stage,
  title,
  children,
}: {
  active: boolean;
  stage: string;
  title: string;
  children: ReactNode;
}) {
  return active ? (
    <ActiveConsultWindow stage={stage} title={title}>
      {children}
    </ActiveConsultWindow>
  ) : (
    children
  );
}

function ActiveConsultWindow({
  stage,
  title,
  children,
}: {
  stage: string;
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const [folded, setFolded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const reviewing = stage === "review";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || folded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [folded]);

  useEffect(() => {
    if (!folded) headingRef.current?.focus({ preventScroll: true });
  }, [stage, folded]);

  function fold() {
    setFolded(true);
    requestAnimationFrame(() => resumeRef.current?.focus({ preventScroll: true }));
  }

  return (
    <>
      <section className="pc-window-placeholder" aria-label="진행 중인 상담 설문">
        <span className="pc-window-placeholder-icon" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7">
            <rect x="6" y="4" width="20" height="25" rx="3" />
            <path d="M11 11h10M11 16h10M11 21h6" />
          </svg>
        </span>
        <div className="pc-window-placeholder-copy">
          <span>{reviewing ? "상담 시작 전 확인" : "상담 설문 작성 중"}</span>
          <h2>{reviewing ? "입력한 내용을 확인해 주세요" : "필요한 PC를 함께 알아볼까요?"}</h2>
          <p>작성 창을 접어도 입력한 내용은 그대로 남아요.</p>
        </div>
        <button
          ref={resumeRef}
          type="button"
          className="pc-primary pc-window-resume"
          onClick={() => setFolded(false)}
          aria-haspopup="dialog"
          aria-controls={id}
        >
          {reviewing ? "설문 확인하기" : "설문 계속 작성"}
          <span aria-hidden="true">↗</span>
        </button>
      </section>
      <dialog
        ref={dialogRef}
        id={id}
        className="pc-consult-window"
        data-expanded={expanded}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-hint`}
        onCancel={(event) => {
          event.preventDefault();
          fold();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
          if (event.key !== "Tab") return;
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              "button, input, select, textarea, summary, a[href], [tabindex]",
            ),
          ].filter(
            (element) =>
              element.tabIndex >= 0 &&
              !element.matches(":disabled") &&
              !element.closest("[inert]") &&
              element.getClientRects().length > 0 &&
              getComputedStyle(element).visibility !== "hidden",
          );
          const focused = document.activeElement;
          const first = controls[0];
          const last = controls.at(-1);
          const outsideControls = !controls.some((control) => control === focused);
          if (event.shiftKey && (focused === first || outsideControls)) {
            event.preventDefault();
            (last ?? headingRef.current)?.focus();
          } else if (!event.shiftKey && (focused === last || outsideControls)) {
            event.preventDefault();
            (first ?? headingRef.current)?.focus();
          }
        }}
      >
        <header className="pc-window-header">
          <div className="pc-window-heading">
            <span className="pc-window-eyebrow">
              <i aria-hidden="true" />
              {reviewing ? "입력 내용 확인" : "상담 설문"}
            </span>
            <h2 ref={headingRef} id={`${id}-title`} tabIndex={-1}>
              {title}
            </h2>
            <p id={`${id}-hint`}>창 안에서 작성해 주세요. 접었다가 이어서 쓸 수 있어요.</p>
          </div>
          <div className="pc-window-controls">
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-pressed={expanded}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                {expanded ? (
                  <>
                    <rect x="6" y="3" width="11" height="11" rx="1" />
                    <path d="M13 14v3H3V7h3" />
                  </>
                ) : (
                  <rect x="3" y="3" width="14" height="14" rx="1" />
                )}
              </svg>
              {expanded ? "기본 크기" : "크게 보기"}
            </button>
            <button type="button" onClick={fold} aria-label="설문 창 접기">
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 14h12" />
              </svg>
              접기
            </button>
          </div>
        </header>
        <div className="pc-window-content">{children}</div>
      </dialog>
    </>
  );
}
