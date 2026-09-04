// 대표 CVE 카드 생성(explainHighlightWithLlm: 번역+해석+원인+방지법)의 품질을 평가한다.
// 두 가지 모드:
//   node scripts/eval/run-generation-eval.mjs                golden/generation.json(실 운영 출력 스냅샷) 채점
//   node scripts/eval/run-generation-eval.mjs --regenerate    같은 입력으로 지금 프롬프트로 다시 생성해서 채점(회귀 비교용)
//   node scripts/eval/run-generation-eval.mjs --calibration   golden/calibration.json(good/bad 손 라벨) 채점 — 심사 모델 자체 검증용
//
// 사전 준비: node scripts/eval/build-generation-golden-set.mjs (일반 모드일 때만 필요)
// GEMINI_API_KEY 필요(생성 재현·G-Eval 심사 둘 다 — geval.mjs도 Gemini를 심사 모델로 씀). 없으면 즉시 안내하고 종료.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { explainHighlightWithLlm } from '../fetch-daily-count.mjs';
import { gEvalMulti } from './geval.mjs';
import { explainCriteria } from './criteria.mjs';
import { koreanRatio, findUnexpectedCveIds, isEmptyField, lengthFlag } from './metrics.mjs';
import { saveReport, printTable, markdownTable, fmtScore, mdHeader } from './report.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCases(calibration) {
  if (calibration) {
    const golden = JSON.parse(readFileSync(join(__dirname, 'golden', 'calibration.json'), 'utf8'));
    return golden.cases.map((c) => ({ id: c.id, label: c.label, summaryEn: c.summaryEn, cwe: c.cwe, output: c.output, note: c.note }));
  }
  const golden = JSON.parse(readFileSync(join(__dirname, 'golden', 'generation.json'), 'utf8'));
  return golden.cases.map((c) => ({ id: c.id, severity: c.severity, summaryEn: c.summaryEn, cwe: c.cwe, output: c.storedOutput }));
}

function buildInputText(summaryEn, cweList) {
  const cweLines = (cweList || []).map((c) => `${c.id} (${c.label || '라벨 없음'}): ${c.hint || '설명 없음'}`).join('\n');
  return `영문 원문: ${summaryEn}\n\nCWE 근거:\n${cweLines || '(없음)'}`;
}

function buildOutputText(output) {
  if (!output) return '';
  return [
    `title: ${output.title ?? ''}`,
    `summaryKo: ${output.summaryKo ?? ''}`,
    `interpretation: ${output.interpretation ?? ''}`,
    `cause: ${output.cause ?? ''}`,
    `mitigation: ${output.mitigation ?? ''}`,
  ].join('\n');
}

