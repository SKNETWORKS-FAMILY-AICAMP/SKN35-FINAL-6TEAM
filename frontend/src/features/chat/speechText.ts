/**
 * 읽기용 글. 화면 글은 그대로 두고, 소리 내어 읽을 문장만 말로 바꿉니다.
 * 순서: 상품 이름 사전(서버가 내려 줌) → 범위 → 월·고유어 수사 → 단위·큰 수 → 영문+숫자 모델 번호 → 남은 수 → 짧은 약어 → 기호.
 * 사전에 없는 상품 단어는 여기 두지 않습니다(상품 지식은 백엔드 domains/ 에 있습니다).
 */

export interface ReadingEntry {
  text: string;
  spoken: string;
  /** 바로 뒤 숫자를 한 자리씩 읽는 이름("RTX 5070" → "알티엑스 오공칠공"). */
  prefix?: boolean;
}

const SINO = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const MODEL_DIGIT = ["공", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const NATIVE_ONES = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"];
const NATIVE_TENS = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"];
const MONTHS = [
  "",
  "일월",
  "이월",
  "삼월",
  "사월",
  "오월",
  "유월",
  "칠월",
  "팔월",
  "구월",
  "시월",
  "십일월",
  "십이월",
];
const LETTERS: Record<string, string> = {
  A: "에이",
  B: "비",
  C: "씨",
  D: "디",
  E: "이",
  F: "에프",
  G: "지",
  H: "에이치",
  I: "아이",
  J: "제이",
  K: "케이",
  L: "엘",
  M: "엠",
  N: "엔",
  O: "오",
  P: "피",
  Q: "큐",
  R: "알",
  S: "에스",
  T: "티",
  U: "유",
  V: "브이",
  W: "더블유",
  X: "엑스",
  Y: "와이",
  Z: "제트",
};
/** 숫자 뒤 단위. 긴 것부터 맞춥니다. */
const UNITS: [string, string][] = [
  ["GHz", "기가헤르츠"],
  ["MHz", "메가헤르츠"],
  ["Hz", "헤르츠"],
  ["TB", "테라"],
  ["GB", "기가"],
  ["MB", "메가"],
  ["kW", "킬로와트"],
  ["W", "와트"],
  ["mm", "밀리"],
  ["cm", "센티"],
  ["ms", "밀리초"],
  ["fps", "프레임"],
  ["RPM", "알피엠"],
  ["dB", "데시벨"],
  ["nm", "나노"],
  ["°C", "도"],
  ["℃", "도"],
  ["%", "퍼센트"],
  ["V", "볼트"],
];
/** 고유어로 읽는 단위와 그 상한. "20대"(나이대)처럼 한자어가 맞는 경우를 피하려고 상한을 둡니다. */
const COUNTERS: [string, number][] = [
  ["번째", 99],
  ["시간", 99],
  ["군데", 99],
  ["가지", 99],
  ["마리", 99],
  ["개(?!월)", 99],
  ["명", 99],
  ["살", 99],
  ["장", 99],
  ["달", 99],
  ["시", 12],
  ["대", 9],
];
const SCALE: Record<string, number> = { 십: 10, 백: 100, 천: 1000, 만: 1e4, 억: 1e8, 조: 1e12 };

const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
/** 앞이 글자·숫자·소수점이 아닌 곳에서만 수를 봅니다. */
const START = String.raw`(?<![A-Za-z0-9.,])`;
/** 빼기 부호: 문장 처음이나 공백·괄호 뒤의 '-'. 단어 사이 하이픈은 부호가 아닙니다. */
const SIGN = String.raw`(?:(?<=^|[\s(])(-))?`;

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function group(value: number): string {
  const units = ["", "십", "백", "천"];
  let out = "";
  for (let place = 3; place >= 0; place--) {
    const digit = Math.floor(value / 10 ** place) % 10;
    if (digit === 0) continue;
    out += (digit === 1 && place > 0 ? "" : SINO[digit]) + units[place];
  }
  return out;
}

/** 한자어 수. 만 단위로 띄웁니다("1800000" → "백팔십만"). */
export function sinoNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "영";
  const parts: string[] = [];
  const rest = Math.floor(Math.abs(value));
  for (const [size, name] of [
    [1e12, "조"],
    [1e8, "억"],
    [1e4, "만"],
    [1, ""],
  ] as const) {
    const chunk = Math.floor(rest / size) % 10000;
    if (chunk === 0) continue;
    parts.push((chunk === 1 && size === 1e4 ? "" : group(chunk)) + name);
  }
  return (value < 0 ? "마이너스 " : "") + parts.join(" ");
}

