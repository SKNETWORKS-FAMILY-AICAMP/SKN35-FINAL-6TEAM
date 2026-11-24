"""module 폴더의 테스트에서만 사용하는 연결 기록 fixture."""

import pytest
from flow_report import ModuleFlow


@pytest.fixture
def flow(request):
    return ModuleFlow(request.node)
