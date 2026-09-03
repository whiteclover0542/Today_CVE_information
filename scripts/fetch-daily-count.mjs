import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const HISTORY_PATH = new URL('../data/history.json', import.meta.url);
const TIMEZONE = 'Asia/Seoul';
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const MAX_HIGHLIGHTS = 3;
const PAGE_SIZE = 2000; // NVD CVE API 2.0 공식 문서상 resultsPerPage 최대값 — 하루치 심각도별 CVE는 사실상 이 안에 다 들어와 대부분 한 번의 호출로 전량이 수집됨
const NVD_REQUEST_INTERVAL_MS = 6500; // 무키 제한 30초당 5회 — 페이지가 늘어 호출이 몇 번이 되든 이 간격을 지키면 항상 제한 안쪽에 머문다
const CATEGORY_EXAMPLES_LIMIT = 3; // 유형별로 원본 링크를 몇 건까지 같이 저장할지 (번역은 안 함 — API 호출 추가 없음)

// CVE 설명은 NVD가 정형화된 문구로 작성하는 경우가 많아("... allows remote attackers to execute arbitrary code" 등)
// 키워드 매칭만으로도 꽤 신뢰할 수 있는 유형 분류가 가능함. 위에서 아래로 먼저 걸리는 규칙 하나만 적용.
const CATEGORY_RULES = [
  { key: 'rce', label: '원격 코드 실행', pattern: /remote code execution|arbitrary code execution|code injection|command injection|execute arbitrary code/i },
  { key: 'auth-bypass', label: '인증 우회', pattern: /authentication bypass|missing authentication|without authentication|unauthenticated (attacker|user|caller)|bypass authentication/i },
  { key: 'priv-esc', label: '권한 상승', pattern: /privilege escalation|elevation of privilege|escalate privileges|elevated privileges|improper privilege management/i },
  { key: 'access-control', label: '접근 통제 오류', pattern: /improper access control|missing access control|access control bypass|broken access control|incorrect access control|missing authorization|improper authorization/i },
  { key: 'sqli', label: 'SQL 인젝션', pattern: /sql injection/i },
  { key: 'xss', label: '크로스사이트 스크립팅(XSS)', pattern: /cross-site scripting|\bxss\b/i },
  { key: 'csrf', label: 'CSRF', pattern: /cross-site request forgery|\bcsrf\b/i },
  { key: 'path-traversal', label: '경로 순회', pattern: /directory traversal|path traversal/i },
  { key: 'buffer-overflow', label: '버퍼 오버플로우', pattern: /buffer overflow|out-of-bounds (read|write)|stack-based buffer|heap-based buffer/i },
  { key: 'integer-overflow', label: '정수 오버플로우', pattern: /integer overflow|integer underflow/i },
  { key: 'info-disclosure', label: '정보 노출', pattern: /information disclosure|sensitive information (exposure|disclosure)|expose sensitive/i },
  { key: 'dos', label: '서비스 거부(DoS)', pattern: /denial of service|\bdos\b/i },
  { key: 'deserialization', label: '역직렬화 취약점', pattern: /deserializ/i },
  { key: 'ssrf', label: 'SSRF', pattern: /server-side request forgery|\bssrf\b/i },
  { key: 'hardcoded-cred', label: '하드코딩된 자격증명', pattern: /hard-?coded credential|default credential/i },
  { key: 'file-upload', label: '위험한 파일 업로드', pattern: /unrestricted upload|arbitrary file upload|malicious file upload/i },
  { key: 'use-after-free', label: '메모리 해제 후 사용(UAF)', pattern: /use-after-free|use after free/i },
  { key: 'race-condition', label: '경쟁 조건', pattern: /race condition|time-of-check.{0,20}time-of-use|\btoctou\b/i },
  { key: 'null-deref', label: 'NULL 포인터 역참조', pattern: /null pointer dereference/i },
  { key: 'type-confusion', label: '타입 컨퓨전', pattern: /type confusion/i },
  { key: 'xxe', label: 'XML 외부 개체 주입(XXE)', pattern: /xml external entity|\bxxe\b/i },
  { key: 'open-redirect', label: '오픈 리다이렉트', pattern: /open redirect/i },
  { key: 'cert-validation', label: '인증서 검증 오류', pattern: /improper certificate validation|certificate validation/i },
  { key: 'format-string', label: '포맷 스트링 취약점', pattern: /format string/i },
  { key: 'ldap-injection', label: 'LDAP 인젝션', pattern: /ldap injection/i },
  { key: 'weak-crypto', label: '취약한 암호화·난수 사용', pattern: /broken or risky cryptographic algorithm|weak encryption algorithm|insufficiently random values|insecure randomness/i },
  { key: 'cleartext', label: '평문 전송(암호화 누락)', pattern: /cleartext transmission|missing encryption of sensitive data|transmitted in clear text/i },
  { key: 'idor', label: '취약한 직접 개체 참조(IDOR)', pattern: /insecure direct object reference|\bidor\b/i },
  { key: 'input-validation', label: '입력값 검증 미흡', pattern: /improper input validation|insufficient input validation/i },
];