function readNumber(raw: string): string {
  const plain = raw.replace(/,/g, "");
  const [whole, fraction] = plain.split(".");
  const head = sinoNumber(Number(whole));
  if (fraction === undefined) return head;
  return `${head} 점 ${[...fraction].map((digit) => SINO[Number(digit)]).join("")}`;
}

function modelDigits(digits: string): string {
  return [...digits].map((digit) => MODEL_DIGIT[Number(digit)]).join("");
}

function nativeCount(value: number): string {
  if (value === 20) return "스무";
  return NATIVE_TENS[Math.floor(value / 10)] + NATIVE_ONES[value % 10];
}

function letters(word: string): string {
  return [...word.toUpperCase()].map((letter) => LETTERS[letter] ?? letter).join("");
}

function sorted(dictionary: readonly ReadingEntry[]): ReadingEntry[] {
  return [...dictionary]
    .filter((entry) => entry.text.trim() && entry.spoken.trim())
    .sort((a, b) => b.text.length - a.text.length);
}

/** 바꾼 말 앞뒤는 영문·숫자와 붙어 있을 때만 띄웁니다. 조사는 붙여 둡니다("CPU는" → "씨피유는"). */
function padded(spoken: string, whole: string, start: number, end: number): string {
  const before = /[A-Za-z0-9]/.test(whole[start - 1] ?? "") ? " " : "";
  const after = /[A-Za-z0-9]/.test(whole[end] ?? "") ? " " : "";
  return before + spoken + after;
}

function applyDictionary(text: string, entries: readonly ReadingEntry[]): string {
  if (!entries.length) return text;
  const byKey = new Map(entries.map((entry) => [entry.text.toLowerCase(), entry]));
  const pattern = new RegExp(
    String.raw`(?<![A-Za-z0-9])(${entries.map((entry) => escape(entry.text)).join("|")})(?![A-Za-z])(?:(\s*)(\d+)(?![\d.,]))?`,
    "gi",
  );
  return text.replace(
    pattern,
    (
      match,
      name: string,
      space: string | undefined,
      digits: string | undefined,
      offset: number,
    ) => {
      const entry = byKey.get(name.toLowerCase());
      if (!entry) return match;
      const end = offset + match.length;
      if (digits === undefined) return padded(entry.spoken, text, offset, end);
      if (entry.prefix) {
        return padded(`${entry.spoken} ${modelDigits(digits)}`, text, offset, end);
      }
      return padded(entry.spoken, text, offset, offset) + ` ${space ?? ""}${digits}`;
    },
  );
}

const RANGE_TAIL = [
  ...Object.keys(SCALE),
  "원",
  ...UNITS.map(([unit]) => escape(unit)),
  ...COUNTERS.map(([counter]) => counter),
];

/** "5~10만 원" → "5만 원에서 10만 원". 단위를 양쪽에 붙여 "오에서 십만 원"으로 들리지 않게 합니다. */
function expandRanges(text: string): string {
  const pattern = new RegExp(
    String.raw`${START}(${NUM})\s*[~∼-]\s*(${NUM})((?:\s?(?:${RANGE_TAIL.join("|")}))+)?`,
    "g",
  );
  return text.replace(pattern, (match, from: string, to: string, tail?: string) => {
    if (match.includes("-") && !tail) return match;
    const suffix = tail ?? "";
    return `${from}${suffix}에서 ${to}${suffix}`;
  });
}

function readMonthsAndCounters(text: string): string {
  let out = text.replace(new RegExp(String.raw`${START}(\d{1,2})월`, "g"), (match, raw: string) => {
    const month = Number(raw);
    return month >= 1 && month <= 12 ? MONTHS[month] : match;
  });
  for (const [counter, limit] of COUNTERS) {
    out = out.replace(
      new RegExp(String.raw`${START}(\d{1,2})\s?(${counter})`, "g"),
      (match, raw: string, word: string) => {
        const value = Number(raw);
        return value >= 1 && value <= limit ? `${nativeCount(value)} ${word}` : match;
      },
    );
  }
  return out;
}

