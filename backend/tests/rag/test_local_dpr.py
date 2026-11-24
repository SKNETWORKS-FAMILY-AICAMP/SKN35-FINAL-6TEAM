import numpy as np
import pytest

from app.rag.dpr_bert import BertConfig, BertEncoder
from app.rag.korean_tokenizer import CLS, PAD, SEP, KoreanTokenizer
from app.rag.local_dpr import LocalDPR, contrastive_loss


def test_local_subwords_cover_unseen_korean_and_distinguish_part_numbers():
    texts = ["램을 바꿨습니다", "같은 램을 달았어요", "M425R1GB4BB0-CWM"]
    tokenizer = KoreanTokenizer.fit(texts)
    assert tokenizer.merges == KoreanTokenizer.fit(reversed(texts)).merges
    assert tokenizer.encode("뿜", 96) != tokenizer.encode("뽐", 96)
    assert tokenizer.encode("Ｍ425R1GB4BB0-CWM", 96) == tokenizer.encode(texts[2].lower(), 96)
    assert tokenizer.encode(texts[2], 96) != tokenizer.encode(texts[2] + "-V2", 96)
    assert tokenizer.encode(texts[0], 2) == [CLS, SEP]


def test_bidirectional_bert_gradients_match_finite_differences():
    rng = np.random.default_rng(34)
    config = BertConfig(width=8, heads=2, layers=2, intermediate=12, token_limit=8, output=9)
    model = BertEncoder(20, config, rng)
    model.params = {k: v.astype(np.float64) for k, v in model.params.items()}
    ids = np.array([[CLS, 5, 9, SEP], [CLS, 10, SEP, PAD]])
    unit, cache = model.vectors(ids)
    weights = rng.normal(size=unit.shape)
    gradients = model.vector_grad(weights, cache)
    assert set(gradients) == set(model.params)
    for name, param in model.params.items():
        index = np.unravel_index(np.abs(gradients[name]).argmax(), param.shape)
        original = param[index]
        eps = 1e-6
        param[index] = original + eps
        plus = (model.vectors(ids)[0] * weights).sum()
        param[index] = original - eps
        minus = (model.vectors(ids)[0] * weights).sum()
        param[index] = original
        assert gradients[name][index] == pytest.approx((plus - minus) / (2 * eps), abs=2e-6), name
    assert model.vectors(np.pad(ids, ((0, 0), (0, 2))))[0] == pytest.approx(unit)


def test_multi_positive_loss_updates_both_encoders_in_the_right_direction():
    rng = np.random.default_rng(5)
    q, p = rng.normal(size=(2, 4)), rng.normal(size=(3, 4))
    mask = np.array([[True, True, False], [False, True, False]])
    loss, dq, dp = contrastive_loss(q, p, mask, temperature=1)
    assert contrastive_loss(q - 0.01 * dq, p - 0.01 * dp, mask, temperature=1)[0] < loss
    for array, grad in ((q, dq), (p, dp)):
        delta = rng.normal(size=array.shape)
        array += 1e-6 * delta
        plus = contrastive_loss(q, p, mask, temperature=1)[0]
        array -= 2e-6 * delta
        minus = contrastive_loss(q, p, mask, temperature=1)[0]
        array += 1e-6 * delta
        assert (grad * delta).sum() == pytest.approx((plus - minus) / 2e-6, abs=1e-8)


def test_checkpoint_keeps_tokenizer_and_both_independent_encoders(tmp_path):
    tokenizer = KoreanTokenizer.fit(["부품 검색", "부품 교체"])
    rng = np.random.default_rng(9)
    config = BertConfig(width=8, heads=2, layers=1)
    model = LocalDPR(tokenizer, *(BertEncoder(tokenizer.vocab_size, config, rng) for _ in range(2)))
    file = tmp_path / "model.npz"
    model.save(file)
    restored = LocalDPR.load(file)
    assert restored.embed_query("부품") == pytest.approx(model.embed_query("부품"))
    assert next(restored.embed_documents(["부품"])) == pytest.approx(
        next(model.embed_documents(["부품"]))
    )
    assert not np.allclose(restored.embed_query("부품"), next(restored.embed_documents(["부품"])))


def test_reviewed_negative_is_an_extra_slot_only_for_its_question():
    rng = np.random.default_rng(31)
    q, p = rng.normal(size=(3, 4)), rng.normal(size=(4, 4))
    positives = np.array([[True, False, False], [True, False, True], [False, True, False]])
    selected = np.array([2, 3, 3])  # existing in-batch doc; new doc shared by two questions
    loss, dq, dp = contrastive_loss(q, p, positives, 1, negative_indices=selected)
    scores = np.exp(q @ p.T)
    expected = -np.log(
        (scores[:, :3] * positives).sum(1) / (scores[:, :3].sum(1) + scores[np.arange(3), selected])
    ).mean()
    assert loss == pytest.approx(expected)
    for arr, gradient in ((q, dq), (p, dp)):
        delta = rng.normal(size=arr.shape)
        arr += 1e-6 * delta
        plus = contrastive_loss(q, p, positives, 1, negative_indices=selected)[0]
        arr -= 2e-6 * delta
        minus = contrastive_loss(q, p, positives, 1, negative_indices=selected)[0]
        arr += 1e-6 * delta
        assert (gradient * delta).sum() == pytest.approx((plus - minus) / 2e-6, abs=1e-8)
