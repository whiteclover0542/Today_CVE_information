# 정보판 정의표 (카드1 자체 점검 근거)

## 목적 문장
이 정보판은 오늘 새로 등록된 보안 취약점(CVE) 수를 확인하기 위한 것이다.

## 출처·항목·단위·시간대 정의

| 항목 | 정의 |
| --- | --- |
| 출처 | NVD(미국 국립취약점데이터베이스) CVE API 2.0 — `https://services.nvd.nist.gov/rest/json/cves/2.0` |
| 표시 항목 | 응답의 `totalResults` (질의 조건에 맞는 CVE 총 건수) |
| 단위 | 건 |
| 기준 시간대 | Asia/Seoul (KST, UTC+9) |
| 집계 범위 | 해당 KST 날짜 00:00:00부터 조회(배치 실행) 시각까지 신규 등록(`pubStartDate`~`pubEndDate`)된 CVE |
| 저장 식별값 | KST 기준 `YYYY-MM-DD` 날짜 문자열 (하루 1건) |
| 갱신 주기 | 1일 1회, GitHub Actions cron `0 0 * * *`(UTC) = 매일 09:00 KST |

## 원자료 ↔ 화면값 대조 기록

| 날짜(KST) | 원자료(NVD `totalResults`) | 저장값(`data/history.json`) | 화면 표시값 | 조회 시각(UTC) | 일치 여부 |
| --- | --- | --- | --- | --- | --- |
| 2026-08-23 (1차, 로컬 스모크) | 184 | 184 | 184건 | 2026-08-22T22:55:48.755Z | 일치 |
| 2026-08-23 (2차, Actions 쓰기 경로 검증) | 187 | 187 | 187건 | 2026-08-22T23:19:01.045Z | 일치 |
| 2026-08-23 (3차, 심각도 분포 필드 추가 후 재조회) | 208 (critical 2, high 11, medium 16, low 1, unrated 178) | 동일 | 208건 + 분포 그래프 | 2026-08-23T09:24:08.447Z | 일치 |

> 대조 방법: `data/history.json`의 `sourceApiUrl`을 직접 열어 응답의 `totalResults`가 같은 파일의 `count`, 화면(`https://whiteclover0542.github.io/Today_CVE_information/`)에 표시된 숫자와 같은지 확인. 심각도는 같은 날짜 범위에 `cvssV3Severity=CRITICAL|HIGH|MEDIUM|LOW`를 추가로 걸어 각각의 `totalResults`를 더해 확인.
> 2·3차 기록은 실제 쓰기 경로 검증, 심각도 필드 추가를 위해 같은 날 재조회한 것 — 같은 KST 날짜라 값이 갱신됐을 뿐 위조가 아님(PROGRESS.md 설계 결정 이력 참고).
