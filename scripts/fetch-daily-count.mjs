import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const HISTORY_PATH = new URL('../data/history.json', import.meta.url);
const TIMEZONE = 'Asia/Seoul';
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
// 심각·높음·중간 중 CWE 있는 CVE는 전부 대표로 올리는 게 목표라 상한을 넉넉하게 잡음(과거 기록 기준 이 세 등급 합계는
// 보통 20~50건대). 그래도 유난히 많은 날을 대비한 안전장치로만 존재 — 실제 배치 로그 보면서 필요시 조정, PROGRESS.md 참고.
const MAX_HIGHLIGHTS = 50;
const HIGHLIGHT_ELIGIBLE_SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM']); // LOW는 대표 후보에서 제외(요청사항)
const MAX_SECONDARY_HIGHLIGHTS = 20; // CWE 분류가 없어 대표(AI 해설 대상)로 못 올린 CVE를 목록으로만 따로 보여줄 상한
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

// v3.1 우선, 없으면 v3.0, 그마저 없으면 v2 순으로 대체(NVD가 오래된 CVE엔 v3를 안 매기는 경우가 있음)
function pickCvss(cve) {
  const metrics = cve.metrics || {};
  return (metrics.cvssMetricV31 || metrics.cvssMetricV30 || metrics.cvssMetricV2 || [])[0] || null;
}

const HIGHLIGHT_LLM_INTERVAL_MS = 4500; // Gemini 무료 티어 분당 요청 한도가 공개돼 있지 않아 보수적으로 잡은 호출 간격 — 배치 로그의 usageMetadata로 계속 점검하며 조정

// CWE(Common Weakness Enumeration)는 NVD가 공식적으로 매기는 "취약점 유형" 표준 분류.
// 이걸 LLM에게 근거로 같이 주면 "왜 발생했는지"를 그럴듯하게 지어내는 대신 표준 분류에 발 붙이고 설명하게 만들 수 있다.
// 전체 CWE를 다 담지는 않고 NVD 응답에서 실제로 자주 보이는 것 위주로만 채움 — 목록에 없으면 라벨 없이 ID만 노출(위조 금지).
const CWE_INFO = {
  'CWE-79': { label: '크로스사이트 스크립팅(XSS)', hint: '사용자 입력을 검증·이스케이프 없이 웹페이지에 그대로 출력해서 발생' },
  'CWE-89': { label: 'SQL 인젝션', hint: '사용자 입력을 SQL 문에 그대로 이어붙여서 발생' },
  'CWE-78': { label: 'OS 명령 인젝션', hint: '사용자 입력을 운영체제 명령어에 그대로 넘겨서 발생' },
  'CWE-77': { label: '명령 인젝션', hint: '사용자 입력이 실행할 명령의 일부로 해석되도록 방치해서 발생' },
  'CWE-94': { label: '코드 인젝션', hint: '사용자 입력이 실행 가능한 코드로 해석되도록 방치해서 발생' },
  'CWE-22': { label: '경로 순회', hint: '파일 경로에 들어가는 입력값을 검증하지 않아 상위 폴더로 벗어날 수 있어서 발생' },
  'CWE-352': { label: 'CSRF', hint: '요청이 실제 사용자의 의도인지 확인하는 토큰·검증이 없어서 발생' },
  'CWE-306': { label: '인증 누락', hint: '반드시 인증이 필요한 기능에 인증 절차 자체가 없어서 발생' },
  'CWE-287': { label: '부적절한 인증', hint: '인증 절차는 있지만 우회하거나 속일 수 있게 허술해서 발생' },
  'CWE-269': { label: '부적절한 권한 관리', hint: '권한을 부여·회수·검사하는 로직이 허술해서 발생' },
  'CWE-284': { label: '부적절한 접근 통제', hint: '자원에 누가 접근할 수 있는지 제대로 제한하지 않아서 발생' },
  'CWE-862': { label: '권한 검사 누락', hint: '기능을 실행하기 전에 권한이 있는지 확인하는 절차 자체가 없어서 발생' },
  'CWE-863': { label: '부정확한 권한 검사', hint: '권한 검사는 있지만 조건이 잘못돼 있어서 발생' },
  'CWE-798': { label: '하드코딩된 자격증명', hint: '비밀번호·키가 소스코드나 설정 파일에 고정값으로 박혀 있어서 발생' },
  'CWE-434': { label: '위험한 파일 업로드', hint: '업로드되는 파일의 종류·내용을 제한하지 않아서 발생' },
  'CWE-502': { label: '역직렬화 취약점', hint: '신뢰할 수 없는 데이터를 검증 없이 객체로 복원해서 발생' },
  'CWE-611': { label: 'XML 외부 개체 주입(XXE)', hint: 'XML 파서가 외부 개체 참조를 제한 없이 처리해서 발생' },
  'CWE-918': { label: 'SSRF', hint: '서버가 사용자가 지정한 주소로 요청을 보내면서 목적지를 제한하지 않아서 발생' },
  'CWE-190': { label: '정수 오버플로우', hint: '계산 결과가 변수가 담을 수 있는 범위를 넘는지 확인하지 않아서 발생' },
  'CWE-125': { label: '버퍼 범위 밖 읽기', hint: '읽으려는 위치가 할당된 메모리 범위 안인지 확인하지 않아서 발생' },
  'CWE-787': { label: '버퍼 범위 밖 쓰기', hint: '쓰려는 위치가 할당된 메모리 범위 안인지 확인하지 않아서 발생' },
  'CWE-416': { label: '메모리 해제 후 사용(UAF)', hint: '이미 해제한 메모리를 계속 참조할 수 있는 상태로 남겨둬서 발생' },
  'CWE-476': { label: 'NULL 포인터 역참조', hint: '값이 비어 있을 수 있는 상황을 확인하지 않고 그대로 사용해서 발생' },
  'CWE-843': { label: '타입 컨퓨전', hint: '데이터의 실제 타입을 확인하지 않고 다른 타입인 것처럼 다뤄서 발생' },
  'CWE-367': { label: '경쟁 조건(TOCTOU)', hint: '확인한 시점과 실제 사용하는 시점 사이에 상태가 바뀔 수 있어서 발생' },
  'CWE-134': { label: '포맷 스트링 취약점', hint: '사용자 입력을 포맷 문자열로 그대로 사용해서 발생' },
  'CWE-90': { label: 'LDAP 인젝션', hint: '사용자 입력을 LDAP 조회문에 그대로 이어붙여서 발생' },
  'CWE-327': { label: '취약한 암호화 알고리즘', hint: '이미 깨진 것으로 알려진 암호화 방식을 사용해서 발생' },
  'CWE-330': { label: '예측 가능한 난수 사용', hint: '보안에 쓰기에 충분히 무작위하지 않은 값을 난수로 사용해서 발생' },
  'CWE-319': { label: '평문 전송', hint: '민감한 정보를 암호화하지 않고 그대로 주고받아서 발생' },
  'CWE-311': { label: '암호화 누락', hint: '저장·전송 과정에서 필요한 암호화 자체를 적용하지 않아서 발생' },
  'CWE-639': { label: '취약한 직접 개체 참조(IDOR)', hint: '요청에 들어있는 ID값만으로 접근을 허용하고 소유권을 확인하지 않아서 발생' },
  'CWE-20': { label: '부적절한 입력값 검증', hint: '입력값의 형식·범위·내용을 충분히 검증하지 않아서 발생' },
  'CWE-400': { label: '자원 소비 과다(DoS)', hint: '처리량·자원 사용을 제한하지 않아 과도한 요청에 시스템이 마비될 수 있어서 발생' },
  'CWE-295': { label: '인증서 검증 오류', hint: '통신 상대의 인증서를 제대로 검증하지 않아서 발생' },
  'CWE-601': { label: '오픈 리다이렉트', hint: '이동시킬 주소를 검증하지 않고 사용자가 지정한 값을 그대로 사용해서 발생' },
  'CWE-200': { label: '민감 정보 노출', hint: '노출되면 안 되는 정보를 접근 제한 없이 응답에 포함해서 발생' },
  'CWE-522': { label: '보호되지 않은 자격증명', hint: '비밀번호 등 인증 정보를 암호화·해시 없이 저장해서 발생' },
  'CWE-732': { label: '잘못된 권한 설정', hint: '파일·자원의 접근 권한을 필요한 범위보다 넓게 설정해서 발생' },
};

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

