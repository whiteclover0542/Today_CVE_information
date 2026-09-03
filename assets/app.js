const HISTORY_URL = 'data/history.json';
const TIMEZONE = 'Asia/Seoul';
const HISTORY_PAGE_SIZE = 14;
let historyPage = 1;

class SimulatedError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

const kstFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: TIMEZONE,
  dateStyle: 'medium',
  timeStyle: 'medium',
});

function formatKst(iso) {
  return `${kstFormatter.format(new Date(iso))} (KST)`;
}

// 배치는 매일 00:00 UTC(=09:00 KST) 실행 — KST는 DST가 없어 UTC 00:00 == KST 09:00
function renderNextAutoCheck() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  els.nextCheck.textContent = formatKst(next.toISOString());
}

async function fetchHistory(simulateKind) {
  if (simulateKind === 'offline') {
    throw new SimulatedError('offline', '오프라인 상태입니다 (network error, 모의)');
  }
  if (simulateKind === 'auth') {
    throw new SimulatedError('auth', 'HTTP 401 Unauthorized (모의)');
  }
  if (simulateKind === 'ratelimit') {
    throw new SimulatedError('ratelimit', 'HTTP 429 Too Many Requests (모의)');
  }
  if (simulateKind === 'timeout') {
    const controller = new AbortController();
    const request = fetch(HISTORY_URL, { signal: controller.signal, cache: 'no-store' });
    controller.abort(); // 실제 요청을 즉시 취소해 진짜 AbortError를 발생시킴
    try {
      await request;
    } catch (e) {
      throw new SimulatedError('timeout', '요청이 시간 초과로 취소되었습니다');
    }
    throw new SimulatedError('timeout', '요청이 시간 초과로 취소되었습니다');
  }
  if (simulateKind === 'malformed') {
    const res = await fetch(HISTORY_URL, { cache: 'no-store' });
    const text = await res.text();
    const broken = text.trimEnd().slice(0, -1); // 마지막 의미 있는 문자(닫는 괄호)를 잘라 실제 파싱 실패를 유발
    try {
      return JSON.parse(broken);
    } catch (e) {
      throw new SimulatedError('malformed', '응답을 해석할 수 없습니다 (JSON parse 실패)');
    }
  }

  const res = await fetch(HISTORY_URL, { cache: 'no-store' });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new SimulatedError('auth', `HTTP ${res.status}`);
    }
    if (res.status === 429) {
      throw new SimulatedError('ratelimit', `HTTP ${res.status}`);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  const text = await res.text();
  return JSON.parse(text);
}

const els = {
  statusBanner: document.getElementById('status-banner'),
  valueNumber: document.getElementById('value-number'),
  valueUnit: document.getElementById('value-unit'),
  sourceLink: document.getElementById('source-link'),
  queriedAt: document.getElementById('queried-at'),
  recordDate: document.getElementById('record-date'),
  nextCheck: document.getElementById('next-check'),
  compareCard: document.getElementById('compare-card'),
  compareArrow: document.getElementById('compare-arrow'),
  compareText: document.getElementById('compare-text'),
  compareWindowNote: document.getElementById('compare-window-note'),
  compareWindowCaveat: document.getElementById('compare-window-caveat'),
  compareWindowTimes: document.getElementById('compare-window-times'),
  severityCard: document.getElementById('severity-card'),
  severityDonut: document.getElementById('severity-donut'),
  severityLegend: document.getElementById('severity-legend'),
  riskMeter: document.getElementById('risk-meter'),
  riskMeterTrack: document.getElementById('risk-meter-track'),
  riskMeterCaption: document.getElementById('risk-meter-caption'),
  categoryCard: document.getElementById('category-card'),
  categoryBars: document.getElementById('category-bars'),
  categoryNote: document.getElementById('category-note'),
  categoryPagination: document.getElementById('category-pagination'),
  categoryPrev: document.getElementById('category-prev'),
  categoryNext: document.getElementById('category-next'),
  categoryPageInfo: document.getElementById('category-page-info'),
  productCard: document.getElementById('product-card'),
  productBars: document.getElementById('product-bars'),
  productNote: document.getElementById('product-note'),
  productPagination: document.getElementById('product-pagination'),
  productPrev: document.getElementById('product-prev'),
  productNext: document.getElementById('product-next'),
  productPageInfo: document.getElementById('product-page-info'),
  monthlyCategoryCard: document.getElementById('monthly-category-card'),
  monthSelect: document.getElementById('month-select'),
  monthlyCategoryTotal: document.getElementById('monthly-category-total'),
  monthlyCategoryBars: document.getElementById('monthly-category-bars'),
  monthlyCategoryNote: document.getElementById('monthly-category-note'),
  monthlyCategoryPagination: document.getElementById('monthly-category-pagination'),
  monthlyCategoryPrev: document.getElementById('monthly-category-prev'),
  monthlyCategoryNext: document.getElementById('monthly-category-next'),
  monthlyCategoryPageInfo: document.getElementById('monthly-category-page-info'),
  monthlyProductCard: document.getElementById('monthly-product-card'),
  monthProductSelect: document.getElementById('month-product-select'),
  monthlyProductTotal: document.getElementById('monthly-product-total'),
  monthlyProductBars: document.getElementById('monthly-product-bars'),
  monthlyProductNote: document.getElementById('monthly-product-note'),
  monthlyProductPagination: document.getElementById('monthly-product-pagination'),
  monthlyProductPrev: document.getElementById('monthly-product-prev'),
  monthlyProductNext: document.getElementById('monthly-product-next'),
  monthlyProductPageInfo: document.getElementById('monthly-product-page-info'),
  highlightsCard: document.getElementById('highlights-card'),
  highlightsList: document.getElementById('highlights-list'),
  trendStats: document.getElementById('trend-stats'),
  trendStatsNote: document.getElementById('trend-stats-note'),
  statAvg: document.getElementById('stat-avg'),
  statMax: document.getElementById('stat-max'),
  statMin: document.getElementById('stat-min'),
  trendNote: document.getElementById('trend-note'),
  trendChart: document.getElementById('trend-chart'),
  historyBody: document.getElementById('history-body'),
  historyPagination: document.getElementById('history-pagination'),
  historyPrev: document.getElementById('history-prev'),
  historyNext: document.getElementById('history-next'),
  historyPageInfo: document.getElementById('history-page-info'),
};

