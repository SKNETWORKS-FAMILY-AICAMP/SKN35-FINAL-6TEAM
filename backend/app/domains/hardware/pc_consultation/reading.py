"""PC 부품 이름을 소리 내어 읽는 법. 음성 읽기 경로가 프론트로 내려 줍니다.

prefix=True 인 이름 바로 뒤의 숫자는 한 자리씩 읽습니다("RTX 5070" → "알티엑스 오공칠공").
영문과 붙은 숫자("14700K", "9800X3D")는 프론트 규칙이 따로 한 자리씩 읽습니다.
"""

from app.contracts.voice import ReadingEntry

_READINGS: tuple[tuple[str, str, bool], ...] = (
    # 그래픽카드
    ("GeForce", "지포스", False),
    ("RTX", "알티엑스", True),
    ("GTX", "지티엑스", True),
    ("Radeon", "라데온", False),
    ("RX", "알엑스", True),
    ("Arc", "아크", False),
    ("Ti", "티아이", False),
    ("SUPER", "슈퍼", False),
    ("XTX", "엑스티엑스", False),
    ("XT", "엑스티", False),
    ("NVIDIA", "엔비디아", False),
    ("DLSS", "디엘에스에스", False),
    # CPU
    ("Ryzen 3", "라이젠 쓰리", False),
    ("Ryzen 5", "라이젠 파이브", False),
    ("Ryzen 7", "라이젠 세븐", False),
    ("Ryzen 9", "라이젠 나인", False),
    ("Ryzen", "라이젠", False),
    ("Threadripper", "스레드리퍼", False),
    ("Core Ultra 5", "코어 울트라 파이브", False),
    ("Core Ultra 7", "코어 울트라 세븐", False),
    ("Core Ultra 9", "코어 울트라 나인", False),
    ("Core Ultra", "코어 울트라", False),
    ("Core", "코어", False),
    ("i3", "아이쓰리", False),
    ("i5", "아이파이브", False),
    ("i7", "아이세븐", False),
    ("i9", "아이나인", False),
    ("X3D", "엑스쓰리디", False),
    ("Intel", "인텔", False),
    ("AMD", "에이엠디", False),
    # 메모리·저장장치
    ("GDDR6X", "지디디알 식스엑스", False),
    ("GDDR6", "지디디알 식스", False),
    ("GDDR7", "지디디알 세븐", False),
    ("DDR4", "디디알 포", False),
    ("DDR5", "디디알 파이브", False),
    ("NVMe", "엔브이엠이", False),
    ("M.2", "엠닷투", False),
    ("SSD", "에스에스디", False),
    ("HDD", "에이치디디", False),
    ("SATA", "사타", False),
    ("PCIe", "피씨아이이", False),
    ("Gen4", "젠 포", False),
    ("Gen5", "젠 파이브", False),
    # 보드·케이스·파워
    ("Micro-ATX", "마이크로 에이티엑스", False),
    ("mATX", "마이크로 에이티엑스", False),
    ("Mini-ITX", "미니 아이티엑스", False),
    ("ATX", "에이티엑스", False),
    ("ITX", "아이티엑스", False),
    ("80 PLUS", "팔십 플러스", False),
    ("Bronze", "브론즈", False),
    ("Gold", "골드", False),
    ("Platinum", "플래티넘", False),
    ("Titanium", "티타늄", False),
    # 일반 약어
    ("CPU", "씨피유", False),
    ("GPU", "지피유", False),
    ("VRAM", "브이램", False),
    ("RAM", "램", False),
    ("PSU", "파워", False),
    ("TDP", "티디피", False),
    ("AIO", "일체형 수랭", False),
    ("FHD", "에프에이치디", False),
    ("QHD", "큐에이치디", False),
    ("UHD", "유에이치디", False),
    ("4K", "포케이", False),
    ("OLED", "올레드", False),
    ("RGB", "알지비", False),
    ("HDMI", "에이치디엠아이", False),
    ("DisplayPort", "디스플레이포트", False),
    ("Wi-Fi", "와이파이", False),
    ("Bluetooth", "블루투스", False),
)


def reading_dictionary() -> list[ReadingEntry]:
    return [ReadingEntry(text=t, spoken=s, prefix=p) for t, s, p in _READINGS]
