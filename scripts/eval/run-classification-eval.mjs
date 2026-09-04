// 유형(카테고리) 분류 파이프라인(규칙 매칭 → '기타'만 LLM 재분류) 전체를 골든셋으로 채점한다.
// 운영 코드(fetch-daily-count.mjs)를 그대로 import해서 쓰기 때문에, 로직을 따로 베껴 적어서
// 실제 배포 코드와 평가 대상이 어긋나는 일이 없다.
//
// 실행: node scripts/eval/run-classification-eval.mjs
// (사전 준비) node scripts/eval/build-classification-golden-set.mjs 로 골든셋을 먼저 만들어야 함.
// GEMINI_API_KEY가 없으면 LLM 재분류 단계는 자동으로 건너뛰고 규칙 매칭만으로 채점한다(그 자체로도 유의미한 기준선).
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { categorize, classifyOthersWithLlm } from '../fetch-daily-count.mjs';
import { classificationMetrics } from './metrics.mjs';
import { saveReport, printTable, markdownTable, fmtScore, mdHeader } from './report.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(__dirname, 'golden', 'classification.json');

// run-all.mjs가 이 결과를 통합 리포트에 다시 쓸 수 있도록 main 로직을 run()으로 분리해 내보낸다.
export async function run() {
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
  const cases = golden.cases;
  if (cases.length === 0) {
    console.log('[skip] 골든셋이 비어 있음 — build-classification-golden-set.mjs를 먼저 실행하세요.');
    return null;
  }

  const predictedByCase = new Map();
  const otherStageItems = [];
  for (const c of cases) {
    const ruleKey = categorize(c.description);
    predictedByCase.set(c.id, ruleKey);
    if (ruleKey === 'other') otherStageItems.push({ id: c.id, desc: c.description });
  }

  const reclassified = await classifyOthersWithLlm(otherStageItems);
  for (const [id, key] of Object.entries(reclassified)) {
    predictedByCase.set(id, key);
  }

  const predictions = cases.map((c) => predictedByCase.get(c.id));
  const goldens = cases.map((c) => c.expectedCategoryKey);
  const overall = classificationMetrics(predictions, goldens);

  // '기타 재분류' 단계 자체의 기여만 따로 본다 — 규칙 매칭이 이미 맞힌 건 LLM 몫이 아니므로 분리해서 봐야 실제 효과를 안다.
  const otherIds = new Set(otherStageItems.map((o) => o.id));
  const otherIdx = cases.map((c, i) => i).filter((i) => otherIds.has(cases[i].id));
  const otherSubset = classificationMetrics(otherIdx.map((i) => predictions[i]), otherIdx.map((i) => goldens[i]));

  console.log(`\n=== 분류 평가 (전체 ${overall.n}건) ===`);
  console.log(`정확도(accuracy): ${fmtScore(overall.accuracy)}   macro-F1: ${fmtScore(overall.macroF1)}`);
  console.log(`\n--- '기타' 단계(LLM 재분류 대상)만: ${otherSubset.n}건 ---`);
  console.log(`정확도(accuracy): ${fmtScore(otherSubset.accuracy)}   macro-F1: ${fmtScore(otherSubset.macroF1)}`);

  const mismatches = cases
    .map((c, i) => ({ c, predicted: predictions[i], golden: goldens[i] }))
    .filter((r) => r.predicted !== r.golden);

  if (mismatches.length > 0) {
    console.log(`\n--- 오분류 ${mismatches.length}건 ---`);
    printTable(
      mismatches.map((m) => ({ id: m.c.id, cwe: m.c.primaryCwe, expected: m.golden, predicted: m.predicted })),
      [
        { key: 'id', label: 'CVE ID' },
        { key: 'cwe', label: '근거 CWE' },
        { key: 'expected', label: '정답' },
        { key: 'predicted', label: '예측' },
      ],
    );
  } else {
    console.log('\n오분류 없음.');
  }

  const md = [
    mdHeader('분류(카테고리) 평가 리포트'),
    `## 요약`,
    ``,
    `- 전체 ${overall.n}건 — 정확도 **${fmtScore(overall.accuracy)}**, macro-F1 **${fmtScore(overall.macroF1)}**`,
    `- '기타' 재분류 단계만(${otherSubset.n}건) — 정확도 **${fmtScore(otherSubset.accuracy)}**, macro-F1 **${fmtScore(otherSubset.macroF1)}**`,
    ``,
    `## 오분류 ${mismatches.length}건`,
    ``,
    markdownTable(
      mismatches.map((m) => ({ id: m.c.id, cwe: m.c.primaryCwe, expected: m.golden, predicted: m.predicted })),
      [
        { key: 'id', label: 'CVE ID' },
        { key: 'cwe', label: '근거 CWE' },
        { key: 'expected', label: '정답' },
        { key: 'predicted', label: '예측' },
      ],
    ),
    ``,
  ].join('\n');

  const { jsonPath, mdPath } = saveReport('classification', { overall, otherStageOnly: otherSubset, mismatches, generatedAt: new Date().toISOString() }, md);
  console.log(`\n[saved] ${jsonPath}`);
  console.log(`[saved] ${mdPath}`);

  return { overall, otherSubset, mismatches, jsonPath, mdPath, md };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