let lastGood = null; // { data, queriedAtIso }

// 최신순으로 14일씩 페이지 단위로 보여줌 — 전체 기록은 계속 쌓이므로 표 하나에 다 넣지 않음
function renderHistoryTable(data) {
  const reversed = [...data].reverse();
  const totalPages = Math.max(1, Math.ceil(reversed.length / HISTORY_PAGE_SIZE));
  historyPage = Math.min(Math.max(historyPage, 1), totalPages);

  const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
  const pageItems = reversed.slice(start, start + HISTORY_PAGE_SIZE);

  els.historyBody.innerHTML = '';
  pageItems.forEach((entry) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${entry.date}</td><td>${entry.count}${entry.unit}</td><td>${entry.queriedAtUtc}</td>`;
    els.historyBody.appendChild(tr);
  });

  els.historyPagination.hidden = reversed.length <= HISTORY_PAGE_SIZE;
  els.historyPageInfo.textContent = `${historyPage} / ${totalPages}`;
  els.historyPrev.disabled = historyPage <= 1;
  els.historyNext.disabled = historyPage >= totalPages;
}

function renderCompare(data) {
  if (data.length < 2) {
    els.compareCard.hidden = true;
    els.compareWindowNote.hidden = true;
    return;
  }
  const latest = data[data.length - 1];
  const prev = data[data.length - 2];
  const diff = latest.count - prev.count;
  const direction = diff > 0 ? '증가' : diff < 0 ? '감소' : '변화 없음';
  const sign = diff > 0 ? '+' : '';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '■';
  const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';

  els.compareCard.hidden = false;
  els.compareCard.className = `compare-inline ${cls}`;
  els.compareArrow.textContent = arrow;
  els.compareText.textContent =
    `${sign}${diff}${latest.unit} (${prev.date} ${prev.count}${prev.unit} → ${latest.date} ${latest.count}${latest.unit}, ${direction})`;

  els.compareWindowNote.hidden = false;
  els.compareWindowCaveat.textContent =
    '※ 각 값은 자정(KST)부터 조회 시각까지의 누적치예요. 조회 시각이 다르면 위 증감폭에 실제 발생량 차이 외에 측정 구간 차이도 섞여 있어요.';
  els.compareWindowTimes.innerHTML = '';
  [prev, latest].forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = `${entry.date} 조회 시각: ${formatKst(entry.queriedAtUtc)}`;
    els.compareWindowTimes.appendChild(li);
  });
}

const SEVERITY_LEVELS = [
  ['critical', '심각', '#ff4d4f'],
  ['high', '높음', '#ff9f43'],
  ['medium', '중간', '#ffd166'],
  ['low', '낮음', '#4dabf7'],
  ['unrated', '평가 대기', '#5a5a62'],
];

function renderSeverity(entry) {
  if (!entry.severity) {
    els.severityCard.hidden = true;
    return;
  }
  els.severityCard.hidden = false;
  const total = entry.count || 1;

  const size = 168;
  const r = 62;
  const strokeWidth = 24;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const rings = SEVERITY_LEVELS
    .map(([key, label, color]) => {
      const v = entry.severity[key] || 0;
      const frac = v / total;
      const len = frac * circumference;
      const dashoffset = -offset;
      offset += len;
      if (v <= 0) return '';
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"
        stroke-dasharray="${len} ${circumference - len}" stroke-dashoffset="${dashoffset}"
        transform="rotate(-90 ${cx} ${cy})"><title>${label}: ${v}건</title></circle>`;
    })
    .join('');

  els.severityDonut.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="오늘 등록분 심각도 분포">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#232327" stroke-width="${strokeWidth}"></circle>
      ${rings}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="30" font-weight="800" fill="#ffffff">${total}</text>
      <text x="${cx}" y="${cy + 20}" text-anchor="middle" font-size="12" fill="#a8a8b0">${entry.unit}</text>
    </svg>`;

  els.severityLegend.innerHTML = SEVERITY_LEVELS
    .map(([key, label, color]) => {
      const v = entry.severity[key] || 0;
      return `<li><span class="dot" style="background:${color}"></span>${label} <b>${v}</b>건</li>`;
    })
    .join('');
}

const RISK_STEPS = [
  { key: 'low', label: '보통', color: '#63e6a5' },
  { key: 'mid', label: '주의', color: '#ff9f43' },
  { key: 'high', label: '위험', color: '#ff4d4f' },
];

// 판단 기준을 코드·화면 양쪽에 그대로 노출 — 규칙을 숨긴 채 "위험/주의/보통"만 던지지 않기 위함
function computeRisk(severity) {
  const critical = severity.critical || 0;
  const high = severity.high || 0;
  if (critical > 0) {
    return { key: 'high', reason: `심각(CRITICAL) ${critical}건 → 위험` };
  }
  if (high > 0) {
    return { key: 'mid', reason: `심각 0건, 높음(HIGH) ${high}건 → 주의` };
  }
  return { key: 'low', reason: '심각·높음 등급 CVE 없음 → 보통' };
}

function renderRisk(entry) {
  if (!entry.severity) {
    els.riskMeter.hidden = true;
    return;
  }
  const risk = computeRisk(entry.severity);

  els.riskMeter.hidden = false;
  els.riskMeterTrack.innerHTML = RISK_STEPS
    .map((step) => {
      const active = step.key === risk.key;
      const style = active ? `color:${step.color};border-color:${step.color};background:${step.color}26` : '';
      return `<span class="risk-step${active ? ' active' : ''}" style="${style}">${escapeHtml(step.label)}</span>`;
    })
    .join('');

  els.riskMeterCaption.textContent =
    `${risk.reason} · 기준: 심각 1건 이상=위험 · 없고 높음 1건 이상=주의 · 둘 다 0건=보통`;
}

// scripts/fetch-daily-count.mjs의 CATEGORY_RULES 라벨과 그대로 맞춰야 함 — 각 🏷 태그·유형 라벨을 누르면 이 설명이 바로 아래에 펼쳐짐
const CATEGORY_GLOSSARY = {
  '원격 코드 실행': '공격자가 인터넷 너머에서 남의 컴퓨터·서버에 마음대로 프로그램을 실행시킬 수 있는 유형',
  '인증 우회': '로그인 절차 없이, 또는 그 절차를 속여서 시스템에 들어갈 수 있는 유형',
  '권한 상승': '일반 사용자로 시작했다가 관리자(최고 권한)까지 올라갈 수 있는 유형',
  '접근 통제 오류': '누가 어떤 자료·기능에 접근할 수 있는지를 제대로 구분·제한하지 못해 생기는 유형',
  'SQL 인젝션': '웹사이트 입력창에 특수한 명령어를 넣어 데이터베이스를 마음대로 조회·수정할 수 있는 유형',
  '크로스사이트 스크립팅(XSS)': '웹페이지에 악성 스크립트를 심어 방문자의 정보를 훔치거나 계정을 가로챌 수 있는 유형',
  CSRF: '로그인된 사용자가 모르는 사이에 원치 않는 행동을 하게 만드는 유형',
  '경로 순회': '원래 접근하면 안 되는 폴더·파일까지 들어가 내부 파일을 몰래 읽거나 바꿀 수 있는 유형',
  '버퍼 오버플로우': '프로그램이 처리할 수 있는 데이터양을 넘겨서 오류를 내거나 악성 코드를 실행시키는 유형',
  '정수 오버플로우': '숫자 계산이 프로그램이 다룰 수 있는 범위를 벗어나 엉뚱한 값이 되면서 오류나 취약점으로 이어지는 유형',
  '정보 노출': '원래 보이면 안 되는 내부 정보가 외부에 그대로 드러나는 유형',
  '서비스 거부(DoS)': '시스템을 다운시키거나 먹통으로 만들어 정상 사용을 못 하게 막는 유형',
  '역직렬화 취약점': '전송·저장된 데이터를 프로그램이 복원하는 과정을 조작해 악성 코드를 실행시키는 유형',
  SSRF: '서버가 공격자 대신 다른(원래 접근 못 하는 내부) 서버에 요청을 보내게 속이는 유형',
  '하드코딩된 자격증명': '비밀번호나 키가 프로그램 코드 안에 그대로 박혀 있는 유형',
  '위험한 파일 업로드': '실행 가능한 악성 파일을 서버에 올릴 수 있게 방치한 유형',
  '메모리 해제 후 사용(UAF)': '이미 반납한 메모리 공간을 프로그램이 잊고 계속 사용하다가 오류·악성 코드 실행으로 이어지는 유형',
  '경쟁 조건': '여러 작업이 동시에 같은 자원을 건드릴 때 처리 순서가 꼬여서 생기는 유형',
  'NULL 포인터 역참조': '값이 비어 있는(NULL) 자리를 있는 것처럼 접근하려다 프로그램이 죽는 유형',
  '타입 컨퓨전': '프로그램이 데이터의 실제 종류를 착각해서 엉뚱하게 다루다 오류·악성 코드 실행으로 이어지는 유형',
  'XML 외부 개체 주입(XXE)': 'XML 문서 안에 외부 참조를 심어 서버의 내부 파일·자원에 접근하는 유형',
  '오픈 리다이렉트': '이동할 주소를 제대로 검증하지 않아 피싱 사이트 등 엉뚱한 곳으로 사용자를 보낼 수 있는 유형',
  '인증서 검증 오류': '통신 상대방의 인증서를 제대로 확인하지 않아 가짜 서버·중간자 공격에 노출되는 유형',
  '포맷 스트링 취약점': '문자열 출력 형식 지정자를 조작해 메모리를 읽거나 쓸 수 있게 되는 유형',
  'LDAP 인젝션': '디렉터리 서비스 조회문에 특수 명령을 끼워 넣어 인증·조회 결과를 조작하는 유형',
  '취약한 암호화·난수 사용': '이미 뚫린 암호화 방식이나 예측 가능한 난수를 써서 보안이 무력화되는 유형',
  '평문 전송(암호화 누락)': '암호화 없이 민감한 정보를 그대로 주고받아 도중에 가로챌 수 있는 유형',
  '취약한 직접 개체 참조(IDOR)': 'URL·파라미터의 ID만 바꾸면 권한 없이 남의 자료에 접근할 수 있는 유형',
  '입력값 검증 미흡': '사용자 입력을 제대로 검사하지 않아 생기는(구체적 유형이 명시되지 않은) 취약점',
  기타: '위 유형에 맞는 키워드가 설명 문구에 없어서 따로 분류하지 못한 CVE',
};

const BAR_LIST_PAGE_SIZE = 10;

// category-bars 형식 <li> 마크업 생성 — 오늘 유형/제품 카드, 월별 유형/제품 카드 전부 이걸 재사용
// useGlossary=false면 설명 문구 없이 예시 링크만 보여줌 — 제품·벤더는 "기타"가 유형 쪽 글로서리와 라벨이 겹쳐서
// CATEGORY_GLOSSARY를 그대로 쓰면 엉뚱한(공격 유형용) 설명이 섞여 나오기 때문.
// maxCountOverride를 주면 breakdown 자체의 최댓값 대신 그 값을 100% 기준으로 씀 — 페이지네이션에서
// 지금 보이는 조각이 아니라 전체 목록 기준으로 막대 비율을 고정할 때 씀(createBarListPager 참고).
function renderCategoryBarList(breakdown, useGlossary = true, maxCountOverride = null) {
  const maxCount = maxCountOverride ?? Math.max(...breakdown.map((c) => c.count));
  return breakdown
    .map((c) => {
      const pct = Math.round((c.count / maxCount) * 100);
      const desc = useGlossary ? (CATEGORY_GLOSSARY[c.label] || '') : '';
      const examples = c.examples || [];
      const examplesHtml = examples.length
        ? `<ul class="category-bar-examples">${examples
            .map((ex) => `<li><a href="${escapeHtml(ex.url)}" target="_blank" rel="noopener">${escapeHtml(ex.id)}</a></li>`)
            .join('')}</ul>`
        : '';
      const detailBlock = desc || examplesHtml
        ? `<div class="category-bar-desc" hidden>
            ${desc ? `<p>${escapeHtml(desc)}</p>` : ''}
            ${examplesHtml}
          </div>`
        : '';
      return `<li>
        <button type="button" class="category-bar-label">${escapeHtml(c.label)}</button>
        <span class="category-bar-track"><span class="category-bar-fill" style="width:${pct}%"></span></span>
        <span class="category-bar-count">${c.count}건</span>
        ${detailBlock}
      </li>`;
    })
    .join('');
}

// 유형/제품 막대 목록 하나를 맡는 페이저 — 10개씩 잘라 보여주고 이전/다음 버튼으로 넘김.
// 데이터는 setData()로 받아 들고 있다가 버튼 클릭 시 다시 계산 없이 그 배열만 재슬라이스함.
// 최댓값(막대 100% 기준)은 항상 "전체 목록" 기준으로 고정 — 페이지 단위로 다시 계산하면
// 2페이지처럼 작은 값들만 모인 페이지에서 그중 최댓값이 100% 막대로 보여 착시가 생기기 때문.
function createBarListPager(elsSet) {
  let breakdown = [];
  let useGlossary = true;
  let page = 1;

  function render() {
    const totalPages = Math.max(1, Math.ceil(breakdown.length / BAR_LIST_PAGE_SIZE));
    page = Math.min(Math.max(page, 1), totalPages);
    const start = (page - 1) * BAR_LIST_PAGE_SIZE;
    const fullListMax = breakdown.length ? Math.max(...breakdown.map((c) => c.count)) : null;
    elsSet.bars.innerHTML = renderCategoryBarList(breakdown.slice(start, start + BAR_LIST_PAGE_SIZE), useGlossary, fullListMax);
    elsSet.pagination.hidden = breakdown.length <= BAR_LIST_PAGE_SIZE;
    elsSet.pageInfo.textContent = `${page} / ${totalPages}`;
    elsSet.prevBtn.disabled = page <= 1;
    elsSet.nextBtn.disabled = page >= totalPages;
  }

  elsSet.prevBtn.addEventListener('click', () => {
    if (page <= 1) return;
    page -= 1;
    render();
  });
  elsSet.nextBtn.addEventListener('click', () => {
    page += 1;
    render();
  });

  return {
    setData(newBreakdown, { useGlossary: glossaryFlag = true, resetPage = false } = {}) {
      breakdown = newBreakdown;
      useGlossary = glossaryFlag;
      if (resetPage) page = 1;
      render();
    },
  };
}

const categoryPager = createBarListPager({
  bars: els.categoryBars,
  pagination: els.categoryPagination,
  prevBtn: els.categoryPrev,
  nextBtn: els.categoryNext,
  pageInfo: els.categoryPageInfo,
});
const productPager = createBarListPager({
  bars: els.productBars,
  pagination: els.productPagination,
  prevBtn: els.productPrev,
  nextBtn: els.productNext,
  pageInfo: els.productPageInfo,
});

// LLM 없이 규칙(키워드) 기반으로 분류한 유형 분포 — data/history.json의 categoryBreakdown을 그대로 시각화
function renderCategory(entry) {
  const breakdown = entry.categoryBreakdown;
  if (!breakdown || breakdown.length === 0 || !entry.categorySampleSize) {
    els.categoryCard.hidden = true;
    return;
  }
  els.categoryCard.hidden = false;
  categoryPager.setData(breakdown);

  els.categoryNote.textContent =
    `오늘 등록분 중 심각도가 평가된 CVE ${entry.categorySampleSize}건의 설명 전체를 키워드로 분류한 결과예요(번역은 안 함). 규칙에 안 걸리는 설명은 AI가 한 번 더 보고 같은 유형 목록 중에서 골라주며, 그래도 안 맞으면 "기타"로 남아요. 아직 심각도가 안 매겨진 CVE는 포함되지 않아 전체(${entry.count}건) 비율과는 다를 수 있어요.`;
}

// 공격 유형과 같은 CVE 집합(심각도 평가된 전체)을 제품·벤더 이름 목록으로 한 번 더 분류한 결과 — 미리 정해둔 목록에 없으면 "기타"
function renderProduct(entry) {
  const breakdown = entry.productBreakdown;
  if (!breakdown || breakdown.length === 0 || !entry.categorySampleSize) {
    els.productCard.hidden = true;
    return;
  }
  els.productCard.hidden = false;
  productPager.setData(breakdown, { useGlossary: false });

  els.productNote.textContent =
    `오늘 등록분 중 심각도가 평가된 CVE ${entry.categorySampleSize}건의 설명 문구에서 미리 정해둔 벤더·제품 목록에 확실히 걸린 것만 보여줘요(AI 없이 목록 매칭, 목록에 없으면 표시 안 함). 라벨을 누르면 해당 벤더가 언급된 원본 CVE 링크가 펼쳐져요.`;
}

function monthKey(dateStr) {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

const MONTHLY_EXAMPLES_LIMIT = 5;

// 그 달에 속한 날짜들의 breakdown(유형 또는 제품)을 항목별로 더함 — 각 날짜가 이미 rated 전체 기반이라 합산값도 rated 전체 기반임(unrated 제외)
function aggregateMonthlyBreakdown(data, month, field) {
  const days = data.filter((e) => monthKey(e.date) === month && e[field] && e[field].length);
  const totals = new Map();
  let sampleSize = 0;
  for (const day of days) {
    sampleSize += day.categorySampleSize || 0; // 유형·제품 둘 다 같은 rated 집합에서 나온 것이라 건수는 공용
    for (const c of day[field]) {
      const prev = totals.get(c.key);
      if (prev) {
        prev.count += c.count;
        for (const ex of c.examples || []) {
          if (prev.examples.length >= MONTHLY_EXAMPLES_LIMIT) break;
          if (!prev.examples.some((e) => e.id === ex.id)) prev.examples.push(ex);
        }
      } else {
        totals.set(c.key, { label: c.label, count: c.count, examples: (c.examples || []).slice(0, MONTHLY_EXAMPLES_LIMIT) });
      }
    }
  }
  const breakdown = [...totals.values()].sort((a, b) => b.count - a.count);
  return { breakdown, sampleSize, dayCount: days.length };
}

// 월별 유형/제품 카드 두 개가 구조는 같고 대상 필드·DOM만 다르므로 설정 객체로 공유
const MONTHLY_WIDGETS = [
  {
    field: 'categoryBreakdown',
    useGlossary: true,
    card: () => els.monthlyCategoryCard,
    select: () => els.monthSelect,
    pager: createBarListPager({
      bars: els.monthlyCategoryBars,
      pagination: els.monthlyCategoryPagination,
      prevBtn: els.monthlyCategoryPrev,
      nextBtn: els.monthlyCategoryNext,
      pageInfo: els.monthlyCategoryPageInfo,
    }),
    note: () => els.monthlyCategoryNote,
    total: () => els.monthlyCategoryTotal,
    emptyNote: '이 달은 유형 분류 데이터가 없어요.',
    noteText: (month, dayCount) =>
      `${month} 한 달(기록 ${dayCount}일) 동안의 일별 유형 분류를 모두 더한 결과예요(번역은 안 함, 규칙에 안 걸린 설명은 AI가 보조 분류). 각 날짜도 심각도가 평가된 CVE만 대상이라 그 달 전체 등록 건수와는 차이가 있을 수 있어요.`,
  },
  {
    field: 'productBreakdown',
    useGlossary: false,
    card: () => els.monthlyProductCard,
    select: () => els.monthProductSelect,
    pager: createBarListPager({
      bars: els.monthlyProductBars,
      pagination: els.monthlyProductPagination,
      prevBtn: els.monthlyProductPrev,
      nextBtn: els.monthlyProductNext,
      pageInfo: els.monthlyProductPageInfo,
    }),
    note: () => els.monthlyProductNote,
    total: () => els.monthlyProductTotal,
    emptyNote: '이 달은 목록에 걸린 벤더·제품이 없어요.',
    noteText: (month, dayCount) =>
      `${month} 한 달(기록 ${dayCount}일) 동안 미리 정해둔 벤더·제품 목록에 걸린 것만 더한 결과예요(AI 없이 목록 매칭, 목록에 없으면 표시 안 함). 라벨을 누르면 해당 벤더가 언급된 원본 CVE 링크가 펼쳐져요.`,
  },
];

// resetPage=true는 사용자가 월을 직접 바꿨을 때만 — 그냥 데이터 새로고침으로는 보던 페이지가 안 튐
function renderMonthlyBreakdownBars(data, month, widget, resetPage = false) {
  const { breakdown, dayCount } = aggregateMonthlyBreakdown(data, month, widget.field);
  const monthTotal = data
    .filter((e) => monthKey(e.date) === month)
    .reduce((sum, e) => sum + (e.count || 0), 0);
  widget.total().textContent = `이 달 총 ${monthTotal.toLocaleString('ko-KR')}건 등록 (${month})`;

  widget.pager.setData(breakdown, { useGlossary: widget.useGlossary, resetPage });
  widget.note().textContent = breakdown.length === 0 ? widget.emptyNote : widget.noteText(month, dayCount);
}

// 데이터에 실제로 있는 월만 선택지로 제공 — 없는 달을 만들어서 보여주지 않음
function renderMonthlyBreakdown(data, widget) {
  const months = [...new Set(
    data.filter((e) => e[widget.field] && e[widget.field].length).map((e) => monthKey(e.date)),
  )].sort().reverse();

  if (months.length === 0) {
    widget.card().hidden = true;
    return;
  }
  widget.card().hidden = false;

  const select = widget.select();
  const currentOptionValues = Array.from(select.options).map((o) => o.value);
  if (currentOptionValues.join(',') !== months.join(',')) {
    const keepValue = select.value;
    select.innerHTML = months.map((m) => `<option value="${m}">${m}</option>`).join('');
    select.value = months.includes(keepValue) ? keepValue : months[0];
  }

  const resetPage = widget._lastMonth !== select.value;
  widget._lastMonth = select.value;
  renderMonthlyBreakdownBars(data, select.value, widget, resetPage);
}

const SEVERITY_COLOR = {
  CRITICAL: '#ff4d4f',
  HIGH: '#ff9f43',
  MEDIUM: '#ffd166',
  LOW: '#4dabf7',
};

const SEVERITY_LABEL_KO = {
  CRITICAL: '심각',
  HIGH: '높음',
  MEDIUM: '중간',
  LOW: '낮음',
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const HIGHLIGHT_PREVIEW_CHARS = 140;

// 서버 쪽 truncate()와 같은 규칙: 단어 중간이 아니라 공백에서 잘라 미리보기를 만든다
function truncatePreview(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const safe = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${safe.trimEnd()}…`;
}

