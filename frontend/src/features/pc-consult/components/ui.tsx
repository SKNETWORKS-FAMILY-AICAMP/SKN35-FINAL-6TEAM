import { useEffect, useRef, type ReactNode } from "react";
import type { Category, CheckStatus, Part, ValidationResult } from "../types";

export function PartGlyph({ category, large = false }: { category: Category; large?: boolean }) {
  const paths: Record<Category, ReactNode> = {
    cpu: (
      <>
        <rect x="16" y="16" width="32" height="32" rx="4" />
        <rect x="23" y="23" width="18" height="18" rx="2" />
        <path d="M23 8v8m9-8v8m9-8v8M23 48v8m9-8v8m9-8v8M8 23h8m-8 9h8m-8 9h8m32-18h8m-8 9h8m-8 9h8" />
      </>
    ),
    motherboard: (
      <>
        <rect x="12" y="8" width="40" height="48" rx="3" />
        <rect x="20" y="17" width="17" height="17" rx="2" />
        <path d="M43 16v21m-5 7H20m18 6H20M18 10v4m30 37v3" />
      </>
    ),
    ram: (
      <>
        <rect x="6" y="20" width="52" height="23" rx="3" />
        <path d="M13 26h7v10h-7zm15 0h7v10h-7zm15 0h7v10h-7zM12 43v5m8-5v5m8-5v5m8-5v5m8-5v5m8-5v5" />
      </>
    ),
    gpu: (
      <>
        <rect x="7" y="18" width="48" height="29" rx="4" />
        <circle cx="22" cy="32" r="9" />
        <circle cx="42" cy="32" r="9" />
        <path d="M4 15v37m16-5v5h22v-5M22 27v10m-5-5h10m15-5v10m-5-5h10" />
      </>
    ),
    storage: (
      <>
        <rect x="13" y="8" width="38" height="48" rx="5" />
        <circle cx="32" cy="29" r="11" />
        <circle cx="32" cy="29" r="3" />
        <path d="m34 31 11 11M21 49h10" />
      </>
    ),
    cooler: (
      <>
        <rect x="10" y="10" width="44" height="44" rx="6" />
        <circle cx="32" cy="32" r="16" />
        <circle cx="32" cy="32" r="4" />
        <path d="M32 28c-13-13-16 0-4 4m8 0c13-13 0-16-4-4m0 8c13 13 16 0 4-4m-8 0c-13 13 0 16 4 4" />
      </>
    ),
    psu: (
      <>
        <path d="M10 17h35l10 9v25H10zM10 17l8-7h33l4 16M45 17v34" />
        <circle cx="28" cy="34" r="12" />
        <circle cx="28" cy="34" r="5" />
        <path d="M49 31h3m-3 6h3m-3 6h3" />
      </>
    ),
    case: (
      <>
        <rect x="17" y="5" width="30" height="51" rx="4" />
        <path d="M23 13h18M23 18h18m-18 8h18v22H23zM22 56v4m20-4v4" />
        <circle cx="32" cy="36" r="7" />
      </>
    ),
  };
  return (
    <span className={`pc-part-glyph${large ? " pc-part-glyph-large" : ""}`} aria-hidden="true">
      <svg
        viewBox="0 0 64 64"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {paths[category]}
      </svg>
    </span>
  );
}

export function StatusBadge({ status }: { status: CheckStatus }) {
  const labels: Record<CheckStatus, string> = {
    PASS: "통과",
    CONDITIONAL: "조건부 통과",
    UNKNOWN: "확인 불가",
    FAIL: "호환 불가",
    PENDING: "추후 확인",
  };
  return <span className={`pc-status pc-status-${status.toLowerCase()}`}>{labels[status]}</span>;
}

export function ValidationDetails({ validation }: { validation: ValidationResult }) {
  return (
    <ul className="pc-validation-list">
      {validation.checks.map((check, index) => (
        <li key={`${check.code}-${index}`}>
          <StatusBadge status={check.status} />
          <span>
            {check.message}
            {check.source && <small className="pc-source">근거: {check.source}</small>}
            {check.sources?.map((source, i) => (
              <small className="pc-source" key={i}>
                {source.url && /^https?:\/\//i.test(source.url) ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title || source.url}
                  </a>
                ) : (
                  source.title
                )}
              </small>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PartSpecs({ part }: { part: Part }) {
  const fields: Record<Category, [string, string, string][]> = {
    cpu: [
      ["cores", "코어", "코어"],
      ["boost_ghz", "최대 클럭", "GHz"],
      ["socket", "소켓", ""],
    ],
    motherboard: [
      ["socket", "소켓", ""],
      ["form_factor", "규격", ""],
      ["ram_type", "메모리", ""],
    ],
    ram: [
      ["capacity_gb", "용량", "GB"],
      ["ram_type", "규격", ""],
      ["speed_mtps", "속도", "MT/s"],
    ],
    gpu: [
      ["chipset", "칩셋", ""],
      ["vram_gb", "VRAM", "GB"],
      ["length_mm", "길이", "mm"],
    ],
    storage: [
      ["capacity_gb", "용량", "GB"],
      ["interface", "인터페이스", ""],
      ["form_factor", "규격", ""],
    ],
    cooler:
      part.specs.cooling_type === "case_fan"
        ? [
            ["fan_size_mm", "팬 지름", "mm"],
            ["thickness_mm", "두께", "mm"],
            ["fan_w", "팬 전력", "W"],
          ]
        : [
            ["sockets", "소켓", ""],
            ["radiator_size_mm", "라디에이터", "mm"],
            ["noise_level_db", "소음", "dB"],
          ],
    psu: [
      ["wattage_w", "정격", "W"],
      ["efficiency", "효율", ""],
      ["form_factor", "규격", ""],
    ],
    case: [
      ["type", "유형", ""],
      ["max_gpu_length_mm", "GPU 한도", "mm"],
      ["color", "색상", ""],
    ],
  };
  return (
    <div className="pc-specs">
      {fields[part.category].map(([key, label, unit]) => {
        const value = part.specs[key];
        return (
          <span key={key}>
            <small>{label}</small>
            <strong>
              {value == null
                ? "정보 없음"
                : `${Array.isArray(value) ? value.join(" / ") : String(value)}${unit}`}
            </strong>
          </span>
        );
      })}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`pc-modal ${className}`}
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
          ),
        ].filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="pc-modal-head">
        <h2>{title}</h2>
        <button className="pc-icon-button" type="button" onClick={onClose} aria-label="창 닫기">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
