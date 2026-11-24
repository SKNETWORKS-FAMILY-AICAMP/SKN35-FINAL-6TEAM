import json
from collections import Counter
from itertools import pairwise

import pytest

from app.rag.korean_tokenizer import BYTE_START, MERGE_START, KoreanTokenizer, _merge, _words
from app.rag.korquad import Example, load_split, passage_tokens, positive_window


def test_incremental_bpe_preserves_counts_ties_and_encoding():
    texts = ["하하하하 램을 A100", "하하 램을", "aaaa aaa 100", "묻고 또 묻고"]
    counts = Counter(w for text in texts for w in _words(text))
    slow = {tuple(b + BYTE_START for b in w.encode()): n for w, n in counts.items()}
    merges = []
    for token in range(MERGE_START, MERGE_START + 80):
        pairs = Counter()
        for seq, n in slow.items():
            for pair in pairwise(seq):
                pairs[pair] += n
        if not pairs:
            break
        best = min(pairs, key=lambda k: (-pairs[k], k))
        if pairs[best] < 2:
            break
        merges.append(best)
        slow = {_merge(seq, best, token): n for seq, n in slow.items()}
    tokenizer = KoreanTokenizer.fit(texts, 80)
    assert tokenizer.merges == tuple(merges)
    for word in [*counts, "처음보는A100"]:
        for piece in _words(word):
            ids = tuple(b + BYTE_START for b in piece.encode())
            for token, pair in enumerate(merges, MERGE_START):
                ids = _merge(ids, pair, token)
            assert tokenizer.tokens(piece) == list(ids)


def test_positive_crop_uses_original_character_offsets():
    tokenizer = KoreanTokenizer.fit(["시작 끝 ＡＢＣ１２３"], 10)
    text = ("시작 " * 80) + "ＡＢＣ１２３ 끝"
    example = Example("test", "test", 0, text.index("Ａ"), text.index(" 끝"))
    ids, starts, ends = passage_tokens(tokenizer, text)
    assert ids == tokenizer.tokens(text)
    row, fits = positive_window(ids, starts, ends, example, 14)
    assert fits
    expected = tokenizer.tokens("ＡＢＣ１２３")
    assert any(row[i : i + len(expected)] == expected for i in range(len(row)))
    assert len(row) <= 16


def test_loader_keeps_all_questions_and_rejects_bad_gold(tmp_path):
    qa = {"id": "q1", "question": "어떤 단어?", "answers": [{"answer_start": 0, "text": "문단"}]}
    p = {"context": "문단 예시", "qas": [qa]}
    p2 = {"context": p["context"], "qas": [{**qa, "id": "q2"}]}
    data = {"data": [{"paragraphs": [p, p2]}]}
    file = tmp_path / "split.json"
    file.write_text(json.dumps(data), encoding="utf8")
    split = load_split(file)
    assert len(split.examples) == 2 and len(split.contexts) == 1
    qa["answers"][0]["answer_start"] = 1
    file.write_text(json.dumps(data), encoding="utf8")
    with pytest.raises(ValueError, match="answer span"):
        load_split(file)
