// 콘솔 출력 + JSON/Markdown 리포트 저장을 각 run-*.mjs가 중복 구현하지 않도록 모아둔 유틸.
// JSON은 다른 스크립트가 다시 읽어서 처리하기 위한 원본, Markdown은 사람이 훑어보고
// 그대로 공유하거나 문서에 붙여넣기 위한 정리본이다 — 같은 타임스탬프로 나란히 저장한다.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, 'reports');

function stampNow() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// data(JSON으로 남길 원본)와 markdown(사람이 읽을 정리본, 선택) 둘 다 저장.
// stamp를 넘기면 다른 리포트와 같은 타임스탬프를 공유할 수 있다(run-all.mjs가 여러 리포트를 하나로 묶을 때 사용).
export function saveReport(name, data, markdown = null, stamp = stampNow()) {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const jsonPath = join(REPORTS_DIR, `${name}-${stamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');

  let mdPath = null;
  if (markdown) {
    mdPath = join(REPORTS_DIR, `${name}-${stamp}.md`);
    writeFileSync(mdPath, markdown);
  }
  return { jsonPath, mdPath, stamp };
}

export function printTable(rows, columns) {
  const widths = columns.map((c) => Math.max(c.label.length, ...rows.map((r) => String(r[c.key] ?? '').length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  console.log(line(columns.map((c) => c.label)));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const r of rows) {
    console.log(line(columns.map((c) => r[c.key] ?? '')));
  }
}

// GFM 표 문자열을 만든다 — 콘솔 printTable과 컬럼 정의를 그대로 공유해서 두 곳이 어긋나지 않게 한다.
export function markdownTable(rows, columns) {
  const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  const header = `| ${columns.map((c) => c.label).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${columns.map((c) => esc(r[c.key])).join(' | ')} |`).join('\n');
  return rows.length ? [header, sep, body].join('\n') : `${header}\n${sep}\n| ${columns.map(() => '(없음)').join(' | ')} |`;
}

export function fmtScore(v) {
  return v === null || v === undefined ? 'N/A' : v.toFixed(2);
}

export function mdHeader(title) {
  return `# ${title}\n\n생성 시각: ${new Date().toISOString()}\n`;
}
