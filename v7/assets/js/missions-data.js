// 지각 모드 미션 데이터. 미션 추가 = 배열에 한 줄 추가.
// building: campus.json의 OSM 건물 이름. 미션 위치는 그 건물 중심에서 가장 가까운 차도 위 점(late-mode.js에서 계산).
// final: true인 항목이 마지막 목적지 (원 안에 들어오기만 하면 도착).
export const MISSIONS = [
  { id: 'sweetpotato', building: '농생대 1호관', label: '농생대 1호관', title: '고구마 수확', line: '고구마를 한가득 캤다!', emoji: '🍠', radius: 7 },
  { id: 'library', building: '중앙도서관', label: '중앙도서관', title: '연체된 책 반납', line: '연체된 책 반납 완료… 연체료는 못 본 걸로.', emoji: '📚', radius: 7 },
  { id: 'coffee', building: '제1학생마루', label: '제1학생회관', title: '아이스 아메리카노 주문', line: '아아 한 잔 테이크아웃!', emoji: '☕', radius: 7 },
  { id: 'laptop', building: '생활관 9C동 예향학사', label: '생활관 9호관', title: '두고 온 노트북 챙기기', line: '노트북 챙겼다! 충전기도!', emoji: '💻', radius: 7 },
  { id: 'class', building: '공과대 2호관', label: '공과대 2호관', title: '강의실 도착', line: '', emoji: '🏫', radius: 9, final: true },
];
