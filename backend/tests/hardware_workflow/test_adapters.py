"""Offline checks of the live graph's MySQL and Qdrant call contracts."""

from types import SimpleNamespace
from unittest.mock import Mock, call

import pytest
from mysql.connector import Error as MySQLError

from app.domains.hardware.quote_graph import adapters


def test_unused_services_do_not_open_a_database_or_model(monkeypatch):
    for name in ("get_connection", "QdrantClient", "LocalEmbedder"):
        monkeypatch.setattr(adapters, name, lambda **_: pytest.fail("unexpected service access"))
    with adapters.LocalServices():
        pass


@pytest.mark.parametrize(("server", "readonly"), [("MySQL 8", True), ("TiDB v8", None)])
def test_catalog_and_validation_share_one_snapshot(monkeypatch, server, readonly):
    connection = Mock(server_info=server)
    connect = Mock(return_value=connection)
    monkeypatch.setattr(adapters, "get_connection", connect)
    rows = [
        [{"part_id": 7, "category": "cpu"}],
        [{"part_id": 3, "category": "psu"}],
        [{"part_id": 11, "category": "storage"}],
    ]
    read_parts = Mock(side_effect=rows)
    monkeypatch.setattr(adapters, "list_parts", read_parts)
    checks = [
        {
            "check_type": "RAM_QVL",
            "result": "CONDITIONAL",
            "reason": "fixture",
            "compatibility_ids": (20,),
            "source_urls": ["https://fixture.example/QVL"],
        }
    ]
    checker = Mock(return_value={"checks": checks, "parts": [], "quote_id": None})
    monkeypatch.setattr(adapters, "check_catalog_assembly", checker)
    selection = {3: 1, 7: 1, 11: 2}
    options = {"bios_version": "F10", "front_radiator_mm": 240, "other_load_w": 87}
    with adapters.LocalServices() as services:
        result = services.catalog(["psu", "cpu", "psu"], locked_ids=[3, 11, 11])
        assert [part["part_id"] for part in result] == [3, 7, 11]
        assert services.validate(selection, **options) == checks
        assert services.validate({3: 1, 7: 1}, **options) == checks
        connect.assert_called_once_with()
        connection.rollback.assert_not_called()
        connection.close.assert_not_called()

    assert read_parts.call_args_list == [
        call(connection, category="cpu"),
        call(connection, category="psu"),
        call(connection, part_ids=[11]),
    ]
    assert checker.call_args_list == [
        call(connection, selection=selection, **options),
        call(connection, selection={3: 1, 7: 1}, **options),
    ]
    assert connection.method_calls == [
        call.start_transaction(
            isolation_level="REPEATABLE READ",
            consistent_snapshot=True,
            readonly=readonly,
        ),
        call.rollback(),
        call.close(),
    ]


def test_failing_select_rolls_back_and_closes(monkeypatch):
    connection = Mock(server_info="MySQL 8")
    monkeypatch.setattr(adapters, "get_connection", lambda: connection)
    monkeypatch.setattr(adapters, "list_parts", Mock(side_effect=MySQLError("private detail")))
    with (
        pytest.raises(adapters.ServiceUnavailable, match="부품 후보") as caught,
        adapters.LocalServices() as services,
    ):
        services.catalog(["gpu"])
    assert "private detail" not in str(caught.value)
    assert connection.method_calls[-2:] == [call.rollback(), call.close()]
    connection.commit.assert_not_called()


def test_search_uses_cached_encoder_hybrid_filter_and_original_payload(monkeypatch, tmp_path):
    client = Mock()
    client.collection_exists.return_value = True
    client_factory = Mock(return_value=client)
    model = Mock()
    vector = (0.5,) * 384
    model.embed_query.return_value = vector
    encoder = Mock(return_value=model)
    store = Mock()
    payload = {
        "chunk_key": "fixture-chunk",
        "source_key": "fixture-document",
        "source_url": "https://fixture.example/Memory/QVL?Model=A",
        "source_title": "Fixture",
        "links": {"parts": [], "compatibilities": []},
    }
    store.search.side_effect = [[SimpleNamespace(payload=payload, score=0.125)], []]
    store_factory = Mock(return_value=store)
    monkeypatch.setattr(adapters, "QdrantClient", client_factory)
    monkeypatch.setattr(adapters, "LocalEmbedder", encoder)
    monkeypatch.setattr(adapters, "QdrantStore", store_factory)
    monkeypatch.setattr(adapters, "get_connection", lambda: pytest.fail("unexpected MySQL access"))
    cache = tmp_path / "model-cache"
    with adapters.LocalServices(tmp_path, "evidence", cache) as services:
        filters = {"brand": "MSI", "verification_status": "verified"}
        assert services.retrieve("질문", filters) == [{**payload, "score": 0.125}]
        client_factory.assert_called_once_with(path=str(tmp_path))
        store_factory.assert_called_once_with(client, collection="evidence")
        model.embed_query.assert_called_once_with("질문")
        encoder.assert_called_once_with(cache_dir=cache, local_files_only=True)
        store.search.assert_called_once_with(
            "질문", vector, mode="hybrid", filters=filters, limit=5
        )
        client.close.assert_called_once_with()
        assert services.retrieve("다른 질문", {"topic": "absent"}) == []


def test_retrieval_error_is_distinct_from_no_hits(monkeypatch, tmp_path):
    client = Mock()
    client.collection_exists.return_value = True
    monkeypatch.setattr(adapters, "QdrantClient", Mock(return_value=client))
    monkeypatch.setattr(adapters, "LocalEmbedder", Mock(side_effect=OSError("uncached model")))
    with (
        adapters.LocalServices(tmp_path) as services,
        pytest.raises(adapters.ServiceUnavailable, match="임베딩 모델"),
    ):
        services.retrieve("질문", {})
    client.close.assert_called_once_with()
    missing = tmp_path / "no-index"
    with (
        adapters.LocalServices(missing) as services,
        pytest.raises(adapters.ServiceUnavailable, match="색인이 없습니다"),
    ):
        services.retrieve("질문", {})
    assert not missing.exists()