function categorize(description) {
  const rule = CATEGORY_RULES.find((r) => r.pattern.test(description));
  return rule ? rule.key : 'other';
}

// 규칙 매칭에서 "기타"로 빠진 CVE만 모아 LLM(Gemini 무료 티어)에 한 번에 보내 재분류한다.
// LLM은 위 CATEGORY_RULES 라벨 중에서만 고르도록 강제(닫힌 집합) — 새 유형을 마음대로 만들면
// 유형 목록이 계속 늘어나 일관성이 깨지므로, 정말 안 맞을 때만 'other'를 유지하게 한다.
// 키 없음/네트워크 실패/무료 티어 한도 초과 등 어떤 이유로든 실패하면 규칙 분류 결과(전부 '기타') 그대로 둔다 — 번역과 동일한 폴백 원칙.
const LLM_RECLASSIFY_LIMIT = 300; // 하루 재분류 대상 상한(무료 티어 요청 크기 안전장치) — 초과분은 '기타'로 남음
const GEMINI_MODEL = 'gemini-3.5-flash-lite'; // 무료 티어의 가장 가벼운 모델 — 이 이름이 만료되면 https://aistudio.google.com 에서 현재 무료 티어 모델명으로 교체
const CATEGORY_KEYS = [...CATEGORY_RULES.map((r) => r.key), 'other'];

async function classifyOthersWithLlm(items) {
  if (items.length === 0) return {};
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[skip] GEMINI_API_KEY 없음 — 기타 재분류 건너뜀(규칙 매칭 결과만 사용)');
    return {};
  }

  const targets = items.slice(0, LLM_RECLASSIFY_LIMIT);
  const categoryList = CATEGORY_RULES.map((r) => `${r.key}: ${r.label}`).join('\n');

  const responseSchema = {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            key: { type: 'string', enum: CATEGORY_KEYS },
          },
          required: ['id', 'key'],
        },
      },
    },
    required: ['results'],
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
                '너는 CVE 취약점 설명을 읽고 아래 유형 목록 중 하나로 분류하는 보안 분석가야. ' +
                '반드시 목록에 있는 key만 사용해. 설명을 읽어도 목록 중 어디에도 명확히 해당하지 않으면 "other"를 사용해.\n\n' +
                categoryList,
            },
          ],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: JSON.stringify(targets.map((t) => ({ id: t.id, description: t.desc }))) }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema,
        },
      }),
    });

    if (!res.ok) {
      console.warn(`[warn] 기타 재분류 실패: HTTP ${res.status} ${await res.text()}`);
      return {};
    }

    const body = await res.json();
    const usage = body.usageMetadata;
    if (usage) {
      console.log(
        `[llm] 기타 ${targets.length}건 재분류 — 입력 ${usage.promptTokenCount} / 출력 ${usage.candidatesTokenCount} 토큰 (무료 티어)`,
      );
    }

    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.warn('[warn] 기타 재분류 응답이 비어 있음 — 규칙 매칭 결과만 사용');
      return {};
    }

    const parsed = JSON.parse(text);
    const map = {};
    for (const r of parsed.results || []) {
      map[r.id] = r.key;
    }
    return map;
  } catch (e) {
    console.warn(`[warn] 기타 재분류 실패: ${e.message}`);
    return {};
  }
}

