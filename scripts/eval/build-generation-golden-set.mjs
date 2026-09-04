// data/history.json에 이미 쌓인 실제 대표 CVE 카드(입력+LLM이 만든 출력)에서 CWE 유형·심각도가
// 겹치지 않게 최대한 다양한 표본을 뽑아 생성 품질(번역·해설) 평가용 골든셋을 만든다.
// 실제 운영 출력을 그대로 담기 때문에 "지금 배포된 프롬프트가 만드는 결과가 평균적으로 몇 점인가"를
// 재는 스냅샷 평가에 바로 쓸 수 있고(회귀 감지), --regenerate 옵션으로 같은 입력을 다시 생성해
// "프롬프트를 고친 뒤 점수가 실제로 올랐는가"도 비교할 수 있다.
//
// 실행: node scripts/eval/build-generation-golden-set.mjs [표본 수, 기본 20]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = join(__dirname, '..', '..', 'data', 'history.json');
const OUT_DIR = join(__dirname, 'golden');
const OUT_PATH = join(OUT_DIR, 'generation.json');

const sampleSize = Number(process.argv[2]) || 20;

function main() {
  const history = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
  const all = [];
  for (const entry of history) {
    for (const h of entry.highlights || []) {
      if (!h.summaryEn || !h.summaryKo) continue; // 생성 실패(null)로 남은 건 스킵 — 애초에 평가할 출력이 없음
      // title/interpretation/cause/mitigation/cwe가 아예 없는 건(예: 2026-08-23 등 이 필드들이 도입되기 전 구버전 스키마 기록)
      // "생성이 잘 안 된 사례"가 아니라 "애초에 시도조차 안 한 옛 기록"이라 골든셋에 넣으면 원인을 착각하게 만든다 — 제외.
      if (h.title === undefined || h.interpretation === undefined || h.cause === undefined || h.mitigation === undefined) continue;
      if (!Array.isArray(h.cwe) || h.cwe.length === 0) continue;
      all.push(h);
    }
  }

  // CWE(대표 하나) + 심각도 조합별로 우선 하나씩 뽑아 다양성을 확보하고, 남는 자리는 무작위로 채운다.
  const byBucket = new Map();
  for (const h of all) {
    const bucket = `${h.severity}:${h.cwe?.[0]?.id || 'none'}`;
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push(h);
  }

  const picked = [];
  const pickedIds = new Set();
  for (const list of byBucket.values()) {
    const h = list[0];
    picked.push(h);
    pickedIds.add(h.id);
    if (picked.length >= sampleSize) break;
  }
  for (const h of all) {
    if (picked.length >= sampleSize) break;
    if (pickedIds.has(h.id)) continue;
    picked.push(h);
    pickedIds.add(h.id);
  }

  const cases = picked.map((h) => ({
    id: h.id,
    severity: h.severity,
    summaryEn: h.summaryEn,
    cwe: h.cwe,
    storedOutput: {
      title: h.title,
      summaryKo: h.summaryKo,
      interpretation: h.interpretation,
      cause: h.cause,
      mitigation: h.mitigation,
    },
  }));

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), cases }, null, 2) + '\n');
  console.log(`[saved] ${OUT_PATH} — ${cases.length}건 (전체 후보 ${all.length}건 중 CWE·심각도 다양성 우선 표본)`);
}

main();
