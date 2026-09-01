# 🛡️ 오늘의 CVE 정보판

오늘(KST) 새로 등록된 [NVD](https://nvd.nist.gov/) 신규 CVE(보안 취약점) 건수를 값·단위·출처·조회 시각과 함께 보여주는 개인 정보판입니다. 설치 없이 브라우저로 바로 열립니다.

**🔗 공개 주소: https://whiteclover0542.github.io/Today_CVE_information/**

![대시보드 스크린샷](docs/submission/screenshot-dashboard.png)

## 주요 기능

- **현재값 + 출처 + 조회 시각** — 오늘(KST) 신규 등록 CVE 건수를 단위·출처 링크·조회 시각과 한 화면에 표시. 출처 링크를 누르면 실제 호출한 NVD API 원자료가 그대로 열립니다.
- **심각도 분포 + 위험도 판정** — CVSSv3 기준 심각/높음/중간/낮음 분포를 도넛 차트로 보여주고, 그 분포에서 계산한 "보통/주의/위험" 3단계 위험도를 판단 기준과 함께 표시합니다(심각 1건 이상=위험 · 높음 1건 이상=주의 · 그 외=보통).
- **대표 CVE + CVSS 점수** — 오늘 등록분 중 대표 CVE 몇 건을 CVSS 점수·설명(한국어 번역 포함)과 함께 보여줍니다.
- **오늘 등록분 유형 분류** — API 응답 표본의 CVE 설명 문구를 키워드 규칙(원격 코드 실행·인증 우회·SQL 인젝션 등)으로 분류해 막대 그래프로 보여줍니다. LLM·번역 API 없이 정규식 매칭만 사용합니다.
- **어제 대비 비교** — 이전 기록과의 차이·방향·단위를 보여주되, 두 기록의 조회 시각이 다르면(측정 구간 차이) 그 사실도 함께 노출해 오해를 방지합니다.
- **최근 추이 + 날짜별 기록** — 최근 기록의 일평균/최고/최저와 막대 그래프, 날짜별 전체 기록 표.
- **장애 5종 시연** (`?debug=1`) — timeout·인증 실패·호출 제한·오프라인·응답 형식 변경을 각각 재현하고, 실패 중에도 마지막 정상값을 유지하며 "다시 시도"로 복구됩니다.
- **비밀값 없음** — API 키 없이 호출 가능한 공개 엔드포인트만 사용해, 브라우저·배포 파일·Git 기록 어디에도 비밀값이 없습니다.

## 동작 방식

```
[GitHub Actions: 매일 00:00 UTC(=09:00 KST) 실행]
        │  NVD CVE API 2.0 호출 (키 없이, 오늘 KST 00:00~실행 시각 범위)
        ▼
  data/history.json 에 건수·심각도 분포·대표 CVE(CVSS 포함) 추가
  (같은 날짜 기록이 이미 있으면 건너뜀 → 하루 1건, 중복 방지)
        │  git commit & push
        ▼
[GitHub Pages: index.html + app.js]
        │  같은 저장소의 data/history.json을 fetch (동일 출처, 서버 불필요)
        ▼
  브라우저에서 값·출처·심각도·위험도·CVSS·추이·비교를 렌더링
```

서버리스 프록시 없이 **정적 사이트 + 하루 1회 배치**로만 구성되어 있습니다. NVD API는 키 없이도 30초당 5회까지 호출할 수 있어(하루 1회 호출이면 충분), 비밀값을 아예 만들지 않는 쪽을 택했습니다.

## 기술 스택

- 프론트엔드: 순수 HTML/CSS/JavaScript (프레임워크 없음)
- 배치: Node.js 20, GitHub Actions (`schedule` cron + `workflow_dispatch`)
- 데이터 출처: [NVD CVE API 2.0](https://nvd.nist.gov/developers/vulnerabilities) (무키), [MyMemory Translation API](https://mymemory.translated.net/)(요약 한국어 번역, 실패해도 영문으로 대체)
- 배포: GitHub Pages

## 프로젝트 구조

```
index.html                      # 정보판 화면
assets/
├── app.js                      # fetch·렌더링·장애 시뮬레이터·비교/위험도 계산
└── style.css
data/
└── history.json                # 날짜별(KST) 기록 — Actions가 추가, 앱은 읽기 전용
scripts/
└── fetch-daily-count.mjs       # NVD 조회 → history.json 갱신 스크립트
.github/workflows/
└── daily-cve-count.yml         # 매일 09:00 KST 실행 배치
docs/
├── SUBMISSION.md / .pdf        # 최종 제출 문서 (카드5개·검증안내서·체크리스트 등)
└── worksheet/                  # 정의표·장애 검사표·손계산 대조표 등 근거 자료
PROGRESS.md                     # 진행 상황·설계 결정 이력
ASSIGNMENT.md                   # 과제 원문 (동결)
```

## 문서

- [`docs/SUBMISSION.md`](docs/SUBMISSION.md) — 목적·정의, 과제 카드 5개, 검증 안내서, AI 3줄, 체크리스트, 스크린샷을 담은 최종 제출 문서
- [`PROGRESS.md`](PROGRESS.md) — 진행 상황과 설계 결정 이력
- [`docs/worksheet/`](docs/worksheet/) — 정의표·장애 5종 검사표·손계산 대조표 등 근거 자료
