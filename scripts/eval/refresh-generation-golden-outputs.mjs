// 프롬프트를 고친 뒤, golden/generation.json의 storedOutput을 "지금 프롬프트가 실제로 만드는 결과"로
// 갱신한다. run-generation-eval.mjs --regenerate는 채점만 하고 재생성된 텍스트 자체는 저장하지 않아서
// (골든셋 자체를 최신 상태로 유지하려면) 이 스크립트가 따로 필요하다.
//
// 실행: node scripts/eval/refresh-generation-golden-outputs.mjs
// GEMINI_API_KEY 필요. 분당 요청 한도(gemini-3.5-flash-lite 기준 15회/분)를 피하려고 호출 사이 5초씩 쉰다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { explainHighlightWithLlm } from '../fetch-daily-count.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATH = join(__dirname, 'golden', 'generation.json');

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.log('[stop] GEMINI_API_KEY 없음');
    return;
  }

  const golden = JSON.parse(readFileSync(PATH, 'utf8'));
  let updated = 0;
  let failed = 0;

  for (const c of golden.cases) {
    const output = await explainHighlightWithLlm(c.summaryEn, c.cwe);
    if (output) {
      c.storedOutput = {
        title: output.title,
        summaryKo: output.summaryKo,
        interpretation: output.interpretation,
        cause: output.cause,
        mitigation: output.mitigation,
      };
      updated += 1;
      console.log(`[ok] ${c.id}`);
    } else {
      failed += 1;
      console.log(`[fail] ${c.id} — 기존 storedOutput 유지`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  golden.generatedAt = new Date().toISOString();
  writeFileSync(PATH, JSON.stringify(golden, null, 2) + '\n');
  console.log(`[saved] ${PATH} — 갱신 ${updated}건 / 실패(기존 유지) ${failed}건`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