export async function run({ regenerate = false, calibration = false } = {}) {
  if (!process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEYS) {
    console.log('[stop] GEMINI_API_KEY(S) 없음 — 생성 품질 평가는 심사 모델 호출이 필수라 진행할 수 없습니다.');
    return null;
  }

  const cases = loadCases(calibration);
  if (cases.length === 0) {
    console.log('[skip] 골든셋이 비어 있습니다. build-generation-golden-set.mjs를 먼저 실행하세요.');
    return null;
  }

  const results = [];
  for (const c of cases) {
    let output = c.output;
    if (regenerate && !calibration) {
      output = await explainHighlightWithLlm(c.summaryEn, c.cwe);
      if (!output) {
        results.push({ id: c.id, error: '생성 실패(null 반환) — 원문만 노출되는 폴백 케이스', criteria: [], heuristics: null });
        continue;
      }
    }

    const heuristics = {
      koreanRatioSummary: koreanRatio(output.summaryKo),
      koreanRatioInterpretation: koreanRatio(output.interpretation),
      unexpectedCveIds: findUnexpectedCveIds(buildOutputText(output), c.id),
      emptyTitle: isEmptyField(output.title),
      emptySummary: isEmptyField(output.summaryKo),
      lengthFlagInterpretation: lengthFlag(output.interpretation, { min: 5, max: 300 }),
    };

    const input = buildInputText(c.summaryEn, c.cwe);
    const outputText = buildOutputText(output);
    const criteriaResults = await gEvalMulti({ criteria: explainCriteria(), input, output: outputText });

    results.push({ id: c.id, label: c.label, note: c.note, heuristics, criteria: criteriaResults });
    console.log(`[progress] ${results.length}/${cases.length} 완료 — ${c.id}`); // 케이스당 십수 초가 걸려 전체 완료까지 조용히 있으면 멈춘 것처럼 보이므로 진행 상황을 남김
  }

  const criterionNames = explainCriteria().map((c) => c.criterion);
  const meansByCriterion = {};
  for (const name of criterionNames) {
    const scores = results.flatMap((r) => r.criteria?.filter((cr) => cr.criterion === name).map((cr) => cr.meanScore)).filter((v) => v !== null && v !== undefined);
    meansByCriterion[name] = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  }

  console.log(`\n=== 생성 품질 평가 (${calibration ? '심사 모델 검증용 calibration' : regenerate ? '재생성' : '운영 출력 스냅샷'}, ${results.length}건) ===`);
  printTable(
    criterionNames.map((name) => ({ criterion: name, mean: fmtScore(meansByCriterion[name]) })),
    [{ key: 'criterion', label: '기준' }, { key: 'mean', label: '평균 점수(1~5)' }],
  );

  const flagThreshold = 3;
  const flagged = results.filter((r) => r.criteria?.some((c) => c.meanScore !== null && c.meanScore < flagThreshold) || r.heuristics?.unexpectedCveIds?.length);
  if (flagged.length > 0) {
    console.log(`\n--- 점검 필요 ${flagged.length}건 (기준 미달 또는 낯선 CVE ID 등장) ---`);
    for (const r of flagged) {
      const low = (r.criteria || []).filter((c) => c.meanScore !== null && c.meanScore < flagThreshold).map((c) => `${c.criterion}=${fmtScore(c.meanScore)}`).join(', ');
      console.log(`  ${r.id}${r.label ? ` [${r.label}]` : ''}: ${low}${r.heuristics?.unexpectedCveIds?.length ? ` / 낯선 CVE 언급: ${r.heuristics.unexpectedCveIds.join(',')}` : ''}`);
    }
  }

  if (calibration) {
    const goodMean = (name) => {
      const vals = results.filter((r) => r.label === 'good').flatMap((r) => r.criteria.filter((c) => c.criterion === name).map((c) => c.meanScore)).filter((v) => v !== null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const badMean = (name) => {
      const vals = results.filter((r) => r.label === 'bad').flatMap((r) => r.criteria.filter((c) => c.criterion === name).map((c) => c.meanScore)).filter((v) => v !== null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    console.log('\n--- 심사 모델 판별력(good vs bad, 격차가 클수록 심사 모델을 신뢰할 수 있음) ---');
    printTable(
      criterionNames.map((name) => ({ criterion: name, good: fmtScore(goodMean(name)), bad: fmtScore(badMean(name)) })),
      [{ key: 'criterion', label: '기준' }, { key: 'good', label: 'good 평균' }, { key: 'bad', label: 'bad 평균' }],
    );
  }

  const md = [
    mdHeader(`생성 품질 평가 — ${calibration ? '심사 모델 검증(calibration)' : regenerate ? '재생성' : '운영 출력 스냅샷'}`),
    `대상: ${results.length}건`,
    ``,
    `## 기준별 평균 점수 (1~5)`,
    ``,
    markdownTable(
      criterionNames.map((name) => ({ criterion: name, mean: fmtScore(meansByCriterion[name]) })),
      [{ key: 'criterion', label: '기준' }, { key: 'mean', label: '평균 점수' }],
    ),
    ``,
    `## 점검 필요 ${flagged.length}건 (기준 점수 < ${flagThreshold} 또는 낯선 CVE ID 등장)`,
    ``,
    markdownTable(
      flagged.map((r) => ({
        id: r.id,
        label: r.label || '-',
        lowCriteria: (r.criteria || []).filter((c) => c.meanScore !== null && c.meanScore < flagThreshold).map((c) => `${c.criterion}=${fmtScore(c.meanScore)}`).join(', ') || '-',
        unexpectedCve: r.heuristics?.unexpectedCveIds?.join(', ') || '-',
      })),
      [
        { key: 'id', label: 'ID' },
        { key: 'label', label: '라벨' },
        { key: 'lowCriteria', label: '미달 기준' },
        { key: 'unexpectedCve', label: '낯선 CVE 언급' },
      ],
    ),
    ``,
  ].join('\n');

  const { jsonPath, mdPath } = saveReport(calibration ? 'generation-calibration' : 'generation', { mode: calibration ? 'calibration' : regenerate ? 'regenerate' : 'snapshot', meansByCriterion, results }, md);
  console.log(`\n[saved] ${jsonPath}`);
  console.log(`[saved] ${mdPath}`);

  return { meansByCriterion, results, flagged, jsonPath, mdPath, md };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const args = process.argv.slice(2);
  run({ regenerate: args.includes('--regenerate'), calibration: args.includes('--calibration') }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