function readScaledAndUnits(text: string): string {
  // "180만", "2천만", "1.2만", "1억" 처럼 한글 큰 수 단위가 붙은 수.
  let out = text.replace(
    new RegExp(String.raw`${START}${SIGN}(${NUM})\s?((?:십|백|천)?(?:조|억|만)|천|백)`, "g"),
    (_match, sign: string | undefined, raw: string, scale: string) => {
      const factor = [...scale].reduce((product, word) => product * (SCALE[word] ?? 1), 1);
      const value = Number(raw.replace(/,/g, "")) * factor;
      const rounded = Math.round(value);
      const spoken =
        Math.abs(value - rounded) < 1e-6 ? sinoNumber(rounded) : `${readNumber(raw)}${scale}`;
      return `${sign ? "마이너스 " : ""}${spoken}`;
    },
  );
  const units = UNITS.map(([unit]) => escape(unit)).join("|");
  const spokenUnit = new Map(UNITS.map(([unit, spoken]) => [unit.toLowerCase(), spoken]));
  out = out.replace(
    new RegExp(String.raw`${START}${SIGN}(${NUM})\s?(${units})(?![A-Za-z])`, "gi"),
    (match, sign: string | undefined, raw: string, unit: string) => {
      const spoken = spokenUnit.get(unit.toLowerCase());
      if (!spoken) return match;
      return `${sign ? "마이너스 " : ""}${readNumber(raw)} ${spoken}`;
    },
  );
  return out;
}

/** 영문과 붙은 숫자("14600K", "9800X3D", "B650"): 세 자리 이상 숫자는 한 자리씩, 영문은 사전이나 글자 이름으로. */
function readModelTokens(text: string, entries: readonly ReadingEntry[]): string {
  const pieces = entries.filter((entry) => /^[A-Za-z0-9]+$/.test(entry.text));
  return text.replace(
    /(?<![A-Za-z0-9])(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]+(?![A-Za-z0-9])/g,
    (token) => {
      const parts: string[] = [];
      let index = 0;
      while (index < token.length) {
        const rest = token.slice(index);
        const digits = /^\d+/.exec(rest)?.[0];
        if (digits) {
          parts.push(digits.length >= 3 ? modelDigits(digits) : sinoNumber(Number(digits)));
          index += digits.length;
          continue;
        }
        const known = pieces.find((entry) =>
          rest.toLowerCase().startsWith(entry.text.toLowerCase()),
        );
        if (known) {
          parts.push(known.spoken);
          index += known.text.length;
          continue;
        }
        const word = /^[A-Za-z]+/.exec(rest)?.[0] ?? rest[0];
        parts.push(letters(word));
        index += word.length;
      }
      return parts.join(" ");
    },
  );
}

function readPlainNumbers(text: string): string {
  // 바로 뒤에 한글이 붙으면 띄웁니다("2번" 이 "이번" 으로 들리지 않게).
  return text.replace(
    new RegExp(String.raw`${START}${SIGN}(${NUM})(?![0-9])(?=([가-힣])?)`, "g"),
    (_match, sign: string | undefined, raw: string, next?: string) =>
      `${sign ? "마이너스 " : ""}${readNumber(raw)}${next ? " " : ""}`,
  );
}

/** 영문이 낀 단어 사이 하이픈은 띄어 읽습니다("i5-14600K", "DDR5-6000"). 숫자끼리는 범위로 남깁니다. */
function splitHyphens(text: string): string {
  return text
    .replace(/(?<=[A-Za-z][A-Za-z0-9]*)-(?=[A-Za-z0-9])/g, " ")
    .replace(/(?<=[A-Za-z0-9])-(?=[0-9]*[A-Za-z])/g, " ");
}

function readAcronyms(text: string): string {
  return text.replace(/(?<![A-Za-z0-9])[A-Z]{2,3}(?![A-Za-z0-9])/g, (word) => letters(word));
}

function cleanSymbols(text: string): string {
  return text
    .replace(/[~∼]/g, " 에서 ")
    .replace(/(?<=\S)-(?=\S)/g, " ")
    .replace(/\s-\s/g, " ")
    .replace(/[/|]/g, " ")
    .replace(/·/g, ", ")
    .replace(/\+/g, " 플러스 ")
    .replace(/&/g, " 앤 ")
    .replace(/%/g, " 퍼센트")
    .replace(/[#*_`]/g, "");
}

/** 화면 글 한 문장을 소리 내어 읽을 글로 바꿉니다. 같은 입력에는 늘 같은 글을 돌려줍니다. */
export function toSpoken(text: string, dictionary: readonly ReadingEntry[] = []): string {
  const entries = sorted(dictionary);
  let out = splitHyphens(text.normalize("NFC"));
  out = applyDictionary(out, entries);
  out = expandRanges(out);
  out = readMonthsAndCounters(out);
  out = readScaledAndUnits(out);
  out = readModelTokens(out, entries);
  // 숫자와 붙어 있어 처음에 못 본 이름("4060Ti" 의 Ti)을 한 번 더 봅니다.
  out = applyDictionary(out, entries);
  out = readPlainNumbers(out);
  out = readAcronyms(out);
  out = cleanSymbols(out);
  return out
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
