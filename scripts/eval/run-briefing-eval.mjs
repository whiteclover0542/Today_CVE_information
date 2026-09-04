// generateBriefingWithLlm(오늘의 브리핑)의 품질을 평가한다. 아직 운영 데이터에 실제 briefing이
// 없어(신규 기능) golden/briefing.json의 합성 시나리오로 매번 새로 생성해서 채점한다.
// GEMINI_API_KEY 필요(브리핑 생성·G-Eval 심사 둘 다).
// 실행: node scripts/eval/run-briefing-eval.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateBriefingWithLlm } from '../fetch-daily-count.mjs';
import { gEvalMulti } from './geval.mjs';
import { briefingCriteria } from './criteria.mjs';
import { koreanRatio, findUnexpectedCveIds } from './metrics.mjs';
import { saveReport, printTable, markdownTable, fmtScore, mdHeader } from './report.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function statsToInputText(stats) {
  return [
    `오늘(KST) 신규 등록 CVE 총 ${stats.count}건`,
    `심각도별 — 심각 ${stats.severity.critical}건 / 높음 ${stats.severity.high}건 / 중간 ${stats.severity.medium}건 / 낮음 ${stats.severity.low}건 / 평가 대기 ${stats.severity.unrated}건`,
    stats.topCwe ? `가장 많이 나온 취약점 유형(CWE): ${stats.topCwe.label} ${stats.topCwe.count}건` : '오늘은 CWE 유형 집계 대상이 없음',
    stats.topProduct ? `가장 많이 언급된 제품·벤더: ${stats.topProduct.label} ${stats.topProduct.count}건` : '오늘은 특정 제품·벤더가 두드러지지 않음',
  ].join('\n');
}

export async function run() {
  if (!process.env.GEMINI_API_KEY) {
    console.log('[stop] GEMINI_API_KEY 없음 — 브리핑 생성(운영 함수 호출)에는 GEMINI_API_KEYS 풀이 아니라 단일 GEMINI_API_KEY가 필요합니다.');
    return null;
  }

  const golden = JSON.parse(readFileSync(join(__dirname, 'golden', 'briefing.json'), 'utf8'));
  const cases = golden.cases;
  const results = [];

  for (const c of cases) {
    const briefing = await generateBriefingWithLlm(c.stats);
    if (!briefing) {
      results.push({ id: c.id, error: '생성 실패(null) — 카드가 아예 숨겨지는 폴백 케이스', criteria: [] });
      continue;
    }
    const input = statsToInputText(c.stats);
    const criteriaResults = await gEvalMulti({ criteria: briefingCriteria(), input, output: briefing });
    results.push({
      id: c.id,
      note: c.note,
      briefing,
      heuristics: { koreanRatio: koreanRatio(briefing), unexpectedCveIds: findUnexpectedCveIds(briefing, null) },
      criteria: criteriaResults,
    });
    console.log(`[progress] ${results.length}/${cases.length} 완료 — ${c.id}`);
  }

  const criterionNames = briefingCriteria().map((c) => c.criterion);
  const meansByCriterion = {};
  for (const name of criterionNames) {
    const scores = results.flatMap((r) => r.criteria?.filter((cr) => cr.criterion === name).map((cr) => cr.meanScore)).filter((v) => v !== null && v !== undefined);
    meansByCriterion[name] = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  }

  console.log(`\n=== 오늘의 브리핑 품질 평가 (${results.length}건) ===`);
  printTable(
    criterionNames.map((name) => ({ criterion: name, mean: fmtScore(meansByCriterion[name]) })),
    [{ key: 'criterion', label: '기준' }, { key: 'mean', label: '평균 점수(1~5)' }],
  );
  console.log('\n--- 생성된 브리핑 ---');
  for (const r of results) {
    console.log(`  [${r.id}] ${r.briefing || `(생성 실패: ${r.error})`}`);
  }

  const md = [
    mdHeader('오늘의 브리핑 품질 평가'),
    `대상 시나리오: ${results.length}건`,
    ``,
    `## 기준별 평균 점수 (1~5)`,
    ``,
    markdownTable(
      criterionNames.map((name) => ({ criterion: name, mean: fmtScore(meansByCriterion[name]) })),
      [{ key: 'criterion', label: '기준' }, { key: 'mean', label: '평균 점수' }],
    ),
    ``,
    `## 시나리오별 생성 결과`,
    ``,
    markdownTable(
      results.map((r) => ({
        id: r.id,
        note: r.note || '-',
        briefing: r.briefing || `(생성 실패: ${r.error})`,
        scores: (r.criteria || []).map((c) => `${c.criterion}=${fmtScore(c.meanScore)}`).join(', ') || '-',
      })),
      [
        { key: 'id', label: '시나리오' },
        { key: 'note', label: '설명' },
        { key: 'briefing', label: '생성된 브리핑' },
        { key: 'scores', label: '점수' },
      ],
    ),
    ``,
  ].join('\n');

  const { jsonPath, mdPath } = saveReport('briefing', { meansByCriterion, results }, md);
  console.log(`\n[saved] ${jsonPath}`);
  console.log(`[saved] ${mdPath}`);

  return { meansByCriterion, results, jsonPath, mdPath, md };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
