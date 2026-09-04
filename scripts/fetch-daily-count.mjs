import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CWE_INFO } from './cwe-info.mjs';
import { PRODUCT_INFO } from './product-info.mjs';

const HISTORY_PATH = new URL('../data/history.json', import.meta.url);
const TIMEZONE = 'Asia/Seoul';
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
// 심각·높음·중간 중 CWE 있는 CVE는 전부 대표로 올리는 게 목표라 상한을 넉넉하게 잡음(과거 기록 기준 이 세 등급 합계는
// 보통 20~50건대). 그래도 유난히 많은 날을 대비한 안전장치로만 존재 — 실제 배치 로그 보면서 필요시 조정, docs/PROGRESS.md 참고.
const MAX_HIGHLIGHTS = 50;
const HIGHLIGHT_ELIGIBLE_SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM']); // LOW는 대표 후보에서 제외(요청사항)
const MAX_SECONDARY_HIGHLIGHTS = 20; // CWE 분류가 없어 대표(AI 해설 대상)로 못 올린 CVE를 목록으로만 따로 보여줄 상한
const PAGE_SIZE = 2000; // NVD CVE API 2.0 공식 문서상 resultsPerPage 최대값 — 하루치 심각도별 CVE는 사실상 이 안에 다 들어와 대부분 한 번의 호출로 전량이 수집됨
const NVD_REQUEST_INTERVAL_MS = 6500; // 무키 제한 30초당 5회 — 페이지가 늘어 호출이 몇 번이 되든 이 간격을 지키면 항상 제한 안쪽에 머문다
const CATEGORY_EXAMPLES_LIMIT = 3; // 유형별로 원본 링크를 몇 건까지 같이 저장할지 (번역은 안 함 — API 호출 추가 없음)