function renderHighlights(entry) {
  const list = entry.highlights;
  if (!list || list.length === 0) {
    els.highlightsCard.hidden = true;
    return;
  }
  els.highlightsCard.hidden = false;
  els.highlightsList.innerHTML = list
    .map((h) => {
      const color = SEVERITY_COLOR[h.severity] || '#5a5a62';
      const label = SEVERITY_LABEL_KO[h.severity] || h.severity;
      const fullKo = h.summaryKo || '';
      const fullEn = h.summaryEn || '';
      const preview = truncatePreview(fullKo || fullEn, HIGHLIGHT_PREVIEW_CHARS);
      const cvss = h.cvssScore != null
        ? `<span class="hl-cvss" title="${escapeHtml(h.cvssVector || 'CVSS 벡터 없음')}">CVSS ${h.cvssScore.toFixed(1)}</span>`
        : '';
      const cvssPlain = h.cvssPlain
        ? `<span class="hl-cvss-plain">${escapeHtml(h.cvssPlain)}</span>`
        : '';
      const categoryDesc = CATEGORY_GLOSSARY[h.category] || '';
      const categoryTag = h.category
        ? `<button type="button" class="hl-category">${escapeHtml(h.category)}</button>
           ${categoryDesc ? `<span class="hl-category-desc" hidden>${escapeHtml(categoryDesc)}</span>` : ''}`
        : '';
      const fullKoBlock = fullKo ? `<p class="hl-full-ko">${escapeHtml(fullKo)}</p>` : '';
      const originalBlock = fullEn
        ? `<p class="hl-original"><span class="hl-original-label">원문(영어)</span>${escapeHtml(fullEn)}</p>`
        : '';
      return `<li>
        <span class="hl-badge" style="color:${color};border-color:${color}">${escapeHtml(label)}</span>
        ${cvss}
        <a class="hl-id" href="${escapeHtml(h.url)}" target="_blank" rel="noopener">${escapeHtml(h.id)}</a>
        ${categoryTag}
        <span class="hl-summary">${escapeHtml(preview)}</span>
        ${cvssPlain}
        <details class="hl-details">
          <summary>자세히 보기</summary>
          <div class="hl-full">
            ${fullKoBlock}
            ${originalBlock}
          </div>
        </details>
      </li>`;
    })
    .join('');
}

