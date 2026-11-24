import json

import pytest

from app.rag.__main__ import main
from app.rag.evaluate import QUESTIONS
from app.rag.loader import load_corpus
from app.rag.training import TRAINING_PILOT, prepare_training, read_questions


def test_cli_preserves_shared_and_multiple_positives_and_partial_batch(capsys):
    assert main(["prepare-dpr", "--batch-size", "4"]) == 0
    report = json.loads(capsys.readouterr().out)
    rows = read_questions(TRAINING_PILOT)
    batches = report["batches"]
    assert [len(b["questions"]) for b in batches] == [4, 4, 2]
    rebuilt = {
        q["id"]: [batch["passages"][i]["chunk_key"] for i in q["positive_indices"]]
        for batch in batches
        for q in batch["questions"]
    }
    assert rebuilt == {row["id"]: row["gold"] for row in rows}
    assert all(
        len(set(row["chunk_key"] for row in b["passages"])) == len(b["passages"]) for b in batches
    )
    assert len(rebuilt[rows[2]["id"]]) == 2
    corpus = load_corpus()
    reserved = read_questions(QUESTIONS, allow_empty_gold=True)
    excluded = {corpus.chunks[k]["source_key"] for row in reserved for k in row["gold"]}
    for item in report["bm25_candidates_for_review"]:
        keys = [d["chunk_key"] for d in item["candidates"]]
        assert keys and set(keys).isdisjoint(rebuilt[item["id"]])
        assert all(corpus.chunks[key]["source_key"] not in excluded for key in keys)


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"gold": []}, "정답 문단"),
        ({"gold": ["invented"]}, "알 수 없는"),
        ({"gold": ["JINBONG:CHK-FW-002"]}, "평가 자료와 겹치는"),
        ({"question": "Ｍ425R1GB4BB0-CWM   검증 목록 보여줘"}, "중복된 질문"),
    ],
)
def test_bad_training_labels_and_held_out_source_are_rejected(tmp_path, override, message):
    row = {**read_questions(TRAINING_PILOT)[0], **override}
    path = tmp_path / "train.jsonl"
    path.write_text(json.dumps(row), encoding="utf-8")
    with pytest.raises(ValueError, match=message):
        prepare_training(load_corpus(), path, QUESTIONS, 4)
