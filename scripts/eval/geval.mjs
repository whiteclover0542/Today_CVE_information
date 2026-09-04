// 범용 G-Eval 구현체. 원 논문(Liu et al., 2023, "G-Eval: NLG Evaluation using GPT-4 with
// Better Human Alignment")의 핵심 절차 — (1) 평가 기준과 단계별 체크리스트(CoT)를 프롬프트에 주고
// (2) 심사 모델이 그 체크리스트를 따라가며 1~5점을 매기게 하는 방식 — 을 그대로 따른다.
//
// 심사 모델은 운영과 같은 gemini-3.5-flash-lite를 쓴다. 처음엔 운영보다 무거운 모델
// (pro 등급 → 할당량 0으로 접근 자체가 막힘, 그다음 gemini-3.5-flash → 일일 무료 할당량이
// 20건뿐이라 채점 240콜 중 20콜만 성공하고 나머지는 전부 429로 조용히 실패하는 걸 실측으로 확인)을
// 써보려 했으나 둘 다 무료 티어에서 실질적으로 못 쓸 수준이라, 운영에서 매일 수십 번 문제없이
// 쓰는 flash-lite로 정착했다. 같은 모델이 자기 출력을 채점하는 자기 편향 우려가 남기 때문에
// calibration(golden/calibration.json)으로 이 한계가 실제 문제인지 계속 검증해야 한다.
const DEFAULT_SAMPLES = 3;
const DEFAULT_MODEL = 'gemini-3.5-flash-lite'; // 환경변수 GEVAL_MODEL로 교체 가능(유료 티어로 전환하면 pro 등급 권장)

// 무료 티어 키 하나의 일일 할당량이 너무 낮아(모델에 따라 20건 수준) 여러 키를 순환 사용해야
// 실용적인 평가가 가능하다. GEMINI_API_KEYS(쉼표/줄바꿈 구분)가 있으면 그 풀을 쓰고, 없으면
// 기존처럼 GEMINI_API_KEY 단일 키를 쓴다.
function parseKeyPool(raw) {
  if (!raw) return [];
  return raw.split(/[\s,]+/).map((k) => k.trim()).filter(Boolean);
}

function defaultKeyPool() {
  const pool = parseKeyPool(process.env.GEMINI_API_KEYS);
  if (pool.length > 0) return pool;
  return process.env.GEMINI_API_KEY ? [process.env.GEMINI_API_KEY] : [];
}

let rotationCursor = 0; // 여러 호출에 걸쳐 키를 고르게 돌려쓰기 위한 전역 포인터

function buildPrompt({ criterion, criterionDescription, evaluationSteps, input, output }) {
  const steps = evaluationSteps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return [
    `너는 텍스트 품질을 평가하는 깐깐한 심사관이야. 아래 "평가 기준"에 따라 "평가 대상"에 1~5점(정수)을 매겨.`,
    `점수 기준: 5=완벽히 충족, 4=대체로 충족(경미한 흠), 3=절반 정도 충족(눈에 띄는 문제), 2=대부분 미달, 1=완전히 어긋남.`,
    ``,
    `평가 기준: ${criterion}`,
    `기준 설명: ${criterionDescription}`,
    ``,
    `평가 절차(반드시 순서대로 따져본 뒤 점수를 매길 것):`,
    steps,
    ``,
    `--- 입력(원문/근거) ---`,
    input,
    ``,
    `--- 평가 대상(출력) ---`,
    output,
  ].join('\n');
}

function isRateLimitError(message) {
  return /HTTP 429|RESOURCE_EXHAUSTED/.test(message);
}

// 429 응답 본문의 retryDelay(예: "17s")를 초 단위로 뽑아낸다. 못 찾으면 보수적으로 20초.
function extractRetryDelaySeconds(message) {
  const m = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Math.ceil(Number(m[1])) : 20;
}