// CVE 설명은 NVD가 정형화된 문구로 작성하는 경우가 많아("... allows remote attackers to execute arbitrary code" 등)
// 키워드 매칭만으로도 꽤 신뢰할 수 있는 유형 분류가 가능함. 위에서 아래로 먼저 걸리는 규칙 하나만 적용.
//
// 순서가 중요하다 — NVD 설명은 보통 "실제 취약점 유형"과 "그로 인한 결과/전제조건"을 한 문장에 같이 쓴다
// (예: "SQL injection ... allows an unauthenticated attacker to ..."). rce/auth-bypass/priv-esc/access-control/dos는
// 거의 항상 "결과"나 "공격자 전제조건" 쪽 표현이라 다른 구체적 취약점 유형(sqli/xss/buffer-overflow/ssrf 등)과
// 한 문장에 같이 등장하는 경우가 매우 흔하다. 그래서 이 다섯 개를 맨 뒤로 보내 구체적 유형이 항상 먼저 매칭되게 한다
// (2026-09-04 평가에서 실제로 SQLi/XSS/버퍼오버플로우 CVE가 이 순서 문제로 auth-bypass/priv-esc/rce에 잘못
// 걸리는 사례를 다수 확인함 — docs/AI_EVAL_REPORT.md §7-1 참고).
export const CATEGORY_RULES = [
  { key: 'sqli', label: 'SQL 인젝션', pattern: /sql injection/i },
  { key: 'xss', label: '크로스사이트 스크립팅(XSS)', pattern: /cross-site scripting|\bxss\b/i },
  { key: 'csrf', label: 'CSRF', pattern: /cross-site request forgery|\bcsrf\b/i },
  { key: 'path-traversal', label: '경로 순회', pattern: /directory traversal|path traversal/i },
  { key: 'ssrf', label: 'SSRF', pattern: /server-side request forgery|\bssrf\b/i },
  { key: 'xxe', label: 'XML 외부 개체 주입(XXE)', pattern: /xml external entity|\bxxe\b/i },
  { key: 'ldap-injection', label: 'LDAP 인젝션', pattern: /ldap injection/i },
  { key: 'format-string', label: '포맷 스트링 취약점', pattern: /format string/i },
  { key: 'hardcoded-cred', label: '하드코딩된 자격증명', pattern: /hard-?coded credential|default credential/i },
  { key: 'use-after-free', label: '메모리 해제 후 사용(UAF)', pattern: /use-after-free|use after free/i },
  { key: 'deserialization', label: '역직렬화 취약점', pattern: /deserializ/i },
  { key: 'buffer-overflow', label: '버퍼 오버플로우', pattern: /buffer overflow|out-of-bounds (read|write)|stack-based buffer|heap-based buffer/i },
  { key: 'integer-overflow', label: '정수 오버플로우', pattern: /integer overflow|integer underflow/i },
  { key: 'type-confusion', label: '타입 컨퓨전', pattern: /type confusion/i },
  { key: 'null-deref', label: 'NULL 포인터 역참조', pattern: /null pointer dereference/i },
  { key: 'race-condition', label: '경쟁 조건', pattern: /race condition|time-of-check.{0,20}time-of-use|\btoctou\b/i },
  { key: 'open-redirect', label: '오픈 리다이렉트', pattern: /open redirect/i },
  { key: 'cert-validation', label: '인증서 검증 오류', pattern: /improper certificate validation|certificate validation/i },
  { key: 'weak-crypto', label: '취약한 암호화·난수 사용', pattern: /broken or risky cryptographic algorithm|weak encryption algorithm|insufficiently random values|insecure randomness/i },
  { key: 'cleartext', label: '평문 전송(암호화 누락)', pattern: /cleartext transmission|missing encryption of sensitive data|transmitted in clear text/i },
  { key: 'file-upload', label: '위험한 파일 업로드', pattern: /unrestricted upload|arbitrary file upload|malicious file upload/i },
  { key: 'info-disclosure', label: '정보 노출', pattern: /information disclosure|sensitive information (exposure|disclosure)|expose sensitive/i },
  { key: 'idor', label: '취약한 직접 개체 참조(IDOR)', pattern: /insecure direct object reference|\bidor\b/i },
  // --- 아래부터는 "결과/전제조건" 표현이라 다른 구체적 유형과 자주 겹쳐서 맨 뒤로 뺀 규칙들 ---
  { key: 'rce', label: '원격 코드 실행', pattern: /remote code execution|arbitrary code execution|code injection|command injection|execute arbitrary code/i },
  { key: 'auth-bypass', label: '인증 우회', pattern: /authentication bypass|missing authentication|without authentication|unauthenticated (attacker|user|caller)|bypass authentication/i },
  { key: 'priv-esc', label: '권한 상승', pattern: /privilege escalation|elevation of privilege|escalate privileges|elevated privileges|improper privilege management/i },
  { key: 'access-control', label: '접근 통제 오류', pattern: /improper access control|missing access control|access control bypass|broken access control|incorrect access control|missing authorization|improper authorization/i },
  { key: 'dos', label: '서비스 거부(DoS)', pattern: /denial of service|\bdos\b/i },
  { key: 'input-validation', label: '입력값 검증 미흡', pattern: /improper input validation|insufficient input validation/i },
];

export function categorize(description) {
  const rule = CATEGORY_RULES.find((r) => r.pattern.test(description));
  return rule ? rule.key : 'other';
}

