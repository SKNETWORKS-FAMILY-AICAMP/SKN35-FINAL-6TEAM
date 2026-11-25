import { describe, expect, it } from "vitest";
import { sinoNumber, toSpoken, type ReadingEntry } from "./speechText";

// 백엔드 domains 사전의 일부. 실제 사전은 음성 경로가 내려 줍니다.
const DICT: ReadingEntry[] = [
  { text: "RTX", spoken: "알티엑스", prefix: true },
  { text: "RX", spoken: "알엑스", prefix: true },
  { text: "GeForce", spoken: "지포스" },
  { text: "Ti", spoken: "티아이" },
  { text: "XT", spoken: "엑스티" },
  { text: "Ryzen 7", spoken: "라이젠 세븐" },
  { text: "Ryzen", spoken: "라이젠" },
  { text: "Core Ultra 7", spoken: "코어 울트라 세븐" },
  { text: "i5", spoken: "아이파이브" },
  { text: "X3D", spoken: "엑스쓰리디" },
  { text: "DDR5", spoken: "디디알 파이브" },
  { text: "GDDR6X", spoken: "지디디알 식스엑스" },
  { text: "GDDR6", spoken: "지디디알 식스" },
  { text: "M.2", spoken: "엠닷투" },
  { text: "NVMe", spoken: "엔브이엠이" },
  { text: "SSD", spoken: "에스에스디" },
  { text: "PCIe", spoken: "피씨아이이" },
  { text: "80 PLUS", spoken: "팔십 플러스" },
  { text: "Gold", spoken: "골드" },
  { text: "Titanium", spoken: "티타늄" },
  { text: "4K", spoken: "포케이" },
  { text: "QHD", spoken: "큐에이치디" },
];

const say = (text: string) => toSpoken(text, DICT);

describe("sinoNumber", () => {
  it.each([
    [0, "영"],
    [1, "일"],
    [10, "십"],
    [11, "십일"],
    [100, "백"],
    [1500, "천오백"],
    [10_000, "만"],
    [11_000, "만 천"],
    [1_800_000, "백팔십만"],
    [100_000_000, "일억"],
    [120_000_000, "일억 이천만"],
    [2025, "이천이십오"],
  ])("%d → %s", (value, spoken) => {
    expect(sinoNumber(value)).toBe(spoken);
  });
});

describe("toSpoken", () => {
  it.each([
    // 상품 이름과 모델 번호
    ["RTX 5070 Ti 를 추천해요.", "알티엑스 오공칠공 티아이 를 추천해요."],
    ["RTX4090 이면 충분해요.", "알티엑스 사공구공 이면 충분해요."],
    ["RTX 4060Ti 도 있어요.", "알티엑스 사공육공 티아이 도 있어요."],
    ["RX 9070 XT", "알엑스 구공칠공 엑스티"],
    ["GeForce RTX 5080", "지포스 알티엑스 오공팔공"],
    ["Ryzen 7 9800X3D", "라이젠 세븐 구팔공공 엑스쓰리디"],
    ["i5-14600K 가 좋아요.", "아이파이브 일사육공공 케이 가 좋아요."],
    ["Core Ultra 7 265K", "코어 울트라 세븐 이육오 케이"],
    ["B650 보드", "비 육오공 보드"],
    ["PCIe 4.0 x16 슬롯", "피씨아이이 사 점 영 엑스 십육 슬롯"],
    ["DDR5-6000 32GB", "디디알 파이브 육천 삼십이 기가"],
    ["GDDR6X 메모리", "지디디알 식스엑스 메모리"],
    ["M.2 NVMe SSD 1TB", "엠닷투 엔브이엠이 에스에스디 일 테라"],
    ["80 PLUS Gold 850W", "팔십 플러스 골드 팔백오십 와트"],
    ["Titanium 등급", "티타늄 등급"],
    ["4K 와 QHD", "포케이 와 큐에이치디"],
    // 같은 숫자라도 모델 번호가 아니면 한자어
    ["RTX 5070 Ti / 5070원", "알티엑스 오공칠공 티아이 오천칠십 원"],
    ["2025년에 나왔어요.", "이천이십오 년에 나왔어요."],
    ["1500 정도면 돼요.", "천오백 정도면 돼요."],
    // 돈
    ["총 1,800,000원입니다.", "총 백팔십만 원입니다."],
    ["180만 원이에요.", "백팔십만 원이에요."],
    ["1억 2천만 원", "일억 이천만 원"],
    ["1.2만 원 차이", "만 이천 원 차이"],
    ["3천 원", "삼천 원"],
    // 범위는 단위를 양쪽에
    ["5~10만 원 차이", "오만 원에서 십만 원 차이"],
    ["80~90만 원", "팔십만 원에서 구십만 원"],
    ["2~3개 정도", "두 개에서 세 개 정도"],
    ["60~144Hz", "육십 헤르츠에서 백사십사 헤르츠"],
    ["10-20만 원", "십만 원에서 이십만 원"],
    // 고유어 수사와 그 경계
    ["2개 있어요.", "두 개 있어요."],
    ["1개만", "한 개만"],
    ["3시에 와요.", "세 시에 와요."],
    ["24시간 운영", "스물네 시간 운영"],
    ["2번째 슬롯", "두 번째 슬롯"],
    ["20개", "스무 개"],
    ["2대", "두 대"],
    ["20대 게이머", "이십 대 게이머"],
    ["12개월 보증", "십이 개월 보증"],
    ["2번 슬롯", "이 번 슬롯"],
    ["15시", "십오 시"],
    // 날짜
    ["6월 10일", "유월 십 일"],
    ["10월에", "시월에"],
    // 단위, 소수, 부호
    ["3.05GHz", "삼 점 영오 기가헤르츠"],
    ["144Hz 모니터", "백사십사 헤르츠 모니터"],
    ["성능이 10% 올라요.", "성능이 십 퍼센트 올라요."],
    ["-5% 차이", "마이너스 오 퍼센트 차이"],
    ["온도는 70℃ 안쪽", "온도는 칠십 도 안쪽"],
    ["120mm 팬", "백이십 밀리 팬"],
    // 약어와 기호
    ["PC 와 USB", "피씨 와 유에스비"],
    ["CPU·GPU", "씨피유, 지피유"],
    // 조사는 붙여 둡니다
    ["CPU는 좋아요.", "씨피유는 좋아요."],
    ["14600K가 빨라요.", "일사육공공 케이가 빨라요."],
    ["RTX 5070을 추천해요.", "알티엑스 오공칠공을 추천해요."],
  ])("%s", (text, spoken) => {
    expect(say(text)).toBe(spoken);
  });

  it("works without a dictionary using general rules only", () => {
    expect(toSpoken("850W 파워, 1,800,000원")).toBe("팔백오십 와트 파워, 백팔십만 원");
    expect(toSpoken("RTX 5070")).toBe("알티엑스 오천칠십");
  });

  it("is deterministic so prefetch and playback use the same text", () => {
    const text = "RTX 5070 Ti 는 90만 원대예요.";
    expect(say(text)).toBe(say(text));
  });

  it("leaves Korean sentences without numbers or Latin alone", () => {
    expect(say("네, 잠시만요.")).toBe("네, 잠시만요.");
  });
});
