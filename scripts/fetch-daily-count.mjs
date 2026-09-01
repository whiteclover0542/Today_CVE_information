import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const HISTORY_PATH = new URL('../data/history.json', import.meta.url);
const TIMEZONE = 'Asia/Seoul';
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const MAX_HIGHLIGHTS = 3;
const CATEGORY_SAMPLE_SIZE = 20; // 심각도별로 이 개수만큼 설명을 받아 유형 분류 표본으로 사용 (호출 횟수는 늘지 않음, resultsPerPage만 늘림)

// CVE 설명은 NVD가 정형화된 문구로 작성하는 경우가 많아("... allows remote attackers to execute arbitrary code" 등)
// 키워드 매칭만으로도 꽤 신뢰할 수 있는 유형 분류가 가능함. 위에서 아래로 먼저 걸리는 규칙 하나만 적용.
const CATEGORY_RULES = [
  { key: 'rce', label: '원격 코드 실행', pattern: /remote code execution|arbitrary code execution|code injection|command injection|execute arbitrary code/i },
  { key: 'auth-bypass', label: '인증 우회', pattern: /authentication bypass|missing authentication|without authentication|unauthenticated (attacker|user|caller)|bypass authentication/i },
  { key: 'priv-esc', label: '권한 상승', pattern: /privilege escalation|elevation of privilege|escalate privileges|elevated privileges/i },
  { key: 'sqli', label: 'SQL 인젝션', pattern: /sql injection/i },
  { key: 'xss', label: '크로스사이트 스크립팅(XSS)', pattern: /cross-site scripting|\bxss\b/i },
  { key: 'csrf', label: 'CSRF', pattern: /cross-site request forgery|\bcsrf\b/i },
  { key: 'path-traversal', label: '경로 순회', pattern: /directory traversal|path traversal/i },
  { key: 'buffer-overflow', label: '버퍼 오버플로우', pattern: /buffer overflow|out-of-bounds (read|write)|stack-based buffer|heap-based buffer/i },
  { key: 'info-disclosure', label: '정보 노출', pattern: /information disclosure|sensitive information (exposure|disclosure)|expose sensitive/i },
  { key: 'dos', label: '서비스 거부(DoS)', pattern: /denial of service|\bdos\b/i },
  { key: 'deserialization', label: '역직렬화 취약점', pattern: /deserializ/i },
  { key: 'ssrf', label: 'SSRF', pattern: /server-side request forgery|\bssrf\b/i },
  { key: 'hardcoded-cred', label: '하드코딩된 자격증명', pattern: /hard-?coded credential|default credential/i },
  { key: 'file-upload', label: '위험한 파일 업로드', pattern: /unrestricted upload|arbitrary file upload|malicious file upload/i },
];

function categorize(description) {
  const rule = CATEGORY_RULES.find((r) => r.pattern.test(description));
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

  // 키 없이 호출하면 30초당 5회 제한(NVD 공식 문서) — 4개 심각도 질의를 여유 있게 간격을 두고 순차 호출.
  // resultsPerPage를 늘려 같은 호출에서 건수(totalResults)·대표 CVE(vulnerabilities)·유형 분류용 표본을 함께 받는다(호출 횟수는 그대로 5회).
  const severity = {};
  const rawHighlights = [];
  const usedHighlightCategories = new Set(); // 대표 CVE 3건이 서로 다른 유형이 되도록 이미 뽑힌 유형은 건너뜀
  const categoryCounts = {};
  let categorySampleSize = 0;
  for (const level of SEVERITIES) {
    await sleep(1500);
    const sevUrl = new URL(baseUrl);
    sevUrl.searchParams.set('cvssV3Severity', level);
    sevUrl.searchParams.set('resultsPerPage', String(CATEGORY_SAMPLE_SIZE));
    const body = await fetchJson(sevUrl);
    severity[level.toLowerCase()] = body.totalResults;

    for (const { cve } of body.vulnerabilities || []) {
      const desc = (cve.descriptions || []).find((d) => d.lang === 'en')?.value || '';

      categorySampleSize += 1;
      const categoryKey = categorize(desc);
      categoryCounts[categoryKey] = (categoryCounts[categoryKey] || 0) + 1;

      if (rawHighlights.length < MAX_HIGHLIGHTS && !usedHighlightCategories.has(categoryKey)) {
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
    }
  }
  const rated = severity.critical + severity.high + severity.medium + severity.low;
  severity.unrated = Math.max(0, total - rated); // CVSSv3 점수가 아직 없는(평가 대기) 건수

  const categoryLabels = Object.fromEntries(CATEGORY_RULES.map((r) => [r.key, r.label]));
  categoryLabels.other = '기타';
  // 잘라내지 않고 전부 저장 — 화면(오늘 카드)에서는 상위 6개만 보여주지만,
  // 월별 합산 그래프는 이 전체 목록을 더해야 작은 유형도 누락 없이 집계됨
  const categoryBreakdown = Object.entries(categoryCounts)
    .map(([key, count]) => ({ key, label: categoryLabels[key], count }))
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
  };

  history.push(entry);
  history.sort((a, b) => a.date.localeCompare(b.date));

  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');
  console.log(
    `[saved] ${kstDate} -> ${entry.count}건`,
    severity,
    `highlights: ${highlights.length}`,
    `categories(표본 ${categorySampleSize}건):`,
    categoryBreakdown,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