async function callJudgeOnceWithKey({ apiKey, model, prompt }) {
  const responseSchema = {
    type: 'object',
    properties: {
      reasoning: { type: 'string' },
      score: { type: 'integer' },
    },
    required: ['reasoning', 'score'],
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 1, // self-consistency 샘플 간 다양성을 위해 약간의 온도를 둠
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${await res.text()}`);
  }

  const body = await res.json();
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('심사 모델 응답이 비어 있음');

  const parsed = JSON.parse(text);
  const score = Number(parsed.score);
  if (!Number.isFinite(score) || score < 1 || score > 5) {
    throw new Error(`심사 모델이 범위 밖 점수를 반환함: ${parsed.score}`);
  }
  return { score, reasoning: parsed.reasoning };
}

// 키 풀을 순환하며 호출한다. 어떤 키가 429면 바로 다음 키로 넘어가고(대기 없이), 풀 전체가
// 한 바퀴 다 429면 그제서야 서버가 알려준 시간만큼 기다렸다가 딱 한 번 더 전체를 재시도한다.
// 429가 아닌 다른 오류(응답 형식 오류 등)는 키 문제가 아니라 즉시 던진다 — 재시도해도 안 될 확률이 높음.
async function callJudgeWithRotation({ keys, model, prompt }) {
  if (keys.length === 0) throw new Error('사용 가능한 API 키 없음');

  for (let round = 0; round < 2; round += 1) {
    let sawRateLimit = false;
    let maxRetryDelay = 0;

    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[(rotationCursor + i) % keys.length];
      try {
        const result = await callJudgeOnceWithKey({ apiKey: key, model, prompt });
        rotationCursor = (rotationCursor + i + 1) % keys.length; // 성공한 다음 키부터 이어서 돌게
        return result;
      } catch (e) {
        if (!isRateLimitError(e.message)) throw e; // 429가 아니면 즉시 실패 처리
        sawRateLimit = true;
        maxRetryDelay = Math.max(maxRetryDelay, extractRetryDelaySeconds(e.message));
      }
    }

    if (!sawRateLimit) break; // 이론상 도달 안 함(루프 안에서 성공하거나 던지거나 함)
    if (round === 0) {
      await new Promise((r) => setTimeout(r, maxRetryDelay * 1000));
    }
  }

  throw new Error(`키 풀 전체(${keys.length}개)가 429(요청 한도 초과) — 재시도 후에도 실패`);
}

// criterion: 짧은 이름(예: "faithfulness"), criterionDescription: 한두 문장 설명,
// evaluationSteps: 심사 모델이 순서대로 확인할 체크리스트(문자열 배열).
// input: 판단 근거가 되는 원문/사실, output: 채점 대상 텍스트.
// apiKeys: 순환 사용할 키 배열(기본값은 GEMINI_API_KEYS 또는 GEMINI_API_KEY에서 자동 구성).
// 반환: { criterion, meanScore, scores: number[], reasonings: string[] } — 실패하면 error 필드와 함께 null 점수.
export async function gEvalScore({
  criterion,
  criterionDescription,
  evaluationSteps,
  input,
  output,
  apiKeys = defaultKeyPool(),
  model = process.env.GEVAL_MODEL || DEFAULT_MODEL,
  samples = DEFAULT_SAMPLES,
}) {
  if (apiKeys.length === 0) {
    return { criterion, meanScore: null, scores: [], reasonings: [], error: 'GEMINI_API_KEY(S) 없음' };
  }
  if (!output || !output.trim()) {
    return { criterion, meanScore: null, scores: [], reasonings: [], error: '평가 대상 출력이 비어 있음(생성 실패 케이스는 별도 집계)' };
  }

  const prompt = buildPrompt({ criterion, criterionDescription, evaluationSteps, input, output });
  const scores = [];
  const reasonings = [];
  let lastError = null;

  for (let i = 0; i < samples; i += 1) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1500)); // 샘플 간 최소 간격
    try {
      const { score, reasoning } = await callJudgeWithRotation({ keys: apiKeys, model, prompt });
      scores.push(score);
      reasonings.push(reasoning);
    } catch (e) {
      lastError = e.message;
    }
  }

  if (scores.length === 0) {
    return { criterion, meanScore: null, scores: [], reasonings: [], error: lastError || '알 수 없는 오류' };
  }
  if (scores.length < samples) {
    lastError = `${samples}회 중 ${scores.length}회만 성공(나머지: ${lastError})`; // 부분 실패도 보이게 남김 — 평균만 보고 전량 성공한 줄 오해하지 않도록
  }

  const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { criterion, meanScore, scores, reasonings, ...(lastError ? { partialFailureNote: lastError } : {}) };
}

// 여러 기준을 한 케이스에 대해 순차 평가(무료 티어 RPM 한도를 고려해 동시 호출 대신 순차 실행).
export async function gEvalMulti({ criteria, input, output, apiKeys, model, samples, intervalMs = 2000 }) {
  const results = [];
  for (const c of criteria) {
    if (results.length > 0) await new Promise((r) => setTimeout(r, intervalMs));
    results.push(await gEvalScore({ ...c, input, output, apiKeys, model, samples }));
  }
  return results;
}
