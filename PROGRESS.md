# 오늘의 CVE 정보판 — 서비스 진행 관리

> 과제 진행 당시의 `PROGRESS.md`는 [`assignment/PROGRESS.md`](assignment/PROGRESS.md)로 옮겨 그대로 보존했습니다.
> 이 문서는 과제 통과 이후, [`PLAN.md`](PLAN.md)에서 정한 실 서비스 방향을 진행하며 계속 갱신하는 새 관리 문서입니다.

## 진행 상태

✅ 완료 · 🔄 진행중 · ⬜ 미착수

| # | 작업 | 상태 | 비고 |
| --- | --- | --- | --- |
| 1 | 기획서 작성 (`PLAN.md`) | ✅ | 배포 재설정·LLM 번역/요약 개선을 이번 단계 목표로 확정 |
| 2 | 진행 관리 문서 재구성 (이 문서) | ✅ | 과제용 `PROGRESS.md`는 `assignment/`로 보존, 실 서비스용은 루트에서 새로 시작 |
| 3 | 배포 재설정 | ⬜ | 현재는 GitHub Pages 유지 중 — 재점검 방식(그대로 유지 vs 이전)은 착수 시 결정 |
| 4 | 대표 CVE 번역을 LLM 기반으로 교체 | ✅ | MyMemory Translation API 제거, Gemini(`explainHighlightWithLlm`)로 교체. 실패/키 없음 시 원문 노출 폴백 유지 |
| 5 | 대표 CVE 노출 UI를 1건 → 더보기 → 5건씩 페이지네이션으로 변경 | ✅ | `assets/app.js`에 `renderHighlights`/`renderHighlightItems` 구현, Playwright로 1건→더보기→2페이지 전환 스크린샷 확인 완료 |
| 6 | "더보기" 노출 대상 상한 건수 확정 | 🔄 | 심각도 상위 CVE 대상 확정, 시작값 `MAX_HIGHLIGHTS = 10`으로 설정. 실제 배치 실행 로그로 안전한지 확인 필요(아직 실측 전) |
| 7 | CVE별 설명/발생 원인/방지법 해설 카드 | ✅ | CWE(`weaknesses` 필드) 추출 + `CWE_INFO` 매핑을 근거로 Gemini가 해석·발생 원인·방지법을 함께 생성, 근거 부족 시 빈 문자열(미노출)로 폴백 |
| 8 | LLM 기반 "오늘의 브리핑" 요약 카드 | ⬜ | 아직 없음 — 필요성·형태부터 검토 |

## 지금 서비스에 이미 있는 것 (과제 단계에서 완성, 유지)

아래는 새로 할 일이 아니라, `assignment/PROGRESS.md`에서 이미 완료해 지금 서비스에 그대로 살아있는 부분입니다. 참고용으로만 남깁니다.

- 오늘(KST) NVD 신규 CVE 건수·심각도·위험도 표시
- 대표 CVE(CVSS 포함) 카드, 유형/제품별 분포, 월별 비교, 추이·어제 대비 비교
- 장애 5종 시연 패널(`?debug=1`)
- 비밀값 없는 배포(브라우저·배포 파일 기준), Gemini 키는 배치 환경 시크릿으로만 사용
- 하루 1회 배치(GitHub Actions)로 `data/history.json` 갱신, 날짜 중복 방지

## 설계 결정 이력

> 이번 단계에서 내린 결정만 기록합니다. 과제 단계의 이력은 `assignment/PROGRESS.md`에 있습니다.

