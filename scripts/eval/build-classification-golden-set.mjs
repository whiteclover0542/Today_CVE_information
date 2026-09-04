// data/history.json에 이미 쌓인 실제 대표 CVE(highlights)를 훑어서, CWE 기반 정답이 확실한
// 건만 골라 분류(카테고리) 평가용 골든셋을 만든다. 사람이 하나씩 라벨을 새로 붙이는 대신
// NVD 공식 CWE 분류 + cwe-category-truth.mjs 매핑을 정답으로 쓰기 때문에 재현 가능하고 객관적이다.
//
// 실행: node scripts/eval/build-classification-golden-set.mjs
// 출력: scripts/eval/golden/classification.json (매번 history.json 기준으로 덮어씀)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CATEGORY_RULES } from '../fetch-daily-count.mjs';
import { CWE_CATEGORY_TRUTH } from './cwe-category-truth.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = join(__dirname, '..', '..', 'data', 'history.json');
const OUT_DIR = join(__dirname, 'golden');
const OUT_PATH = join(OUT_DIR, 'classification.json');

const LABEL_TO_KEY = Object.fromEntries(CATEGORY_RULES.map((r) => [r.label, r.key]));
LABEL_TO_KEY['기타'] = 'other';

function main() {
  const history = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
  const cases = [];
  const seen = new Set();

  for (const entry of history) {
    for (const h of entry.highlights || []) {
      if (seen.has(h.id)) continue; // 같은 CVE가 여러 날 기록에 중복될 일은 없지만 방어적으로
      if (!h.summaryEn || !h.cwe?.length) continue;

      const primaryCwe = h.cwe[0].id;
      const expectedCategoryKey = CWE_CATEGORY_TRUTH[primaryCwe];
      if (!expectedCategoryKey) continue; // 애매해서 정답표에서 뺀 CWE는 골든셋에도 안 넣음

      const actualCategoryKey = LABEL_TO_KEY[h.category];
      if (!actualCategoryKey) continue; // 라벨을 못 찾으면(구버전 기록 등) 스킵

      seen.add(h.id);
      cases.push({
        id: h.id,
        description: h.summaryEn,
        primaryCwe,
        expectedCategoryKey,
        actualCategoryKeyInHistory: actualCategoryKey, // 참고용(현재 배포본이 이미 어떻게 판단했는지)
      });
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), cases }, null, 2) + '\n');
  console.log(`[saved] ${OUT_PATH} — ${cases.length}건 (history ${history.length}일치 중 CWE 정답 매핑 가능한 것만)`);
}

main();
