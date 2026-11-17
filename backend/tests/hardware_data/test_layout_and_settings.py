"""Regression checks for the move into the shared backend structure."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.db.connection import connection_settings
from app.db.render_erd import ERD
from app.db.schema import SCHEMA_PATH
from app.domains.hardware.ingestion.common import read_json
from app.domains.hardware.ingestion.paths import DATA, REPO_ROOT


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.env = Path(self.directory.name) / ".env"
        self.env_patch = patch("app.db.connection.ENV_PATH", self.env)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_legacy_local_settings_remain_usable(self):
        self.env.write_text("MYSQL_DATABASE=dev_database\nMYSQL_PASSWORD='local-test'\n")
        settings = connection_settings()
        self.assertEqual(settings["database"], "dev_database")
        self.assertEqual(settings["password"], "local-test")
        self.assertNotIn("MYSQL_PASSWORD", os.environ)

    def test_separate_parts_credentials_override_docker_credentials(self):
        self.env.write_text("MYSQL_PASSWORD=docker-test\nPARTS_MYSQL_PASSWORD='literal-${TOKEN}'\n")
        settings = connection_settings()
        self.assertEqual(settings["password"], "literal-${TOKEN}")
        self.assertEqual(settings["port"], 3306)

    def test_process_environment_overrides_dotenv(self):
        self.env.write_text("PARTS_MYSQL_PASSWORD=file-test\nPARTS_MYSQL_PORT=3306\n")
        os.environ.update(PARTS_MYSQL_PASSWORD="process-test", PARTS_MYSQL_PORT="3308")
        settings = connection_settings()
        self.assertEqual(settings["password"], "process-test")
        self.assertEqual(settings["port"], 3308)

    def test_partial_parts_config_cannot_borrow_docker_password(self):
        self.env.write_text("PARTS_MYSQL_HOST=127.0.0.1\nMYSQL_PASSWORD=docker-test\n")
        with self.assertRaisesRegex(ValueError, "PARTS_MYSQL_PASSWORD"):
            connection_settings()

    def test_team_database_cannot_be_used_for_parts_import(self):
        self.env.write_text("PARTS_MYSQL_DATABASE=buildwise\nPARTS_MYSQL_PASSWORD=test\n")
        with self.assertRaisesRegex(ValueError, "dev_database"):
            connection_settings()

    def test_compose_defaults_are_not_parts_credentials(self):
        self.env.write_text("MYSQL_PASSWORD=buildwise\nMYSQL_ROOT_PASSWORD=buildwise-root\n")
        with self.assertRaisesRegex(ValueError, "PARTS_MYSQL"):
            connection_settings()

    def test_invalid_port_and_empty_password_are_rejected(self):
        for port in ("bad", "0", "65536"):
            with self.subTest(port=port):
                self.env.write_text(f"PARTS_MYSQL_PASSWORD=test\nPARTS_MYSQL_PORT={port}\n")
                with self.assertRaisesRegex(ValueError, "PORT"):
                    connection_settings()
        self.env.write_text("PARTS_MYSQL_PASSWORD=''\n")
        with self.assertRaisesRegex(ValueError, "PASSWORD"):
            connection_settings()


class LayoutTests(unittest.TestCase):
    def test_schema_tools_and_erd_are_outside_data(self):
        self.assertEqual(DATA, REPO_ROOT / "data/hardware")
        self.assertTrue(SCHEMA_PATH.is_file())
        self.assertEqual(SCHEMA_PATH.parent, REPO_ROOT / "backend/app/db/sql")
        self.assertTrue(read_json(DATA / "docyx_compatibility.json")["records"])
        self.assertEqual(ERD, REPO_ROOT / "docs/database/erd")
        for extension in ("mmd", "dot", "svg", "png"):
            with self.subTest(extension=extension):
                self.assertTrue((ERD / f"schema.{extension}").is_file())


if __name__ == "__main__":
    unittest.main()