- 2026-09-03: 실 서비스 전환을 시작하며 `ASSIGNMENT.md`·`PROGRESS.md`·`docs/SUBMISSION.*`·`docs/worksheet/`를 `assignment/`로 이동해 과제 자료와 실 서비스 문서를 분리. 기획서(`PLAN.md`)와 새 `PROGRESS.md`를 루트에 신설.
- 2026-09-03: 대표 CVE 노출 건수 확대(현재 3건 고정)와 CVE별 설명·발생 원인·방지법 해설 카드 추가를 이번 단계 목표에 포함. 원인 해설은 LLM이 근거 없이 지어내지 않도록 NVD의 CWE 분류를 우선 근거로 삼는 방향으로 검토하기로 함.
- 2026-09-03: 노출 UI를 "1건 노출 → 더보기 클릭 시 전체 → 많으면 5건 단위 페이지네이션" 구조로 정함. 다만 "전체"가 그날 심각도 평가된 CVE 전부를 뜻하면 규모가 커질 수 있어, 해설 대상 CVE 범위(전체 vs 상위 N건)는 LLM 호출 한도 실측 후 별도로 확정하기로 함 — 아직 미확정.
- 2026-09-03: 해설 대상 CVE 범위를 "심각도 상위"로 확정(CRITICAL → HIGH → MEDIUM 순, 기존 대표 CVE 선정 로직 확장). 그날 등록된 CVE 전체를 대상으로 하지 않기로 함 — 상한 건수만 LLM 호출 한도 실측 후 별도 결정.
- 2026-09-03: 번역·해설 구현 완료. MyMemory 번역 함수를 제거하고 `scripts/fetch-daily-count.mjs`의 `explainHighlightWithLlm` 하나로 번역+해석+발생 원인+방지법을 한 번의 Gemini 호출로 생성(호출 수를 줄이기 위해 4개 필드를 한 번에 요청). CWE는 `cve.weaknesses`에서 추출해 `CWE_INFO`(약 35개 CWE 한글 라벨·근거 문장 매핑)로 grounding하고, 매핑에 없거나 근거가 부족하면 빈 문자열로 남기게 프롬프트에 못박음. `MAX_HIGHLIGHTS`는 10으로 시작(정확한 상한은 아직 실측 전). Gemini 호출 간격은 `HIGHLIGHT_LLM_INTERVAL_MS = 4500`(4.5초)로 보수적으로 설정 — 공식 무료 티어 RPM이 공개돼 있지 않아 실제 배치 로그(`usageMetadata`)로 계속 점검하기로 함.
- 2026-09-03: 프론트 UI 구현 완료. `assets/app.js`에 `renderHighlightItems`/`renderHighlights`를 추가해 기본 1건 노출 → "더보기" 클릭 시 5건 단위 페이지네이션으로 전환(날짜가 바뀌면 다시 1건부터). Playwright(`chromium` 로컬 설치, `chromium-cli`는 이 환경에 없어 대체)로 임시 스크래치 데이터(AI 필드 있음/없음 혼합)를 만들어 1건 상태·더보기·페이지 전환·AI 해설 펼침 화면을 스크린샷으로 확인, 콘솔 에러 없음 확인. 실제 `data/history.json`은 건드리지 않음.

## 다음에 할 일

1. 실제 GitHub Actions 배치를 1회 이상 돌려 Gemini 호출 11회(재분류 1 + 해설 최대 10)가 무료 티어 한도 안에서 안정적으로 끝나는지 확인 (`usageMetadata` 로그 확인)
2. 위 결과를 보고 `MAX_HIGHLIGHTS`(현재 10) 상한을 유지·조정
3. 배포 재설정 방식 결정 (GitHub Pages 유지 여부 재검토)
4. "오늘의 브리핑" 요약 카드 필요성·형태 검토

## 구현 메모 (CVE별 해설 기능)

- 관련 코드: `scripts/fetch-daily-count.mjs`의 `CWE_INFO`·`extractCwe`·`explainHighlightWithLlm`(백엔드), `assets/app.js`의 `renderHighlightItems`·`renderHighlights`(프론트).
- 데이터 스키마 추가: `highlights[].interpretation`(해석), `.cause`(발생 원인), `.mitigation`(방지·완화 방법), `.cwe`(`[{id, label}]`) — 기존 `summaryKo`는 이제 Gemini가 생성.
- 아직 배치를 실행해 실제 `data/history.json`에 새 필드가 채워지는지는 확인하지 못함 — 다음 스케줄 실행(또는 수동 `workflow_dispatch`) 때 로그와 결과를 확인해야 함.