// 공격 유형과 달리 제품명은 문구가 정형화돼 있지 않아서(자유 서술) 미리 정해둔 벤더·제품 목록과
// 매칭하는 방식만 씀 — 목록에 없는 제품은 "기타"로 잡히지만 화면에는 노출하지 않음(목록에 확실히 있는 것만 보여줌).
const PRODUCT_RULES = [
  { key: 'wordpress', label: 'WordPress', pattern: /wordpress|woocommerce/i },
  { key: 'linux', label: 'Linux/커널', pattern: /\blinux\b/i },
  { key: 'cisco', label: 'Cisco', pattern: /\bcisco\b/i },
  { key: 'microsoft', label: 'Microsoft/Windows', pattern: /\bmicrosoft\b|\bwindows\b/i },
  { key: 'apple', label: 'Apple/iOS/macOS', pattern: /\bapple\b|\bios\b|\bmacos\b|\biphone\b/i },
  { key: 'google-android', label: 'Google/Android', pattern: /\bgoogle\b|\bandroid\b|\bchrome\b/i },
  { key: 'd-link', label: 'D-Link', pattern: /d-link/i },
  { key: 'tp-link', label: 'TP-Link', pattern: /tp-link/i },
  { key: 'netgear', label: 'Netgear', pattern: /netgear/i },
  { key: 'zyxel', label: 'Zyxel', pattern: /zyxel/i },
  { key: 'huawei', label: 'Huawei', pattern: /huawei/i },
  { key: 'ibm', label: 'IBM', pattern: /\bibm\b/i },
  { key: 'adobe', label: 'Adobe', pattern: /\badobe\b/i },
  { key: 'oracle-mysql', label: 'Oracle/MySQL', pattern: /\boracle\b|\bmysql\b|\bmariadb\b/i },
  { key: 'sap', label: 'SAP', pattern: /\bsap\b/i },
  { key: 'fortinet', label: 'Fortinet', pattern: /fortinet|fortigate/i },
  { key: 'juniper', label: 'Juniper', pattern: /juniper/i },
  { key: 'vmware', label: 'VMware', pattern: /vmware/i },
  { key: 'apache', label: 'Apache', pattern: /\bapache\b/i },
  { key: 'php', label: 'PHP', pattern: /\bphp\b/i },
  { key: 'openssl', label: 'OpenSSL', pattern: /openssl/i },
  { key: 'docker-k8s', label: 'Docker/Kubernetes', pattern: /\bdocker\b|kubernetes/i },
  { key: 'gitlab-github', label: 'GitLab/GitHub', pattern: /gitlab|github/i },
  { key: 'joomla-drupal', label: 'Joomla/Drupal', pattern: /joomla|drupal/i },
  { key: 'qnap-synology', label: 'QNAP/Synology', pattern: /qnap|synology/i },
  { key: 'samsung', label: 'Samsung', pattern: /samsung/i },
];

function categorizeProduct(description) {
  const rule = PRODUCT_RULES.find((r) => r.pattern.test(description));
  return rule ? rule.key : 'other';
}

function kstDateString(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`NVD API 호출 실패: HTTP ${res.status} (${url})`);
  }
  return res.json();
}

// CVSS 벡터는 NVD가 이미 정형화해 제공하는 구조적 데이터라 번역 없이 그대로 한글 대응만 하면 됨(오역 위험 없음)
const CVSS_VECTOR_LABELS = {
  AV: { N: '네트워크에서 접근 가능', A: '인접 네트워크에서 접근 가능', L: '로컬 접근 필요', P: '물리적 접근 필요' },
  AC: { L: '공격 난이도 낮음', H: '공격 난이도 높음' },
  PR: { N: '권한 불필요', L: '낮은 권한 필요', H: '높은 권한 필요' },
  UI: { N: '사용자 개입 불필요', R: '사용자 개입 필요' },
  S: { U: '영향 범위 변경 없음', C: '영향 범위 변경됨' },
};

