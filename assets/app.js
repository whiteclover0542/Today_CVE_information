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
  compareCard: document.getElementById('compare-card'),
  compareText: document.getElementById('compare-text'),
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
    return;
  }
  const latest = data[data.length - 1];
  const prev = data[data.length - 2];
  const diff = latest.count - prev.count;
  const direction = diff > 0 ? '증가' : diff < 0 ? '감소' : '변화 없음';
  const sign = diff > 0 ? '+' : '';
  els.compareCard.hidden = false;
  els.compareText.textContent =
    `${prev.date} ${prev.count}${prev.unit} → ${latest.date} ${latest.count}${latest.unit} ` +
    `(${sign}${diff}${latest.unit}, ${direction})`;
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
    els.historyBody.innerHTML = '';
    return;
  }

  els.valueNumber.textContent = latest.count;
  els.valueUnit.textContent = latest.unit;
  els.sourceLink.href = latest.sourceApiUrl;
  els.queriedAt.textContent = formatKst(latest.queriedAtUtc);
  els.recordDate.textContent = `${latest.date} (KST) 00:00 ~ 조회 시각까지 누적`;

  renderCompare(data);
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