// 규칙 매칭에서 "기타"로 빠진 CVE만 모아 LLM(Gemini 무료 티어)에 한 번에 보내 재분류한다.
// LLM은 위 CATEGORY_RULES 라벨 중에서만 고르도록 강제(닫힌 집합) — 새 유형을 마음대로 만들면
// 유형 목록이 계속 늘어나 일관성이 깨지므로, 정말 안 맞을 때만 'other'를 유지하게 한다.
// 키 없음/네트워크 실패/무료 티어 한도 초과 등 어떤 이유로든 실패하면 규칙 분류 결과(전부 '기타') 그대로 둔다 — 번역과 동일한 폴백 원칙.
const LLM_RECLASSIFY_LIMIT = 300; // 하루 재분류 대상 상한(무료 티어 요청 크기 안전장치) — 초과분은 '기타'로 남음
export const GEMINI_MODEL = 'gemini-3.5-flash-lite'; // 무료 티어의 가장 가벼운 모델 — 이 이름이 만료되면 https://aistudio.google.com 에서 현재 무료 티어 모델명으로 교체
export const CATEGORY_KEYS = [...CATEGORY_RULES.map((r) => r.key), 'other'];

export async function classifyOthersWithLlm(items) {
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
                '분류 기준: "그 취약점이 기술적으로 무엇인가(원인 메커니즘)"로 분류하고, "그래서 결과적으로 무엇이 가능해지는가"는 무시해. ' +
                '예를 들어 SQL 인젝션이 원격 코드 실행이나 권한 상승으로 이어진다고 적혀 있어도 정답은 sqli야(rce나 priv-esc가 아님). ' +
                '"unauthenticated attacker"/"allows an attacker to ..." 같은 문구는 공격자 조건을 설명하는 것일 뿐 취약점 유형이 아니니, ' +
                '그 문장에 SQL 인젝션·XSS·경로 순회처럼 더 구체적인 유형이 함께 언급돼 있다면 그쪽을 우선해.\n\n' +
                '헷갈리기 쉬운 유형 힌트:\n' +
                '- idor: "user-controlled key/ID/parameter"로 다른 사용자의 리소스에 접근/조작할 수 있다는 서술(소유권 확인 없이 ID만으로 접근)\n' +
                '- ssrf: 서버가 사용자가 지정한 URL/호스트로 요청을 보내며, 그 대상이 내부망·클라우드 메타데이터 엔드포인트·임의 호스트로 리다이렉트될 수 있다는 서술("SSRF"라는 단어가 없어도 이 패턴이면 ssrf)\n\n' +
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

// v3.1 우선, 없으면 v3.0, 그마저 없으면 v2 순으로 대체(NVD가 오래된 CVE엔 v3를 안 매기는 경우가 있음)
function pickCvss(cve) {
  const metrics = cve.metrics || {};
  return (metrics.cvssMetricV31 || metrics.cvssMetricV30 || metrics.cvssMetricV2 || [])[0] || null;
}

const HIGHLIGHT_LLM_INTERVAL_MS = 4500; // Gemini 무료 티어 분당 요청 한도가 공개돼 있지 않아 보수적으로 잡은 호출 간격 — 배치 로그의 usageMetadata로 계속 점검하며 조정

// NVD가 "Primary"로 표시한 CWE를 먼저 오게 정렬한다 — 집계(cweCounts)에서 CVE 하나당 CWE 하나만 셀 때
// 이 배열의 첫 번째 값(cwe[0])을 그 CVE의 대표 CWE로 쓰기 위함(카드 표시는 배열 전체를 다 보여줌).
function extractCwe(cve) {
  const primaryIds = [];
  const secondaryIds = [];
  for (const w of cve.weaknesses || []) {
    const bucket = w.type === 'Primary' ? primaryIds : secondaryIds;
    for (const d of w.description || []) {
      if (d.lang === 'en' && /^CWE-\d+$/.test(d.value)) bucket.push(d.value);
    }
  }
  const ids = [...new Set([...primaryIds, ...secondaryIds])];
  return ids.map((id) => ({ id, label: CWE_INFO[id]?.label || null, hint: CWE_INFO[id]?.hint || null }));
}

// 429(RESOURCE_EXHAUSTED) 응답 본문의 retryDelay(예: "17s")를 ms로 뽑아낸다. 분당 요청 한도 초과는
// 고정 2초 대기 정도로는 재시도해도 또 실패하는 걸 실측으로 확인했음(서버가 15~20초를 요구하는데
// 그보다 짧게 기다리면 재시도도 똑같이 걸림) — 그래서 서버가 알려준 시간만큼 정확히 기다린다.
// retryDelay가 없는 다른 종류의 오류(네트워크 등)면 짧게(2초)만 기다린다.
function retryDelayMs(message) {
  const m = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Math.ceil(Number(m[1]) * 1000) + 500 : 2000; // 여유 0.5초 추가
}

// 대표 CVE 한 건을 번역+해석+발생 원인+방지법까지 한 번의 LLM 호출로 생성한다(번역 전용 API를 따로 안 씀 — 이번 개선 목표).
// CWE 정보가 있으면 근거로 같이 주고, 없거나 설명 문구로 확인할 수 없는 내용은 빈 문자열로 남기게 못박아 지어내지 않게 한다.
// 키가 없거나 호출이 실패하면 null을 반환하고, 호출부가 원문만 노출하는 기존 폴백 원칙을 그대로 따른다.
export async function explainHighlightWithLlm(desc, cweList) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[skip] GEMINI_API_KEY 없음 — 대표 CVE 번역·해설 건너뜀(원문만 노출)');
    return null;
  }

  const cweContext = (cweList || [])
    .map((c) => {
      const info = CWE_INFO[c.id];
      return info ? `${c.id} (${info.label}): 일반적으로 ${info.hint}` : `${c.id} (목록에 없는 분류)`;
    })
    .join('\n');

  const responseSchema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      summaryKo: { type: 'string' },
      interpretation: { type: 'string' },
      cause: { type: 'string' },
      mitigation: { type: 'string' },
    },
    required: ['title', 'summaryKo', 'interpretation', 'cause', 'mitigation'],
  };

  // 실제 배치에서 대표 CVE 93건 중 11건(11.8%)이 해설 생성에 실패해 원문 폴백으로 남는 것을 확인했다
  // (docs/AI_EVAL_REPORT.md §6-5, 목표 90% 대비 근소 미달). 정확한 실패 원인(네트워크 순간 오류 등)은
  // 로그가 남아있지 않아 특정할 수 없지만, 어떤 원인이든 1회 재시도로 완화될 가능성이 있어 추가함 —
  // 그래도 실패하면 기존과 동일하게 null을 반환해 원문 폴백 원칙은 유지된다.
  async function attempt() {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text:
                '너는 CVE(보안 취약점) 설명을 한국 독자에게 풀어 설명하는 보안 분석가야. 아래 5가지를 채워:\n' +
                '1) title: 이 CVE가 무엇에 관한 것인지 한눈에 알 수 있는 한국어 제목 1개(15~30자 내외, 명사형으로 끝맺기). ' +
                '영향받는 제품·유형·핵심 위험을 담되 과장하거나 지어내지 말 것(예: "OO 플러그인 인증 우회로 관리자 권한 탈취 가능")\n' +
                '2) summaryKo: 영문 설명을 자연스러운 한국어로 번역\n' +
                '3) interpretation: 보안 지식이 없는 사람도 이해할 수 있게 쉽게 풀어 쓴 해석 1~2문장\n' +
                '4) cause: 이런 취약점이 보통 왜 생기는지 1~2문장. 아래에 이 CVE의 공식 CWE 분류 정보가 주어졌다면 ' +
                '그 hint 문장을 반드시 활용해 채워라(빈 문자열로 남기지 마라 — 근거가 이미 주어졌는데 비우는 건 오답이다). ' +
                'CWE 분류 정보가 아예 주어지지 않은 경우에만, 설명 문구로 확인할 수 없는 내용을 지어내지 말고 빈 문자열("")로 남겨\n' +
                '5) mitigation: 방지·완화 방법 1~2문장(패치 적용, 설정 점검 등 일반적 대응). 근거가 부족하면 빈 문자열로 남겨\n' +
                '모든 필드는 한국어로 작성하고, 확신이 없는 내용은 빈 문자열로 남겨(지어내지 마).' +
                (cweContext
                  ? `\n\n이 CVE의 공식 CWE(취약점 유형) 분류:\n${cweContext}`
                  : '\n\n이 CVE에는 공식 CWE 분류 정보가 없음.'),
            },
          ],
        },
        contents: [{ role: 'user', parts: [{ text: desc }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema },
      }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${await res.text()}`);
    }

    const body = await res.json();
    const usage = body.usageMetadata;
    if (usage) {
      console.log(`[llm] 대표 CVE 해설 생성 — 입력 ${usage.promptTokenCount} / 출력 ${usage.candidatesTokenCount} 토큰`);
    }

    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('응답이 비어 있음');
    return JSON.parse(text);
  }

  for (let i = 0; i < 2; i += 1) {
    try {
      return await attempt();
    } catch (e) {
      const label = i === 0 ? '1차 시도' : '재시도';
      console.warn(`[warn] 대표 CVE 해설 생성 실패(${label}): ${e.message}`);
      if (i === 0) await new Promise((r) => setTimeout(r, retryDelayMs(e.message)));
    }
  }
  console.warn('[warn] 대표 CVE 해설 생성 최종 실패 — 원문만 노출');
  return null;
}

// 그날 집계된 숫자(총 건수·심각도별 건수·최다 CWE 유형·최다 제품)만 근거로 1~3문장 브리핑을 만든다.
// 개별 CVE 설명은 넘기지 않는다 — 대표 CVE 카드가 이미 그 역할을 하므로, 브리핑은 "오늘 하루 전체 그림"만 담당.
// 키 없음/실패 시 null 반환 — 프론트는 이 필드가 없으면 카드 자체를 숨긴다(지어내지 않음 원칙 유지).
export async function generateBriefingWithLlm(stats) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[skip] GEMINI_API_KEY 없음 — 오늘의 브리핑 생성 건너뜀');
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

  async function attempt() {
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
                '확신이 없는 내용은 아예 문장에 넣지 마(지어내지 마). ' +
                '조사 사용에 주의해: "-별" 뒤에는 항상 "-별로"를 써("-별으로"는 앞에 어떤 명사가 오든 항상 틀림 — ' +
                '예: "벤더별로는", "유형별로는"이 맞고 "벤더별으로는"/"유형별으로는"은 틀림). 최다 유형/제품이 없는 날은 입력에 준 문구("오늘은 CWE 유형 ' +
                '집계 대상이 없음"/"오늘은 특정 제품·벤더가 두드러지지 않음")를 어색하게 다시 풀어쓰지 말고 그 표현을 최대한 그대로 살려서 써.',
            },
          ],
        },
        contents: [{ role: 'user', parts: [{ text: statLines }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema },
      }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${await res.text()}`);
    }

    const body = await res.json();
    const usage = body.usageMetadata;
    if (usage) {
      console.log(`[llm] 오늘의 브리핑 생성 — 입력 ${usage.promptTokenCount} / 출력 ${usage.candidatesTokenCount} 토큰`);
    }

    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('응답이 비어 있음');
    return JSON.parse(text).briefing?.trim() || null;
  }

  for (let i = 0; i < 2; i += 1) {
    try {
      return await attempt();
    } catch (e) {
      const label = i === 0 ? '1차 시도' : '재시도';
      console.warn(`[warn] 오늘의 브리핑 생성 실패(${label}): ${e.message}`);
      if (i === 0) await new Promise((r) => setTimeout(r, retryDelayMs(e.message)));
    }
  }
  console.warn('[warn] 오늘의 브리핑 생성 최종 실패');
  return null;
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
  const secondaryHighlights = []; // CWE 분류가 없는 CVE — AI 해설 없이 목록으로만 아래에 따로 보여줌
  const usedHighlightIds = new Set();
  const productCounts = {};
  const productExamples = {}; // 벤더·제품별 원본 CVE 링크 몇 건 — 유형과 동일한 방식
  const otherCandidates = []; // 규칙 매칭에서 '기타'로 빠진 CVE — 나중에 LLM으로 한 번에 재분류(대표 CVE 카드의 🏷 유형 태그용)
  const cweCounts = {}; // "오늘 등록분 CWE 유형" 집계 — CVE 하나당 대표 CWE 하나(cwe[0])만 셈, 없으면 'none'
  const cweExamples = {};
  let categorySampleSize = 0; // 심각도가 평가된(rated) CVE 전체 건수 — 전량 수집이라 rated 총합과 같아짐(unrated는 애초에 이 호출 대상이 아니라 여전히 빠짐)
  for (const level of SEVERITIES) {
    const { total: levelTotal, vulnerabilities } = await fetchAllForSeverity(baseUrl, level);
    severity[level.toLowerCase()] = levelTotal;

    const levelCandidates = []; // 이 심각도 안에서 대표 CVE 후보로 쓸 목록

    for (const { cve } of vulnerabilities) {
      const desc = (cve.descriptions || []).find((d) => d.lang === 'en')?.value || '';

      categorySampleSize += 1;
      // 카드의 🏷 유형 태그(규칙 기반)용 — 아래 CWE 집계와는 별개 용도라 그대로 유지
      const categoryKey = categorize(desc);
      if (categoryKey === 'other') {
        otherCandidates.push({ id: cve.id, desc });
      }

      const productKey = categorizeProduct(desc);
      productCounts[productKey] = (productCounts[productKey] || 0) + 1;
      const productExampleList = (productExamples[productKey] ||= []);
      if (productExampleList.length < CATEGORY_EXAMPLES_LIMIT) {
        productExampleList.push({ id: cve.id, url: `https://nvd.nist.gov/vuln/detail/${cve.id}` });
      }

      const cwe = extractCwe(cve);
      const cweKey = cwe[0]?.id || 'none'; // 여러 개면 대표(Primary 우선) 하나만 집계 — CVE 하나=한 칸 원칙 유지
      cweCounts[cweKey] = (cweCounts[cweKey] || 0) + 1;
      const cweExampleList = (cweExamples[cweKey] ||= []);
      if (cweExampleList.length < CATEGORY_EXAMPLES_LIMIT) {
        cweExampleList.push({ id: cve.id, url: `https://nvd.nist.gov/vuln/detail/${cve.id}` });
      }

      levelCandidates.push({ cve, desc, categoryKey, cwe, cvss: pickCvss(cve) });
    }

    // 대표 CVE 선정: 심각도가 항상 먼저다(CRITICAL → HIGH → MEDIUM 순으로 이 바깥 for문이 이미 그 순서로 돎).
    // NVD 공식 CWE 분류가 있는 CVE만 대표(=AI 해설 대상)로 올린다 — "발생 원인"을 근거 있게 grounding하기 위함.
    // 예전엔 유형 다양성을 우선했지만, 지금은 "심각·높음·중간은 CWE 있는 건 전부 보여준다"가 목표라 그런 샘플링 없이
    // CWE 있는 후보를 CVSS 높은 순으로 정렬해 상한(MAX_HIGHLIGHTS)까지 채운다 — 어쩔 수 없이 잘릴 때도 더 위험한 것부터 남게.
    // LOW는 HIGHLIGHT_ELIGIBLE_SEVERITIES에 없어 대표 후보 자체에서 제외된다.
    if (HIGHLIGHT_ELIGIBLE_SEVERITIES.has(level)) {
      const eligible = levelCandidates
        .filter((c) => c.cwe.length > 0)
        .sort((a, b) => (b.cvss?.cvssData?.baseScore ?? 0) - (a.cvss?.cvssData?.baseScore ?? 0));

      for (const { cve, desc, categoryKey, cwe, cvss } of eligible) {
        if (rawHighlights.length >= MAX_HIGHLIGHTS) break;
        if (usedHighlightIds.has(cve.id)) continue;

        usedHighlightIds.add(cve.id);
        rawHighlights.push({
          id: cve.id,
          severity: level,
          fullEn: desc,
          categoryKey,
          cwe,
          url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
          cvssScore: cvss?.cvssData?.baseScore ?? null,
          cvssVector: cvss?.cvssData?.vectorString ?? null,
        });
      }
    }

    // CWE가 없어 대표로 못 올린 CVE 중 심각도 상위부터 목록에만 채움 — LLM 호출은 안 함(비용 절감 + 애초에 grounding할 CWE가 없어서 해설을 붙일 근거가 없음).
    for (const { cve, categoryKey, cwe, cvss } of levelCandidates) {
      if (secondaryHighlights.length >= MAX_SECONDARY_HIGHLIGHTS) break;
      if (usedHighlightIds.has(cve.id)) continue;
      if (cwe.length > 0) continue; // CWE 있는 건 대표 후보 몫 — 자리가 없어 못 들어갔어도 이 목록 취지와 다르므로 제외

      usedHighlightIds.add(cve.id);
      secondaryHighlights.push({
        id: cve.id,
        severity: level,
        categoryKey,
        url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
        cvssScore: cvss?.cvssData?.baseScore ?? null,
        cvssVector: cvss?.cvssData?.vectorString ?? null,
      });
    }
  }
  const rated = severity.critical + severity.high + severity.medium + severity.low;
  severity.unrated = Math.max(0, total - rated); // CVSSv3 점수가 아직 없는(평가 대기) 건수

  // 카드의 🏷 유형 태그(규칙 기반)만 보정 대상 — "오늘 등록분 CWE 유형" 집계는 NVD 공식 값을 그대로 쓰므로 재분류 대상이 아님
  const reclassified = await classifyOthersWithLlm(otherCandidates);
  for (const [id, newKey] of Object.entries(reclassified)) {
    if (newKey === 'other' || !CATEGORY_KEYS.includes(newKey)) continue;

    const highlight = rawHighlights.find((h) => h.id === id) || secondaryHighlights.find((h) => h.id === id);
    if (highlight) highlight.categoryKey = newKey;
  }

  const categoryLabels = Object.fromEntries(CATEGORY_RULES.map((r) => [r.key, r.label]));
  categoryLabels.other = '기타';

  // "오늘 등록분 CWE 유형" 집계 — NVD 공식 분류를 그대로 세어 위조 없이 보여준다(LLM 재분류 없음).
  // 잘라내지 않고 전부 저장 — 화면(오늘 카드)에서는 상위 10개만 보여주지만, 월별 합산 그래프는
  // 이 전체 목록을 더해야 작은 유형도 누락 없이 집계됨.
  const cweBreakdown = Object.entries(cweCounts)
    .map(([key, count]) => {
      const info = CWE_INFO[key];
      return {
        key,
        label: key === 'none' ? 'CWE 미분류' : (info?.label || key),
        count,
        desc: key === 'none'
          ? '이 CVE들은 NVD가 아직 CWE(취약점 유형) 분류를 매기지 않았어요.'
          : (info?.hint || ''),
        examples: cweExamples[key] || [],
      };
    })
    .sort((a, b) => b.count - a.count);

  // "기타"는 화면에 안 보여줄 거라 애초에 제외 — 목록에 확실히 있는 벤더만 건수·원본 CVE 링크와 함께 남김.
  const productLabels = Object.fromEntries(PRODUCT_RULES.map((r) => [r.key, r.label]));
  const productBreakdown = Object.entries(productCounts)
    .filter(([key]) => key !== 'other')
    .map(([key, count]) => ({
      key,
      label: productLabels[key],
      count,
      desc: PRODUCT_INFO[key] || '',
      examples: productExamples[key] || [],
    }))
    .sort((a, b) => b.count - a.count);

  // 대표 CVE마다 번역+해석+발생 원인+방지법을 LLM 호출 한 번으로 생성 (NVD 호출과 별개 서비스라 위 5회 제한과 무관,
  // 대신 Gemini 쪽 한도를 위해 HIGHLIGHT_LLM_INTERVAL_MS만큼 간격을 둠).
  // 화면에서 "자세히 보기"로 전문·원문을 다 보여줄 수 있도록 자르지 않고 그대로 저장한다.
  const highlights = [];
  for (const h of rawHighlights) {
    await sleep(HIGHLIGHT_LLM_INTERVAL_MS);
    const llm = await explainHighlightWithLlm(h.fullEn, h.cwe);
    highlights.push({
      id: h.id,
      date: kstDate,
      severity: h.severity,
      title: llm?.title || null,
      summaryEn: h.fullEn,
      summaryKo: llm?.summaryKo || null,
      interpretation: llm?.interpretation || null,
      cause: llm?.cause || null,
      mitigation: llm?.mitigation || null,
      cwe: h.cwe,
      url: h.url,
      cvssScore: h.cvssScore,
      cvssVector: h.cvssVector,
      cvssPlain: decodeCvssVector(h.cvssVector),
      category: categoryLabels[h.categoryKey],
    });
  }

  // CWE가 없어 AI 해설을 못 붙인 CVE — 번역·해설 없이 목록으로만 저장(위조 금지: 근거 없는 해설을 억지로 채우지 않음)
  const secondaryHighlightsOutput = secondaryHighlights.map((s) => ({
    id: s.id,
    severity: s.severity,
    url: s.url,
    cvssScore: s.cvssScore,
    cvssVector: s.cvssVector,
    cvssPlain: decodeCvssVector(s.cvssVector),
    category: categoryLabels[s.categoryKey],
  }));

  await sleep(HIGHLIGHT_LLM_INTERVAL_MS); // 대표 CVE 해설과 별개 호출이지만 동일 레이트리밋 관례를 지킴
  const topCwe = cweBreakdown.filter((c) => c.key !== 'none')[0] || null; // '미분류'는 유형이 아니므로 브리핑 근거에서 제외
  const topProduct = productBreakdown[0] || null;
  const briefing = await generateBriefingWithLlm({ count: total, severity, topCwe, topProduct, categorySampleSize });

  const entry = {
    date: kstDate,
    count: total,
    unit: '건',
    timezone: TIMEZONE,
    sourceApiUrl: baseUrl.toString(),
    queriedAtUtc: now.toISOString(),
    severity,
    highlights,
    secondaryHighlights: secondaryHighlightsOutput,
    cweBreakdown,
    categorySampleSize,
    productBreakdown,
    briefing, // 문자열 또는 null(키 없음·생성 실패·이 기능 이전 기록) — 프론트는 null이면 카드를 통째로 숨김
  };

  history.push(entry);
  history.sort((a, b) => a.date.localeCompare(b.date));

  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');
  console.log(
    `[saved] ${kstDate} -> ${entry.count}건`,
    severity,
    `highlights: ${highlights.length} (CWE 없음 목록: ${secondaryHighlightsOutput.length})`,
    `CWE 유형(rated 전체 ${categorySampleSize}건):`,
    cweBreakdown.map((c) => `${c.label}:${c.count}`).join(', '),
    `products:`,
    productBreakdown.map((p) => `${p.label}:${p.count}`).join(', '),
  );
}

// eval 스크립트 등이 위 함수들만 재사용하려고 이 파일을 import할 때 배치 실행(NVD 호출 등)이
// 같이 튀어나가지 않도록, 직접 실행(`node scripts/fetch-daily-count.mjs`)했을 때만 main()을 돌린다.
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
