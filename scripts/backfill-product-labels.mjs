// 이미 저장된 data/history.json의 productBreakdown 설명을 현재 PRODUCT_INFO 매핑으로 다시 입힌다.
// backfill-cwe-labels.mjs와 같은 이유: desc는 배치가 돌 때 history.json에 그대로 박혀 들어가므로,
// PRODUCT_INFO에 새 항목을 추가해도 이미 저장된 과거 기록에는 소급 적용되지 않는다.
//
// 실행: node scripts/backfill-product-labels.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { PRODUCT_INFO } from './product-info.mjs';

const HISTORY_PATH = new URL('../data/history.json', import.meta.url);

const history = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
const changes = [];

for (const entry of history) {
  for (const p of entry.productBreakdown || []) {
    const desc = PRODUCT_INFO[p.key] || '';
    if (p.desc !== desc) {
      changes.push(`${entry.date} productBreakdown ${p.key}: desc 갱신`);
      p.desc = desc;
    }
  }
}

if (changes.length === 0) {
  console.log('[backfill] 바뀔 항목이 없습니다 — 이미 현재 매핑과 같습니다.');
} else {
  writeFileSync(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`);
  console.log(changes.join('\n'));
  console.log(`[backfill] ${changes.length}개 항목을 갱신했습니다.`);
}
