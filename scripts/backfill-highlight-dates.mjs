// 이미 저장된 data/history.json의 highlights에 등록일(date)을 채워 넣는다.
// highlights는 그 entry.date 하루치 NVD 등록분(pubStartDate~pubEndDate)에서만 뽑으므로
// 각 highlight의 등록일은 항상 소속된 entry.date와 같다 — fetch-daily-count.mjs 참고.
//
// 실행: node scripts/backfill-highlight-dates.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const HISTORY_PATH = new URL('../data/history.json', import.meta.url);

const history = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
let changed = 0;

for (const entry of history) {
  for (const h of entry.highlights || []) {
    if (h.date !== entry.date) {
      h.date = entry.date;
      changed += 1;
    }
  }
}

if (changed === 0) {
  console.log('[backfill] 바뀔 항목이 없습니다 — 이미 날짜가 채워져 있습니다.');
} else {
  writeFileSync(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`);
  console.log(`[backfill] ${changed}개 highlight에 등록일을 채웠습니다.`);
}