function renderTrendStats(data) {
  if (data.length < 2) {
    els.trendStats.hidden = true;
    els.trendStatsNote.hidden = true;
    return;
  }
  const week = data.slice(-7);
  const counts = week.map((d) => d.count);
  const avg = counts.reduce((a, b) => a + b, 0) / week.length;
  const maxEntry = week.reduce((a, b) => (b.count > a.count ? b : a));
  const minEntry = week.reduce((a, b) => (b.count < a.count ? b : a));

  els.trendStats.hidden = false;
  els.statAvg.textContent = `${avg.toFixed(1)}건`;
  els.statMax.textContent = `${maxEntry.count}건 (${maxEntry.date})`;
  els.statMin.textContent = `${minEntry.count}건 (${minEntry.date})`;

  els.trendStatsNote.hidden = false;
  els.trendStatsNote.textContent =
    `최근 ${week.length}일 기록 기준 (${week[0].date} ~ ${week[week.length - 1].date})`;
}

function renderTrend(data) {
  if (data.length < 2) {
    els.trendChart.hidden = true;
    els.trendNote.hidden = false;
    return;
  }
  els.trendNote.hidden = true;
  els.trendChart.hidden = false;

  const recent = data.slice(-14);
  const counts = recent.map((d) => d.count);
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  const range = max - min || 1;

  const W = 640;
  const H = 180;
  const padX = 16;
  const padTop = 24;
  const padBottom = 30;
  const plotH = H - padTop - padBottom;
  const n = recent.length;
  const gap = 8;
  const barW = Math.max(10, (W - padX * 2 - gap * (n - 1)) / n);

  const bars = recent
    .map((entry, i) => {
      const x = padX + i * (barW + gap);
      const ratio = (entry.count - min) / range;
      const h = Math.max(6, ratio * plotH);
      const y = padTop + (plotH - h);
      const isLast = i === n - 1;
      const fill = isLast ? '#ffffff' : 'rgba(255,255,255,0.35)';
      const shortDate = entry.date.slice(5); // MM-DD
      return `
        <g>
          <title>${entry.date}: ${entry.count}${entry.unit}</title>
          <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="${fill}"></rect>
          <text x="${x + barW / 2}" y="${y - 8}" text-anchor="middle" font-size="11" fill="#ffffff">${entry.count}</text>
          <text x="${x + barW / 2}" y="${H - 10}" text-anchor="middle" font-size="10" fill="#9a9aa2">${shortDate}</text>
        </g>`;
    })
    .join('');

  els.trendChart.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="최근 날짜별 신규 CVE 건수 추이">${bars}</svg>`;
}

function renderNormal(data) {
  lastGood = { data, queriedAtIso: new Date().toISOString() };
  els.statusBanner.hidden = true;
  els.statusBanner.textContent = '';
  els.statusBanner.className = 'status-banner';

  const latest = data[data.length - 1];
  if (!latest) {
    els.valueNumber.textContent = '기록 없음';
    els.valueUnit.textContent = '';
    els.compareCard.hidden = true;
    els.severityCard.hidden = true;
    els.riskMeter.hidden = true;
    els.categoryCard.hidden = true;
    els.productCard.hidden = true;
    els.monthlyCategoryCard.hidden = true;
    els.monthlyProductCard.hidden = true;
    els.highlightsCard.hidden = true;
    els.trendStats.hidden = true;
    els.trendStatsNote.hidden = true;
    els.trendChart.hidden = true;
    els.trendNote.hidden = false;
    els.historyBody.innerHTML = '';
    els.historyPagination.hidden = true;
    return;
  }

  els.valueNumber.textContent = latest.count;
  els.valueUnit.textContent = latest.unit;
  els.sourceLink.href = latest.sourceApiUrl;
  els.queriedAt.textContent = formatKst(latest.queriedAtUtc);
  els.recordDate.textContent = `${latest.date} (KST) 00:00 ~ 조회 시각까지 누적`;

  renderSeverity(latest);
  renderRisk(latest);
  renderCategory(latest);
  renderProduct(latest);
  MONTHLY_WIDGETS.forEach((widget) => renderMonthlyBreakdown(data, widget));
  renderHighlights(latest);
  renderCompare(data);
  renderTrendStats(data);
  renderTrend(data);
  renderHistoryTable(data);
}

function renderError(err) {
  const messages = {
    timeout: '⏱ 요청이 시간 초과되었습니다',
    auth: '🔒 인증에 실패했습니다',
    ratelimit: '🚦 호출 제한에 걸렸습니다 (너무 많은 요청)',
    offline: '📡 오프라인 상태입니다',
    malformed: '⚠️ 응답 형식이 예상과 다릅니다',
  };
  const label = messages[err.kind] || `오류: ${err.message}`;

  els.statusBanner.hidden = false;

  if (lastGood) {
    els.statusBanner.className = 'status-banner stale';
    els.statusBanner.textContent =
      `${label} — 오래된 데이터 표시 중 (마지막 정상 조회: ${formatKst(lastGood.queriedAtIso)})`;
  } else {
    els.statusBanner.className = 'status-banner empty';
    els.statusBanner.textContent = `${label} — 아직 정상 데이터를 가져오지 못했습니다`;
    els.valueNumber.textContent = '—';
    els.valueUnit.textContent = '';
    els.compareCard.hidden = true;
    els.severityCard.hidden = true;
    els.riskMeter.hidden = true;
    els.categoryCard.hidden = true;
    els.productCard.hidden = true;
    els.monthlyCategoryCard.hidden = true;
    els.monthlyProductCard.hidden = true;
    els.highlightsCard.hidden = true;
  }
}

async function load(simulateKind) {
  try {
    const data = await fetchHistory(simulateKind);
    renderNormal(data);
  } catch (err) {
    renderError(err);
  }
}

// 유형 태그·라벨을 누르면 그 자리 바로 아래에 설명을 펼침/접음 (매번 다시 그려지는 목록이라 컨테이너에 위임)
els.highlightsList.addEventListener('click', (e) => {
  const btn = e.target.closest('.hl-category');
  if (!btn) return;
  const desc = btn.nextElementSibling;
  if (desc && desc.classList.contains('hl-category-desc')) desc.hidden = !desc.hidden;
});

function toggleCategoryBarDesc(e) {
  const btn = e.target.closest('.category-bar-label');
  if (!btn) return;
  const desc = btn.closest('li').querySelector('.category-bar-desc');
  if (desc) desc.hidden = !desc.hidden;
}

[els.categoryBars, els.productBars, els.monthlyCategoryBars, els.monthlyProductBars].forEach((container) => {
  container.addEventListener('click', toggleCategoryBarDesc);
});

MONTHLY_WIDGETS.forEach((widget) => {
  widget.select().addEventListener('change', () => {
    if (!lastGood) return;
    widget._lastMonth = widget.select().value;
    renderMonthlyBreakdownBars(lastGood.data, widget.select().value, widget, true);
  });
});

els.historyPrev.addEventListener('click', () => {
  if (historyPage <= 1 || !lastGood) return;
  historyPage -= 1;
  renderHistoryTable(lastGood.data);
});

els.historyNext.addEventListener('click', () => {
  if (!lastGood) return;
  historyPage += 1;
  renderHistoryTable(lastGood.data);
});

document.addEventListener('DOMContentLoaded', () => {
  renderNextAutoCheck();

  const params = new URLSearchParams(location.search);
  if (params.get('debug') === '1') {
    const panel = document.getElementById('debug-panel');
    panel.hidden = false;
    panel.querySelectorAll('[data-simulate]').forEach((btn) => {
      btn.addEventListener('click', () => load(btn.dataset.simulate));
    });
    document.getElementById('retry-btn').addEventListener('click', () => load());
  }
  load();
});
