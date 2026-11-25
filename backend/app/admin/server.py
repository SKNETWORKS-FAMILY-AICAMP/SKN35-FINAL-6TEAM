"""Local admin entry point; preserves the customer entry point."""

from fastapi import FastAPI

from app.admin.routes import router
from app.main import create_app as create_customer_app


def create_app() -> FastAPI:
    """Attach the currently empty admin router to the existing app."""
    app = create_customer_app()
    app.include_router(router)
    return app
