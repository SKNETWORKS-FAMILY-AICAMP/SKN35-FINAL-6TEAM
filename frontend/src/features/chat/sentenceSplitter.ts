/**
 * 답을 읽기 좋은 문장으로 나눕니다. 첫 문장부터 바로 읽고, Chrome 이 긴 발화를 끊는 일도 피합니다.
 * push() 로 조각을 넣어도 한 번에 넣은 것과 같은 결과가 나오게 만들어서, 나중에 서버 스트리밍이 그대로 씁니다.
 */

/** 이보다 짧은 문장은 다음 문장과 합쳐 읽습니다("1.", "네." 같은 조각). */
export const MIN_SENTENCE_CHARS = 12;
/** 이보다 긴 문장은 쉼표(없으면 띄어쓰기)에서 나눕니다. */
export const MAX_SENTENCE_CHARS = 200;

export interface SentenceSplitter {
  /** 끝이 확인된 문장만 돌려줍니다. 끝 문장부호 뒤에 공백이나 줄바꿈이 와야 끝으로 봅니다. */
  push(chunk: string): string[];
  /** 남은 글을 모두 문장으로 돌려주고 비웁니다. */
  flush(): string[];
}

// 문장부호(.!?…) 뒤 공백, 또는 줄바꿈. "2.5GHz", "1,500,000원"은 부호 뒤가 공백이 아니라 끊기지 않습니다.
const BOUNDARY = /[.!?…]+["'”’)\]]*(?=\s)|\n+/gu;

function normalize(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function splitLong(sentence: string): string[] {
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_SENTENCE_CHARS) {
    const window = rest.slice(0, MAX_SENTENCE_CHARS);
    let cut = window.lastIndexOf(", ");
    if (cut < MIN_SENTENCE_CHARS) cut = window.lastIndexOf(" ");
    if (cut < MIN_SENTENCE_CHARS) cut = MAX_SENTENCE_CHARS - 1;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export function createSentenceSplitter(): SentenceSplitter {
  let buffer = "";
  let carry = "";

  function emit(raw: string, out: string[]) {
    const sentence = normalize(carry ? `${carry} ${raw}` : raw);
    if (!sentence) return;
    if (sentence.length < MIN_SENTENCE_CHARS) {
      carry = sentence;
      return;
    }
    carry = "";
    out.push(...splitLong(sentence));
  }

  return {
    push(chunk) {
      buffer += chunk;
      const out: string[] = [];
      let start = 0;
      for (const match of buffer.matchAll(BOUNDARY)) {
        const end = match.index + match[0].length;
        // 줄바꿈이 버퍼 끝에 붙어 있으면 다음 조각에서 줄바꿈이 더 올 수 있지만, 결과는 같으므로 바로 끊습니다.
        emit(buffer.slice(start, end), out);
        start = end;
      }
      buffer = buffer.slice(start);
      return out;
    },
    flush() {
      const out: string[] = [];
      const rest = buffer;
      buffer = "";
      if (normalize(rest)) emit(rest, out);
      if (carry) {
        out.push(...splitLong(carry));
        carry = "";
      }
      return out;
    },
  };
}

export function splitSentences(text: string): string[] {
  const splitter = createSentenceSplitter();
  return [...splitter.push(text), ...splitter.flush()];
}

/** 읽기용 글: 주소와 마크다운 기호를 빼고, 가운뎃점은 쉼표로 읽게 합니다. 화면의 글은 바꾸지 않습니다. */
export function speakable(sentence: string): string {
  return normalize(
    sentence
      .replace(/https?:\/\/\S+/gu, "")
      .replace(/\[\d+\]/gu, "")
      .replace(/[*_`#>]+/gu, "")
      .replace(/^\s*[-•]\s+/gmu, "")
      .replace(/\s*·\s*/gu, ", ")
      .replace(/\(\s*\)/gu, ""),
  );
}