function decodeCvssVector(vector) {
  if (!vector) return null;
  const parts = Object.fromEntries(
    vector.replace(/^CVSS:[\d.]+\//, '').split('/').map((p) => p.split(':')),
  );
  const labels = ['AV', 'AC', 'PR', 'UI']
    .map((key) => CVSS_VECTOR_LABELS[key]?.[parts[key]])
    .filter(Boolean);
  return labels.length ? labels.join(' · ') : null;
}

const MYMEMORY_CHAR_LIMIT = 490; // MyMemory 익명 사용 한도(500자)에 여유를 둔 값

// 500자 넘는 설명을 문장 하나씩 보내면 호출이 너무 늘어나므로, 문장을 한도 안에서 최대한 크게 묶어 나눈다.
// (문장 하나가 한도보다 길 때만 어쩔 수 없이 단어 경계에서 추가로 자름)
function splitIntoChunks(text, limit) {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  const chunks = [];
  let current = '';
  for (let sentence of sentences) {
    while (sentence.length > limit) {
      const cut = sentence.slice(0, limit);
      const lastSpace = cut.lastIndexOf(' ');
      const splitAt = lastSpace > limit * 0.6 ? lastSpace : limit;
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      chunks.push(sentence.slice(0, splitAt).trim());
      sentence = sentence.slice(splitAt).trim();
    }
    if (current.length + sentence.length > limit && current) {
      chunks.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function translateChunk(text) {
  try {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', text);
    url.searchParams.set('langpair', 'en|ko');
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = await res.json();
    if (body.responseStatus !== 200) return null;
    return body.responseData?.translatedText || null;
  } catch (e) {
    console.warn(`[warn] 번역 청크 실패: ${e.message}`);
    return null;
  }
}

// 한 심각도의 CVE를 startIndex로 계속 넘겨가며 전량 수집한다 — 더 이상 앞쪽 일부만 보는 표본이 아니라
// 그 심각도의 당일 등록분 전체(rated)를 받아옴. PAGE_SIZE(2000)가 NVD 최대치라 보통은 while이 한 번만 돈다.
async function fetchAllForSeverity(baseUrl, level) {
  const vulnerabilities = [];
  let startIndex = 0;
  let total = Infinity;
  while (startIndex < total) {
    await sleep(NVD_REQUEST_INTERVAL_MS);
    const url = new URL(baseUrl);
    url.searchParams.set('cvssV3Severity', level);
    url.searchParams.set('resultsPerPage', String(PAGE_SIZE));
    url.searchParams.set('startIndex', String(startIndex));
    const body = await fetchJson(url);
    total = body.totalResults;
    const page = body.vulnerabilities || [];
    vulnerabilities.push(...page);
    if (page.length === 0) break; // 안전장치: 빈 응답이면 무한 루프 방지
    startIndex += page.length;
  }
  return { total, vulnerabilities };
}

// 무키 번역: MyMemory Translation API (익명 사용, 요청당 500자·하루 5000단어 한도)
// 청크 중 하나라도 실패하면 짜깁기된 반쪽 번역 대신 전체를 null로 반환해 원문으로 대체한다.
async function translateToKorean(text) {
  if (!text) return null;
  const chunks = splitIntoChunks(text, MYMEMORY_CHAR_LIMIT);
  const translated = [];
  for (const chunk of chunks) {
    const result = await translateChunk(chunk);
    if (!result) return null;
    translated.push(result);
    if (chunks.length > 1) await sleep(400);
  }
  return translated.join(' ');
}

async function main() {
  const now = new Date();
  const kstDate = kstDateString(now);

  const history = existsSync(HISTORY_PATH)
    ? JSON.parse(readFileSync(HISTORY_PATH, 'utf8'))
    : [];

  if (history.some((entry) => entry.date === kstDate)) {
    console.log(`[skip] ${kstDate} 기록이 이미 있습니다. 중복 저장하지 않습니다.`);
    return;
  }

  const pubStartDate = new Date(`${kstDate}T00:00:00+09:00`).toISOString();
  const pubEndDate = now.toISOString();

  const baseUrl = new URL('https://services.nvd.nist.gov/rest/json/cves/2.0');
  baseUrl.searchParams.set('pubStartDate', pubStartDate);
  baseUrl.searchParams.set('pubEndDate', pubEndDate);
  baseUrl.searchParams.set('resultsPerPage', '1');

  const totalBody = await fetchJson(baseUrl);
  const total = totalBody.totalResults;

  // 키 없이 호출하면 30초당 5회 제한(NVD 공식 문서) — 페이지가 몇 개로 늘어나든 매 호출 사이
  // NVD_REQUEST_INTERVAL_MS만큼 쉬어 항상 이 제한 안에 머문다(fetchAllForSeverity 내부에서 적용).
  const severity = {};
  const rawHighlights = [];
  const usedHighlightIds = new Set();
  const usedHighlightCategories = new Set();
  const categoryCounts = {};
  const categoryExamples = {}; // 유형별 원본 링크 몇 건 — 번역은 안 함(추가 API 호출 없음)
  const productCounts = {};
  const productExamples = {}; // 벤더·제품별 원본 CVE 링크 몇 건 — 유형과 동일한 방식
  const otherCandidates = []; // 규칙 매칭에서 '기타'로 빠진 CVE — 나중에 LLM으로 한 번에 재분류
  let categorySampleSize = 0; // 심각도가 평가된(rated) CVE 전체 건수 — 전량 수집이라 rated 총합과 같아짐(unrated는 애초에 이 호출 대상이 아니라 여전히 빠짐)
  for (const level of SEVERITIES) {
    const { total: levelTotal, vulnerabilities } = await fetchAllForSeverity(baseUrl, level);
    severity[level.toLowerCase()] = levelTotal;

    const levelCandidates = []; // 이 심각도 안에서 대표 CVE 후보로 쓸 목록

    for (const { cve } of vulnerabilities) {
      const desc = (cve.descriptions || []).find((d) => d.lang === 'en')?.value || '';

      categorySampleSize += 1;
      const categoryKey = categorize(desc);
      categoryCounts[categoryKey] = (categoryCounts[categoryKey] || 0) + 1;
      if (categoryKey === 'other') {
        otherCandidates.push({ id: cve.id, desc });
      }

      const examples = (categoryExamples[categoryKey] ||= []);
      if (examples.length < CATEGORY_EXAMPLES_LIMIT) {
        examples.push({ id: cve.id, url: `https://nvd.nist.gov/vuln/detail/${cve.id}` });
      }

      const productKey = categorizeProduct(desc);
      productCounts[productKey] = (productCounts[productKey] || 0) + 1;
      const productExampleList = (productExamples[productKey] ||= []);
      if (productExampleList.length < CATEGORY_EXAMPLES_LIMIT) {
        productExampleList.push({ id: cve.id, url: `https://nvd.nist.gov/vuln/detail/${cve.id}` });
      }

      levelCandidates.push({ cve, desc, categoryKey });
    }

    // 대표 CVE 3건 선정: 심각도가 항상 먼저다 — 유형을 맞추려고 더 낮은 심각도로 넘어가지 않는다.
    // 1차: 이 심각도 안에서 아직 안 나온 유형을 우선 채움. 2차: 그래도 자리가 남으면(이 심각도 안에서만)
    // 유형이 겹쳐도 채운다. 두 패스 모두 이 심각도의 후보를 다 써도 부족해야 다음(더 낮은) 심각도로 넘어감.
    const pickFromLevel = (allowDuplicateCategory) => {
      for (const { cve, desc, categoryKey } of levelCandidates) {
        if (rawHighlights.length >= MAX_HIGHLIGHTS) break;
        if (usedHighlightIds.has(cve.id)) continue;
        if (!allowDuplicateCategory && usedHighlightCategories.has(categoryKey)) continue;

        usedHighlightIds.add(cve.id);
        usedHighlightCategories.add(categoryKey);
        const metrics = cve.metrics || {};
        // v3.1 우선, 없으면 v3.0, 그마저 없으면 v2 순으로 대체(NVD가 오래된 CVE엔 v3를 안 매기는 경우가 있음)
        const cvss = (metrics.cvssMetricV31 || metrics.cvssMetricV30 || metrics.cvssMetricV2 || [])[0];
        rawHighlights.push({
          id: cve.id,
          severity: level,
          fullEn: desc,
          categoryKey,
          url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
          cvssScore: cvss?.cvssData?.baseScore ?? null,
          cvssVector: cvss?.cvssData?.vectorString ?? null,
        });
      }
    };
    pickFromLevel(false);
    pickFromLevel(true);
  }
  const rated = severity.critical + severity.high + severity.medium + severity.low;
  severity.unrated = Math.max(0, total - rated); // CVSSv3 점수가 아직 없는(평가 대기) 건수

  const reclassified = await classifyOthersWithLlm(otherCandidates);
  for (const [id, newKey] of Object.entries(reclassified)) {
    if (newKey === 'other' || !CATEGORY_KEYS.includes(newKey)) continue;

    categoryCounts.other -= 1;
    categoryCounts[newKey] = (categoryCounts[newKey] || 0) + 1;

    const otherExamples = categoryExamples.other || [];
    const idx = otherExamples.findIndex((e) => e.id === id);
    if (idx !== -1) {
      const [moved] = otherExamples.splice(idx, 1);
      const newExamples = (categoryExamples[newKey] ||= []);
      if (newExamples.length < CATEGORY_EXAMPLES_LIMIT) newExamples.push(moved);
    }

    const highlight = rawHighlights.find((h) => h.id === id);
    if (highlight) highlight.categoryKey = newKey;
  }

  const categoryLabels = Object.fromEntries(CATEGORY_RULES.map((r) => [r.key, r.label]));
  categoryLabels.other = '기타';
  // 잘라내지 않고 전부 저장 — 화면(오늘 카드)에서는 상위 6개만 보여주지만,
  // 월별 합산 그래프는 이 전체 목록을 더해야 작은 유형도 누락 없이 집계됨
  const categoryBreakdown = Object.entries(categoryCounts)
    .map(([key, count]) => ({ key, label: categoryLabels[key], count, examples: categoryExamples[key] || [] }))
    .sort((a, b) => b.count - a.count);

  // "기타"는 화면에 안 보여줄 거라 애초에 제외 — 목록에 확실히 있는 벤더만 건수·원본 CVE 링크와 함께 남김.
  const productLabels = Object.fromEntries(PRODUCT_RULES.map((r) => [r.key, r.label]));
  const productBreakdown = Object.entries(productCounts)
    .filter(([key]) => key !== 'other')
    .map(([key, count]) => ({ key, label: productLabels[key], count, examples: productExamples[key] || [] }))
    .sort((a, b) => b.count - a.count);

  // 대표 CVE 설명 전문을 한국어로 번역 (NVD 호출과 별개 서비스라 위 5회 제한과 무관, 그래도 예의상 간격을 둠)
  // 화면에서 "자세히 보기"로 전문·원문을 다 보여줄 수 있도록 자르지 않고 그대로 저장한다.
  const highlights = [];
  for (const h of rawHighlights) {
    await sleep(500);
    const ko = await translateToKorean(h.fullEn);
    highlights.push({
      id: h.id,
      severity: h.severity,
      summaryEn: h.fullEn,
      summaryKo: ko || null,
      url: h.url,
      cvssScore: h.cvssScore,
      cvssVector: h.cvssVector,
      cvssPlain: decodeCvssVector(h.cvssVector),
      category: categoryLabels[h.categoryKey],
    });
  }

  const entry = {
    date: kstDate,
    count: total,
    unit: '건',
    timezone: TIMEZONE,
    sourceApiUrl: baseUrl.toString(),
    queriedAtUtc: now.toISOString(),
    severity,
    highlights,
    categoryBreakdown,
    categorySampleSize,
    productBreakdown,
  };

  history.push(entry);
  history.sort((a, b) => a.date.localeCompare(b.date));

  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');
  console.log(
    `[saved] ${kstDate} -> ${entry.count}건`,
    severity,
    `highlights: ${highlights.length}`,
    `categories(rated 전체 ${categorySampleSize}건):`,
    categoryBreakdown.map((c) => `${c.label}:${c.count}`).join(', '),
    `products:`,
    productBreakdown.map((p) => `${p.label}:${p.count}`).join(', '),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
