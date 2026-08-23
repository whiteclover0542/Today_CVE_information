import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const HISTORY_PATH = new URL('../data/history.json', import.meta.url);
const TIMEZONE = 'Asia/Seoul';
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

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

async function fetchTotalResults(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`NVD API 호출 실패: HTTP ${res.status} (${url})`);
  }
  const body = await res.json();
  return body.totalResults;
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

  const total = await fetchTotalResults(baseUrl);

  // 키 없이 호출하면 30초당 5회 제한(NVD 공식 문서) — 4개 심각도 질의를 여유 있게 간격을 두고 순차 호출
  const severity = {};
  for (const level of SEVERITIES) {
    await sleep(1500);
    const sevUrl = new URL(baseUrl);
    sevUrl.searchParams.set('cvssV3Severity', level);
    severity[level.toLowerCase()] = await fetchTotalResults(sevUrl);
  }
  const rated = severity.critical + severity.high + severity.medium + severity.low;
  severity.unrated = Math.max(0, total - rated); // CVSSv3 점수가 아직 없는(평가 대기) 건수

  const entry = {
    date: kstDate,
    count: total,
    unit: '건',
    timezone: TIMEZONE,
    sourceApiUrl: baseUrl.toString(),
    queriedAtUtc: now.toISOString(),
    severity,
  };

  history.push(entry);
  history.sort((a, b) => a.date.localeCompare(b.date));

  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');
  console.log(`[saved] ${kstDate} -> ${entry.count}건`, severity);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
