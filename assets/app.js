const HISTORY_URL = 'data/history.json';
const TIMEZONE = 'Asia/Seoul';

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
};

let lastGood = null; // { data, queriedAtIso }

function renderHistoryTable(data) {
  els.historyBody.innerHTML = '';
  [...data].reverse().forEach((entry) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${entry.date}</td><td>${entry.count}${entry.unit}</td><td>${entry.queriedAtUtc}</td>`;
    els.historyBody.appendChild(tr);
  });
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

// LLM 없이 규칙(키워드) 기반으로 분류한 유형 분포 — data/history.json의 categoryBreakdown을 그대로 시각화
function renderCategory(entry) {
  const breakdown = entry.categoryBreakdown;
  if (!breakdown || breakdown.length === 0 || !entry.categorySampleSize) {
    els.categoryCard.hidden = true;
    return;
  }
  els.categoryCard.hidden = false;
  const maxCount = Math.max(...breakdown.map((c) => c.count));

  els.categoryBars.innerHTML = breakdown
    .map((c) => {
      const pct = Math.round((c.count / maxCount) * 100);
      return `<li>
        <span class="category-bar-label">${escapeHtml(c.label)}</span>
        <span class="category-bar-track"><span class="category-bar-fill" style="width:${pct}%"></span></span>
        <span class="category-bar-count">${c.count}건</span>
      </li>`;
    })
    .join('');

  els.categoryNote.textContent =
    `오늘 등록분 중 API 응답 표본 ${entry.categorySampleSize}건의 설명 문구를 키워드로 분류한 결과예요(AI·번역 없이 규칙 매칭). 표본이라 전체(${entry.count}건) 비율과는 다를 수 있고, 해당 키워드가 없으면 "기타"로 묶여요.`;
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
      const fullKoBlock = fullKo ? `<p class="hl-full-ko">${escapeHtml(fullKo)}</p>` : '';
      const originalBlock = fullEn
        ? `<p class="hl-original"><span class="hl-original-label">원문(영어)</span>${escapeHtml(fullEn)}</p>`
        : '';
      return `<li>
        <span class="hl-badge" style="color:${color};border-color:${color}">${escapeHtml(label)}</span>
        ${cvss}
        <a class="hl-id" href="${escapeHtml(h.url)}" target="_blank" rel="noopener">${escapeHtml(h.id)}</a>
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
    els.highlightsCard.hidden = true;
    els.trendStats.hidden = true;
    els.trendStatsNote.hidden = true;
    els.trendChart.hidden = true;
    els.trendNote.hidden = false;
    els.historyBody.innerHTML = '';
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
