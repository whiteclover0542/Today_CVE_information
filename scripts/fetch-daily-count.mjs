import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const HISTORY_PATH = new URL('../data/history.json', import.meta.url);
const TIMEZONE = 'Asia/Seoul';
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const MAX_HIGHLIGHTS = 3;
const SUMMARY_MAX_CHARS = 140;

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

function truncate(text, max) {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max).trimEnd(), truncated: true };
}

// 무키 번역: MyMemory Translation API (익명 사용, 하루 5000단어 한도) — 실패해도 영문 요약으로 대체되므로 치명적이지 않음
async function translateToKorean(text) {
  if (!text) return null;
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
    console.warn(`[warn] 번역 실패, 영문으로 대체: ${e.message}`);
    return null;
  }
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
  // resultsPerPage를 늘려 같은 호출에서 건수(totalResults)와 대표 CVE 몇 건(vulnerabilities)을 함께 받는다.
  const severity = {};
  const rawHighlights = [];
  for (const level of SEVERITIES) {
    await sleep(1500);
    const sevUrl = new URL(baseUrl);
    sevUrl.searchParams.set('cvssV3Severity', level);
    sevUrl.searchParams.set('resultsPerPage', String(MAX_HIGHLIGHTS));
    const body = await fetchJson(sevUrl);
    severity[level.toLowerCase()] = body.totalResults;

    if (rawHighlights.length < MAX_HIGHLIGHTS) {
      for (const { cve } of body.vulnerabilities || []) {
        if (rawHighlights.length >= MAX_HIGHLIGHTS) break;
        const desc = (cve.descriptions || []).find((d) => d.lang === 'en')?.value || '';
        const { text: shortEn, truncated } = truncate(desc, SUMMARY_MAX_CHARS);
        rawHighlights.push({
          id: cve.id,
          severity: level,
          shortEn,
          truncated,
          url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
        });
      }
    }
  }
  const rated = severity.critical + severity.high + severity.medium + severity.low;
  severity.unrated = Math.max(0, total - rated); // CVSSv3 점수가 아직 없는(평가 대기) 건수

  // 대표 CVE 요약을 한국어로 번역 (NVD 호출과 별개 서비스라 위 5회 제한과 무관, 그래도 예의상 간격을 둠)
  const highlights = [];
  for (const h of rawHighlights) {
    await sleep(500);
    const ko = await translateToKorean(h.shortEn);
    highlights.push({
      id: h.id,
      severity: h.severity,
      summaryEn: h.truncated ? `${h.shortEn}…` : h.shortEn,
      summaryKo: ko ? (h.truncated ? `${ko}…` : ko) : null,
      url: h.url,
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
  };

  history.push(entry);
  history.sort((a, b) => a.date.localeCompare(b.date));

  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');
  console.log(`[saved] ${kstDate} -> ${entry.count}건`, severity, `highlights: ${highlights.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
