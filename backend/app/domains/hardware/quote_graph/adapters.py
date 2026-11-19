"""Read-only local catalog and hybrid evidence search for one quote graph invocation."""

from collections.abc import Iterable, Iterator
from contextlib import ExitStack, closing, contextmanager
from pathlib import Path

from mysql.connector import Error as MySQLError
from mysql.connector.abstracts import MySQLConnectionAbstract
from qdrant_client import QdrantClient

from app.db.catalog import list_parts
from app.db.connection import get_connection
from app.domains.hardware.check_assembly import check_catalog_assembly
from app.rag.__main__ import DEFAULT_INDEX_PATH
from app.rag.embeddings import LocalEmbedder
from app.rag.qdrant_store import DEFAULT_COLLECTION, QdrantStore


class ServiceUnavailable(RuntimeError):
    """A data service could not supply the evidence required by the graph."""


@contextmanager
def _catalog_snapshot() -> Iterator[MySQLConnectionAbstract]:
    with closing(get_connection()) as connection:
        # TiDB provides snapshot isolation and can reject MySQL's READ ONLY clause.
        is_tidb = "tidb" in (connection.server_info or "").casefold()
        connection.start_transaction(
            isolation_level="REPEATABLE READ",
            consistent_snapshot=True,
            readonly=None if is_tidb else True,
        )
        try:
            yield connection
        finally:
            connection.rollback()


class LocalServices:
    """Lazily open the shared parts catalog and query the existing local RAG index."""

    def __init__(
        self,
        path: Path | None = None,
        collection: str = DEFAULT_COLLECTION,
        model_cache: Path | None = None,
    ):
        self.path = path if path is not None else DEFAULT_INDEX_PATH
        self.collection = collection
        self.model_cache = model_cache
        self._stack: ExitStack | None = None
        self._connection: MySQLConnectionAbstract | None = None

    def __enter__(self):
        if self._stack is not None:
            raise RuntimeError("LocalServices is already in use")
        self._stack = ExitStack()
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            self._stack.close()
        except MySQLError, OSError:
            raise ServiceUnavailable("MySQL 카탈로그 스냅샷을 종료할 수 없습니다.") from None
        finally:
            self._connection = None
            self._stack = None

    def _db(self) -> MySQLConnectionAbstract:
        if self._stack is None:
            raise RuntimeError("Use LocalServices as a context manager")
        if self._connection is None:
            try:
                self._connection = self._stack.enter_context(_catalog_snapshot())
            except MySQLError, ValueError, OSError:
                raise ServiceUnavailable("MySQL 부품 카탈로그에 연결할 수 없습니다.") from None
        return self._connection

    def catalog(self, categories: list[str], *, locked_ids: Iterable[int] = ()) -> list[dict]:
        connection = self._db()
        rows_by_id = {}
        try:
            for category in sorted(set(categories)):
                for row in list_parts(connection, category=category):
                    rows_by_id[row["part_id"]] = row
            missing = sorted(set(locked_ids).difference(rows_by_id))
            if missing:
                for row in list_parts(connection, part_ids=missing):
                    rows_by_id[row["part_id"]] = row
        except MySQLError, ValueError, OSError:
            raise ServiceUnavailable("MySQL 부품 후보를 읽을 수 없습니다.") from None
        return [rows_by_id[key] for key in sorted(rows_by_id)]

    def validate(
        self,
        selection: dict[int, int],
        *,
        bios_version: str | None,
        front_radiator_mm: int | None,
        other_load_w: int,
    ) -> list[dict]:
        connection = self._db()
        try:
            result = check_catalog_assembly(
                connection,
                selection=selection,
                bios_version=bios_version,
                front_radiator_mm=front_radiator_mm,
                other_load_w=other_load_w,
            )
        except MySQLError, ValueError, OSError:
            raise ServiceUnavailable("카탈로그 조립 검증 근거를 읽을 수 없습니다.") from None
        return result["checks"]

    def retrieve(self, question: str, filters: dict[str, str]) -> list[dict]:
        if not self.path.is_dir():
            raise ServiceUnavailable("로컬 Qdrant 색인이 없습니다. app.rag index를 실행하세요.")
        try:
            with closing(QdrantClient(path=str(self.path))) as client:
                if not client.collection_exists(self.collection):
                    raise ServiceUnavailable("요청한 로컬 Qdrant 컬렉션을 찾을 수 없습니다.")
                encoder = LocalEmbedder(cache_dir=self.model_cache, local_files_only=True)
                store = QdrantStore(client, collection=self.collection)
                hits = store.search(
                    question, encoder.embed_query(question), mode="hybrid", filters=filters, limit=5
                )
                return [dict(hit.payload, score=hit.score) for hit in hits]
        except ServiceUnavailable:
            raise
        except Exception:
            # Both native ONNX and the local Qdrant backend may raise provider-specific errors.
            raise ServiceUnavailable(
                "로컬 임베딩 모델 또는 Qdrant 검색을 사용할 수 없습니다."
            ) from None
