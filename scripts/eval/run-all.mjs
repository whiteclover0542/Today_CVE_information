// 분류 정확도 + 생성 품질(스냅샷) + 심사 모델 자체 검증(calibration) + 브리핑 품질을 한 번에 돌리고
// 하나의 Markdown으로 묶어 "오늘 이 프로젝트의 AI 파이프라인이 전체적으로 어느 수준인지"를 한눈에 보여준다.
// 개별 리포트(scripts/eval/reports/<name>-<timestamp>.{json,md})는 그대로 남고, 이 스크립트는
// 그 결과들을 요약해서 scripts/eval/reports/summary-<timestamp>.md 하나로 더 저장한다.
//
// 실행 전: node scripts/eval/build-classification-golden-set.mjs && node scripts/eval/build-generation-golden-set.mjs
// 실행: node scripts/eval/run-all.mjs
import { run as runClassification } from './run-classification-eval.mjs';
import { run as runGeneration } from './run-generation-eval.mjs';
import { run as runBriefing } from './run-briefing-eval.mjs';
import { saveReport, fmtScore, mdHeader } from './report.mjs';

async function main() {
  console.log('########## 1/4 분류(카테고리) 평가 ##########');
  const classification = await runClassification();

  console.log('\n########## 2/4 생성 품질 평가 — 운영 출력 스냅샷 ##########');
  const generation = await runGeneration({ regenerate: false, calibration: false });

  console.log('\n########## 3/4 심사 모델 자체 검증(calibration) ##########');
  const calibration = await runGeneration({ regenerate: false, calibration: true });

  console.log('\n########## 4/4 오늘의 브리핑 품질 평가 ##########');
  const briefing = await runBriefing();

  const judgeSane = calibration
    ? calibration.results.every((r) => {
        if (r.label !== 'bad') return true;
        return (r.criteria || []).some((c) => c.meanScore !== null && c.meanScore <= 3);
      })
    : null;

  const lines = [
    mdHeader('AI 품질 종합 평가'),
    `이 리포트는 4개 개별 리포트(분류/생성/calibration/브리핑)를 한 번에 돌려 모은 요약이다. 각 항목의 상세는 함께 저장된 개별 리포트를 참고.`,
    ``,
    `## 한눈에 보기`,
    ``,
    `| 항목 | 핵심 지표 | 상세 리포트 |`,
    `| --- | --- | --- |`,
    classification
      ? `| 분류(카테고리) | 정확도 ${fmtScore(classification.overall.accuracy)} / macro-F1 ${fmtScore(classification.overall.macroF1)} (오분류 ${classification.mismatches.length}건) | ${classification.mdPath} |`
      : `| 분류(카테고리) | 골든셋 없음 — build-classification-golden-set.mjs 먼저 실행 | - |`,
    generation
      ? `| 생성 품질(운영 스냅샷) | ${Object.entries(generation.meansByCriterion).map(([k, v]) => `${k}=${fmtScore(v)}`).join(', ')} (점검 필요 ${generation.flagged.length}건) | ${generation.mdPath} |`
      : `| 생성 품질(운영 스냅샷) | 골든셋 없음 또는 API 키 없음 | - |`,
    calibration
      ? `| 심사 모델 검증 | good/bad 판별 ${judgeSane ? '정상(대부분의 bad 사례를 3점 이하로 걸러냄)' : '⚠ 의심(일부 bad 사례가 높은 점수를 받음 — 심사 프롬프트 점검 필요)'} | ${calibration.mdPath} |`
      : `| 심사 모델 검증 | API 키 없어 건너뜀 | - |`,
    briefing
      ? `| 브리핑 품질 | ${Object.entries(briefing.meansByCriterion).map(([k, v]) => `${k}=${fmtScore(v)}`).join(', ')} | ${briefing.mdPath} |`
      : `| 브리핑 품질 | API 키 없어 건너뜀 | - |`,
    ``,
    `## 읽는 법`,
    ``,
    `- **분류**: '기타' 재분류(LLM) 단계만 따로 뗀 정확도가 진짜 LLM 기여도다. 개별 리포트의 '기타 단계만' 수치를 볼 것.`,
    `- **생성 품질**: faithfulness/groundedCause가 이 프로젝트의 "지어내지 않는다" 원칙과 직결된 가장 중요한 기준. 3점 미만이면 반드시 원문 대조.`,
    `- **심사 모델 검증**: bad로 표시한 사례(고의로 오염시킨 출력)가 낮은 점수를 받아야 심사 모델을 신뢰할 수 있다. 정상이 아니면 다른 결과 전체를 의심해야 함.`,
    `- **브리핑**: noFabrication이 핵심 — 수치 밖의 사실을 지어내면 안 됨.`,
    ``,
  ].join('\n');

  const { mdPath } = saveReport('summary', { classification, generation, calibration, briefing, judgeSane }, lines);
  console.log(`\n\n=== 종합 리포트 저장 완료 ===\n${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
