// 이미 저장된 data/history.json의 CWE 라벨·설명을 현재 CWE_INFO 매핑으로 다시 입힌다.
//
// 라벨과 설명은 프론트가 조회하는 게 아니라 배치가 돌 때 history.json에 그대로 박혀 들어간다.
// 그래서 CWE_INFO에 새 항목을 추가해도 이미 저장된 과거 기록은 계속 ID만 노출된다(예: "CWE-404").
// 이 스크립트는 그 과거 기록에 현재 매핑을 소급 적용한다 — 매핑에 없는 CWE는 배치와 똑같이 ID/빈 값으로 남긴다(위조 금지).
//
// 실행: node scripts/backfill-cwe-labels.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { CWE_INFO } from './cwe-info.mjs';

const HISTORY_PATH = new URL('../data/history.json', import.meta.url);

const history = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
const changes = [];

for (const entry of history) {
  for (const c of entry.cweBreakdown || []) {
    if (c.key === 'none') continue; // "CWE 미분류"는 매핑 대상이 아니라 배치가 직접 넣는 고정 문구
    const info = CWE_INFO[c.key];
    const label = info?.label || c.key;
    const desc = info?.hint || '';
    if (c.label !== label || c.desc !== desc) {
      changes.push(`${entry.date} cweBreakdown ${c.key}: ${c.label} → ${label}`);
      c.label = label;
      c.desc = desc;
    }
  }

  for (const h of entry.highlights || []) {
    for (const c of h.cwe || []) {
      const info = CWE_INFO[c.id];
      const label = info?.label || null;
      const hint = info?.hint || null;
      if (c.label !== label || c.hint !== hint) {
        changes.push(`${entry.date} ${h.id} ${c.id}: ${c.label} → ${label}`);
        c.label = label;
        c.hint = hint;
      }
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
