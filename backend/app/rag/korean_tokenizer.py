"""Byte-pair tokenizer trained on local text; every Korean syllable and SKU is encodable."""

import re
import unicodedata
from collections import Counter, defaultdict
from functools import lru_cache
from heapq import heapify, heappop, heappush
from itertools import pairwise

import numpy as np

PAD, CLS, SEP, MASK = range(4)
BYTE_START = 4
MERGE_START = BYTE_START + 256
_PIECES = re.compile(r"[a-z0-9]+(?:[._+\-][a-z0-9]+)*|[가-힣]+|[^\s]")


def _words(text):
    return _PIECES.findall(unicodedata.normalize("NFKC", text).casefold())


def _merge(tokens, pair, new_id):
    result = []
    i = 0
    while i < len(tokens):
        if tokens[i : i + 2] == pair:
            result.append(new_id)
            i += 2
        else:
            result.append(tokens[i])
            i += 1
    return tuple(result)


class KoreanTokenizer:
    def __init__(self, merges):
        self.merges = tuple(tuple(pair) for pair in merges)
        self.vocab_size = MERGE_START + len(merges)
        self._ranks = {pair: i for i, pair in enumerate(self.merges, MERGE_START)}
        self._encode_word = lru_cache(maxsize=32768)(self._word_ids)

    @classmethod
    def fit(cls, texts, max_merges=384):
        counts = Counter(word for text in texts for word in _words(text))
        words = [tuple(b + BYTE_START for b in word.encode()) for word in counts]
        frequencies = list(counts.values())
        # Update only words containing the chosen pair. Counts and lexical tie-breaking
        # are identical to rescanning the full corpus after every merge.
        containing = defaultdict(set)
        pairs = Counter()
        for idx, tokens in enumerate(words):
            for pair in pairwise(tokens):
                containing[pair].add(idx)
                pairs[pair] += frequencies[idx]
        heap = [(-n, pair) for pair, n in pairs.items()]
        heapify(heap)
        merges = []
        for new_id in range(MERGE_START, MERGE_START + max_merges):
            while heap and -heap[0][0] != pairs[heap[0][1]]:
                heappop(heap)
            if not heap or -heap[0][0] < 2:
                break
            _, best = heappop(heap)
            merges.append(best)
            changed = set()
            for idx in tuple(containing[best]):
                before = Counter(pairwise(words[idx]))
                words[idx] = _merge(words[idx], best, new_id)
                after = Counter(pairwise(words[idx]))
                for pair in before.keys() | after.keys():
                    delta = after[pair] - before[pair]
                    if delta:
                        pairs[pair] += frequencies[idx] * delta
                        changed.add(pair)
                    if not after[pair]:
                        containing[pair].discard(idx)
                    elif not before[pair]:
                        containing[pair].add(idx)
            for pair in changed:
                if pairs[pair] >= 2:
                    heappush(heap, (-pairs[pair], pair))
        return cls(merges)

    def _word_ids(self, word):
        ids = tuple(b + BYTE_START for b in word.encode())
        while len(ids) > 1:
            best = min((self._ranks[p] for p in pairwise(ids) if p in self._ranks), default=None)
            if best is None:
                break
            ids = _merge(ids, self.merges[best - MERGE_START], best)
        return ids

    def tokens(self, text):
        return [i for word in _words(text) for i in self._encode_word(word)]

    def encode(self, text, limit):
        if limit < 2:
            raise ValueError("Token limit must include CLS and SEP")
        ids = self.tokens(text)
        return [CLS, *ids[: limit - 2], SEP]

    def batch(self, texts, limit):
        rows = [self.encode(text, limit) for text in texts]
        ids = np.full((len(rows), max(map(len, rows))), PAD, dtype=np.int32)
        for i, row in enumerate(rows):
            ids[i, : len(row)] = row
        return ids
