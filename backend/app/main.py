"""FastAPI entry point for the public parts catalog and PC consultations (single worker)."""

from contextlib import closing

from fastapi import FastAPI
from mysql.connector import Error as MySQLError

from app.api.pc_consult import router
from app.api.pc_sessions import GuestSessions
from app.contracts.schemas import HealthOut
from app.db.connection import get_connection
from app.domains.hardware.pc_consultation.parts_db import SHOP_COMPANY_ID


def create_app() -> FastAPI:
    app = FastAPI(
        title="BUILDWISE PC 상담 API", version="0.2.0", separate_input_output_schemas=False
    )
    app.state.pc_sessions = GuestSessions(SHOP_COMPANY_ID)
    app.include_router(router)

    @app.get("/api/health", response_model=HealthOut, tags=["system"])
    def health() -> HealthOut:
        try:
            with closing(get_connection()) as connection:
                connection.ping()
        except MySQLError, ValueError, OSError:
            return HealthOut(status="degraded", mode="catalog", database="unreachable")
        return HealthOut(status="ok", mode="catalog", database="ok")

    return app


app = create_app()
