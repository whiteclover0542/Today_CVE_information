import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const HISTORY_PATH = new URL('../data/history.json', import.meta.url);
const TIMEZONE = 'Asia/Seoul';

function kstDateString(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
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

  const apiUrl = new URL('https://services.nvd.nist.gov/rest/json/cves/2.0');
  apiUrl.searchParams.set('pubStartDate', pubStartDate);
  apiUrl.searchParams.set('pubEndDate', pubEndDate);
  apiUrl.searchParams.set('resultsPerPage', '1');

  const res = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`NVD API 호출 실패: HTTP ${res.status}`);
  }
  const body = await res.json();

  const entry = {
    date: kstDate,
    count: body.totalResults,
    unit: '건',
    timezone: TIMEZONE,
    sourceApiUrl: apiUrl.toString(),
    queriedAtUtc: now.toISOString(),
  };

  history.push(entry);
  history.sort((a, b) => a.date.localeCompare(b.date));

  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');
  console.log(`[saved] ${kstDate} -> ${entry.count}건`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
