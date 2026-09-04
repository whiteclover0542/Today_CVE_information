// 일회성 스크립트 — 이미 저장된 오늘자 history.json 항목의 집계 수치로 briefing만 새로 생성해
// 그 항목의 briefing 필드에만 반영한다(다른 필드는 절대 건드리지 않음). 성공했을 때만 파일을 쓴다.
// 실행 후 이 스크립트와 워크플로는 정리(삭제)하고, data/history.json의 변경만 남긴다.
import { readFileSync, writeFileSync } from 'node:fs';

const GEMINI_MODEL = 'gemini-3.5-flash-lite';

async function generateBriefingWithLlm(stats) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[skip] GEMINI_API_KEY 없음');
    return null;
  }

  const { count, severity, topCwe, topProduct, categorySampleSize } = stats;
  const statLines = [
    `오늘(KST) 신규 등록 CVE 총 ${count}건`,
    `심각도별 — 심각 ${severity.critical}건 / 높음 ${severity.high}건 / 중간 ${severity.medium}건 / 낮음 ${severity.low}건 / 평가 대기 ${severity.unrated}건`,
    topCwe
      ? `가장 많이 나온 취약점 유형(CWE): ${topCwe.label} ${topCwe.count}건 (심각도 평가된 ${categorySampleSize}건 중)`
      : '오늘은 CWE 유형 집계 대상(심각도 평가된 CVE)이 없음',
    topProduct
      ? `가장 많이 언급된 제품·벤더: ${topProduct.label} ${topProduct.count}건`
      : '오늘은 특정 제품·벤더가 두드러지지 않음',
  ].join('\n');

  const responseSchema = {
    type: 'object',
    properties: { briefing: { type: 'string' } },
    required: ['briefing'],
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text:
                '너는 오늘 하루 등록된 CVE(보안 취약점) 현황을 한국어로 브리핑하는 보안 분석가야. ' +
                '아래 수치만 근거로 1~3문장 요약을 써. 수치에 없는 특정 CVE 번호·제품·공격 사례를 지어내지 말고, ' +
                '실제 공격이 벌어졌다는 식의 근거 없는 단정도 하지 마. 평범한 날이면 평범하다고 담백하게 쓰고, ' +
                '확신이 없는 내용은 아예 문장에 넣지 마(지어내지 마).',
            },
          ],
        },
        contents: [{ role: 'user', parts: [{ text: statLines }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema },
      }),
    });

    if (!res.ok) {
      console.warn(`[warn] HTTP ${res.status} ${await res.text()}`);
      return null;
    }

    const body = await res.json();
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.warn('[warn] 응답이 비어 있음');
      return null;
    }
    return JSON.parse(text).briefing?.trim() || null;
  } catch (e) {
    console.warn(`[warn] ${e.message}`);
    return null;
  }
}

const HISTORY_PATH = new URL('../data/history.json', import.meta.url);
const history = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
const last = history[history.length - 1];

if (last.briefing) {
  console.log(`[skip] ${last.date} 항목에 이미 briefing이 있습니다. 덮어쓰지 않습니다.`);
  process.exit(0);
}

const topCwe = last.cweBreakdown.filter((c) => c.key !== 'none')[0] || null;
const topProduct = last.productBreakdown[0] || null;
const briefing = await generateBriefingWithLlm({
  count: last.count,
  severity: last.severity,
  topCwe,
  topProduct,
  categorySampleSize: last.categorySampleSize,
});

if (!briefing) {
  console.warn('[warn] briefing 생성 실패 — history.json을 건드리지 않습니다.');
  process.exit(1);
}

last.briefing = briefing;
writeFileSync(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`);
console.log(`[saved] ${last.date} briefing: ${briefing}`);