// 대표 CVE 한 건을 번역+해석+발생 원인+방지법까지 한 번의 LLM 호출로 생성한다(번역 전용 API를 따로 안 씀 — 이번 개선 목표).
// CWE 정보가 있으면 근거로 같이 주고, 없거나 설명 문구로 확인할 수 없는 내용은 빈 문자열로 남기게 못박아 지어내지 않게 한다.
// 키가 없거나 호출이 실패하면 null을 반환하고, 호출부가 원문만 노출하는 기존 폴백 원칙을 그대로 따른다.
async function explainHighlightWithLlm(desc, cweList) {
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
                '너는 CVE(보안 취약점) 설명을 한국 독자에게 풀어 설명하는 보안 분석가야. 아래 5가지를 채워:\n' +
                '1) title: 이 CVE가 무엇에 관한 것인지 한눈에 알 수 있는 한국어 제목 1개(15~30자 내외, 명사형으로 끝맺기). ' +
                '영향받는 제품·유형·핵심 위험을 담되 과장하거나 지어내지 말 것(예: "OO 플러그인 인증 우회로 관리자 권한 탈취 가능")\n' +
                '2) summaryKo: 영문 설명을 자연스러운 한국어로 번역\n' +
                '3) interpretation: 보안 지식이 없는 사람도 이해할 수 있게 쉽게 풀어 쓴 해석 1~2문장\n' +
                '4) cause: 이런 취약점이 보통 왜 생기는지 1~2문장. 아래 CWE 분류 정보가 주어지면 그 근거를 우선 사용하고, ' +
                '없거나 설명 문구로 확인할 수 없으면 지어내지 말고 빈 문자열("")로 남겨\n' +
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
      console.warn(`[warn] 대표 CVE 해설 생성 실패: HTTP ${res.status} ${await res.text()}`);
      return null;
    }

    const body = await res.json();
    const usage = body.usageMetadata;
    if (usage) {
      console.log(`[llm] 대표 CVE 해설 생성 — 입력 ${usage.promptTokenCount} / 출력 ${usage.candidatesTokenCount} 토큰`);
    }

    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.warn('[warn] 대표 CVE 해설 응답이 비어 있음 — 원문만 노출');
      return null;
    }
    return JSON.parse(text);
  } catch (e) {
    console.warn(`[warn] 대표 CVE 해설 생성 실패: ${e.message}`);
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
    .map(([key, count]) => ({ key, label: productLabels[key], count, examples: productExamples[key] || [] }))
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
