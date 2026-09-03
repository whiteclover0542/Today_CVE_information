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
| 6 | "더보기" 노출 대상 상한 건수 확정 | 🔄 | `MAX_HIGHLIGHTS = 10`으로 배치 3회(#16~#18) 검증 완료 후, "심각·높음·중간은 CWE 있는 CVE 전부"로 정책이 바뀌어 50으로 재설정(#13 참고) — 50 기준 실제 배치 검증은 아직 |
| 7 | CVE별 설명/발생 원인/방지법 해설 카드 | ✅ | CWE(`weaknesses` 필드) 추출 + `CWE_INFO` 매핑을 근거로 Gemini가 해석·발생 원인·방지법을 함께 생성, 근거 부족 시 빈 문자열(미노출)로 폴백. 실제 배치 결과로 확인 완료(10건 중 9건 완전히 채워짐, 1건은 매핑에 없는 CWE라 `cause`만 정상적으로 빈 값) |
| 8 | LLM 기반 "오늘의 브리핑" 요약 카드 | ⬜ | 아직 없음 — 필요성·형태부터 검토 |
| 9 | 대표 CVE 카드에 LLM 생성 제목 추가 + 클릭해야 내용 노출 | ✅ | 내용을 바로 나열하지 않고, Gemini가 생성한 한 줄 제목을 먼저 보여주고 클릭(`<details>`)해야 번역·원문·AI 해설이 펼쳐지도록 변경 |
| 10 | 대표 CVE를 "CWE 있음"만으로 제한 + CWE 없는 CVE는 별도 목록 | ✅ | 대표(AI 해설) 후보를 CWE 있는 CVE로만 한정, CWE 없는 CVE는 `secondaryHighlights`에 담아 카드 하단에 번역·해설 없이 목록으로만 노출 |
| 11 | 대표 CVE 카드: CWE·유형 태그 순서 변경 + CWE 클릭 시 설명 노출 | ✅ | CWE 태그를 유형 태그보다 앞에 배치, CWE 태그도 유형 태그처럼 클릭하면 `CWE_INFO`의 hint가 펼쳐지도록 변경 |
| 12 | "오늘 등록분 유형"/"월별 유형 비교"를 CWE 기반 집계로 전환 | ✅ | 정규식+Gemini 보정 방식(`categoryBreakdown`)을 폐지하고 NVD 공식 CWE를 그대로 집계하는 `cweBreakdown`으로 교체. CVE당 대표 CWE 1개만 집계, CWE 없으면 "CWE 미분류". 실제 배치(#18)로 합계 정확성까지 검증 완료 |
| 13 | 대표 CVE 선정을 "심각·높음·중간은 CWE 있는 것 전부"로 확대 | 🔄 | 유형 다양성 샘플링 방식 폐지, LOW 등급은 대상 제외, CVSS 내림차순으로 정렬해 상한(`MAX_HIGHLIGHTS = 50`)까지 채우도록 변경. 로직은 격리 테스트로 확인(심각도 우선순위·LOW 제외·CVSS 정렬 전부 의도대로 동작), 실제 배치로는 아직 검증 전 |
| 13 | 헤더에 "CWE가 뭔가요?" 설명 추가 | ✅ | CVE·CVSS 글로서리 옆에 CWE 개념(공식 표준 유형 분류, CVE=사건번호·CWE=죄목 비유) 설명 추가 |

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
- 2026-09-03: 대표 CVE 카드가 번역·원문·AI 해설을 바로 나열해 보여주던 것을, LLM이 생성한 한 줄 제목(`title`)을 먼저 보여주고 그 제목을 클릭해야만 내용이 펼쳐지는 구조로 변경. `explainHighlightWithLlm`(`scripts/fetch-daily-count.mjs`) 응답 스키마에 `title` 필드를 추가(다른 필드와 동일하게 한 번의 Gemini 호출로 같이 생성, 지어내지 않는 원칙 유지). 프론트(`assets/app.js`)는 기존에 분리돼 있던 "원문·번역 보기"/"AI 해설 보기" 두 개의 `<details>`를 제목 하나짜리 `<details>`로 합치고, 미리보기 텍스트(`hl-summary`, `truncatePreview`)는 제거. `title`이 없을 때(LLM 실패)는 없는 제목을 지어내지 않고 "상세 내용 보기"로 대체. Playwright로 로컬 스크래치 사이트(제목 있음/없음 두 케이스)를 띄워 클릭 전엔 내용이 숨겨지고 클릭 후에만 펼쳐지는지 스크린샷으로 확인.
- 2026-09-03: `workflow_dispatch`로 실제 배치를 1회 수동 실행(Actions run #16, 3분 26초, Success)해 검증 완료. `data/history.json`에 오늘(09-03) 대표 CVE 10건 전부 `summaryKo`/`interpretation`/`cause`/`mitigation`/`cwe`가 채워졌고(1건만 매핑에 없는 CWE라 `cause`가 정상적으로 빈 값), 배포된 GitHub Pages에도 즉시 반영됨을 fetch로 직접 확인. Gemini 호출 11회가 한도 문제 없이 끝나 다음에할일 1·2번을 완료 처리.
- 2026-09-03: 대표 CVE 선정 기준을 "CWE 분류가 있는 CVE만"으로 좁힘 — CWE가 없는 CVE에 억지로 `cause`/`mitigation`을 채우거나 아예 노출에서 빼는 대신, 별도의 `secondaryHighlights` 목록(카드 하단, 심각도·CVSS·유형만 표시, LLM 호출 없음)으로 분리해서 보여주기로 함. 기존 `pickFromLevel` 선정 로직에 `cwe.length === 0`이면 건너뛰는 조건을 추가하고, 그렇게 제외된 CVE 중 심각도 상위 `MAX_SECONDARY_HIGHLIGHTS`(20)건을 별도로 수집. LLM 호출을 안 하는 이유는 비용 절감뿐 아니라 애초에 grounding할 CWE가 없어 해설을 붙일 근거가 없기 때문(§3 원칙).
- 2026-09-03: 카드 위에 규칙 기반 🏷 유형 태그와 공식 CWE 태그가 나란히 있는 게 중복스럽다는 지적을 받아 CWE를 1차 정보로 정리. (1) 카드에서 CWE 태그를 유형 태그보다 앞에 배치하고 클릭하면 설명이 펼쳐지도록 변경(`extractCwe`가 CWE_INFO의 `hint`도 함께 반환하도록 확장). (2) "오늘 등록분 유형"/"월별 유형 비교" 집계 자체를 규칙 기반(`categoryBreakdown`)에서 NVD 공식 CWE 기반(`cweBreakdown`)으로 전환 — 이 집계는 이제 규칙 매칭이나 Gemini 재분류를 전혀 안 씀. 카드의 🏷 유형 태그(개별 CVE용)는 기존 규칙 시스템을 그대로 유지 — 이번 변경은 "집계 차트"에만 적용되고 "카드의 유형 태그" 존재 자체는 안 건드림. (3) 헤더에 "CWE가 뭔가요?" 설명 추가.
- 2026-09-03: `renderCategoryBarList`/`createBarListPager`에서 `useGlossary` 플래그 + 프론트 `CATEGORY_GLOSSARY` 조회 방식을 제거하고, 각 breakdown 항목이 백엔드에서 만든 `desc` 필드를 직접 들고 오도록 바꿈 — 서버·클라 설명이 어긋날 일이 없어짐(제품 목록은 원래도 설명이 없어서 그대로 영향 없음).
- 2026-09-03: `workflow_dispatch`로 실제 배치를 재실행(Actions run #18, 3분 32초, Success)해 CWE 기반 유형 집계까지 최종 검증 완료. `cweBreakdown` 16개 항목이 정상 생성되고(합계 24건 = `categorySampleSize`와 정확히 일치, 이중 집계·누락 없음), 매핑 안 된 CWE(예: CWE-404, CWE-693)는 라벨을 원래 ID 그대로 보여주고 `desc`는 빈 값으로 남아 지어내지 않음을 확인. `highlights[].cwe[].hint`도 정상 포함. 오늘은 심각도 상위 10건 전부 CWE가 있어 `secondaryHighlights`는 0건. 실제 배포된 GitHub Pages를 Playwright로 직접 열어 카드 태그 순서·CWE 클릭 설명·CWE 유형 차트·페이지네이션까지 스크린샷으로 확인, 콘솔 에러 없음 — 이번 단계의 구현·검증을 모두 마침.
- 2026-09-03: LLM 호출 한도 우려(RPD는 하루 1회 배치라 문제 없음, RPM은 4.5초 간격 유지로 개수와 무관하게 일정, TPM도 여유 충분 — 실제로 늘어나는 건 배치 실행 시간뿐)를 확인한 뒤, 대표 CVE 선정 방식을 "심각·높음·중간 등급 중 CWE 있는 CVE 전부"로 바꾸기로 함. 유형 다양성 위주로 샘플링하던 `pickFromLevel`의 2-pass 로직(및 `usedHighlightCategories`)을 제거하고, 해당 등급의 CWE'd 후보 전체를 CVSS 점수 내림차순 정렬해 상한까지 채우는 방식으로 교체. LOW 등급은 `HIGHLIGHT_ELIGIBLE_SEVERITIES`에서 제외해 대표 후보 자체가 안 됨. 상한(`MAX_HIGHLIGHTS`)은 최근 6일 심각·높음·중간 합계(22~50건)를 참고해 10 → 50으로 올림. 격리된 로직 테스트로 심각도 우선순위·LOW 제외·CVSS 정렬이 의도대로 동작함을 확인(node -e로 severity별 후보 배열을 흉내내 검증), 아직 실제 배치로는 못 돌려봄.

## 다음에 할 일

1. 새 선정 로직(심각·높음·중간 전부 + 상한 50)을 커밋·push하고 `workflow_dispatch`로 재실행해 실제로 몇 건이 뽑히는지, Gemini 호출·배치 실행 시간이 문제없는지 확인
2. CWE 필터링 적용 후 실제로 대표 CVE가 매일 몇 건씩 나오는지(=CWE 있는 CVE 비율) 며칠 지켜보고, 너무 적거나(예: 상한을 못 채움) 너무 많은(상한에 자주 걸림) 날이 있으면 `MAX_HIGHLIGHTS`를 다시 검토
3. 배포 재설정 방식 결정 (GitHub Pages 유지 여부 재검토)
4. "오늘의 브리핑" 요약 카드 필요성·형태 검토
5. CWE_INFO에 없는 CWE(CWE-404, CWE-693, CWE-316 등 실제로 자주 보이는 것들)를 발견되는 대로 매핑에 추가해 설명 커버리지를 넓히기

## 구현 메모 (CVE별 해설 기능 · CWE 기반 유형 집계)

- 관련 코드: `scripts/fetch-daily-count.mjs`의 `CWE_INFO`·`extractCwe`·`explainHighlightWithLlm`(백엔드), `assets/app.js`의 `renderHighlightItems`·`renderHighlights`·`renderSecondaryHighlightItems`·`renderCategory`·`renderCategoryBarList`(프론트).
- 데이터 스키마:
  - `highlights[]`(CWE 있는 CVE만, AI 해설 포함) — `interpretation`(해석)·`cause`(발생 원인)·`mitigation`(방지·완화 방법)·`cwe`(`[{id, label, hint}]`)·`title`(제목, 클릭해야 보이는 상세 내용의 진입점)·`summaryKo`(Gemini 번역).
  - `secondaryHighlights[]`(CWE 없는 CVE) — `id`·`severity`·`url`·`cvssScore`·`cvssVector`·`cvssPlain`·`category`만, 번역·AI 해설 없음.
  - `cweBreakdown[]`(그날 심각도 평가된 CVE 전체를 CWE로 집계) — `key`(CWE id 또는 `'none'`)·`label`·`count`·`desc`(hint)·`examples`. 기존 `categoryBreakdown` 필드는 더 이상 저장하지 않음(과거 날짜 기록에는 남아있지만 새 프론트는 안 읽음 — 그런 날은 "오늘 등록분 CWE 유형" 카드가 자연히 빈 상태로 표시됨).
- 검증 상태: 번역+해설(title 이전 버전) — #16, title+CWE 필터링/`secondaryHighlights` — #17, CWE 기반 `cweBreakdown`+카드 태그 순서/클릭 — #18까지 전부 실제 배치+배포 사이트로 확인 완료. **"심각·높음·중간 전부 + 상한 50"으로 바뀐 최신 선정 로직은 아직 격리 로직 테스트만 했고 실제 배치로는 미검증** — 다음 실행에서 확인 필요.
