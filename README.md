# TODAY CVE — 오늘의 CVE 정보판

오늘 새로 등록된 보안 취약점(CVE)이 **몇 건이고, 얼마나 위험하고, 무엇이 문제인지**를 한 화면에서 보여줍니다.
매일 자동으로 [NVD](https://nvd.nist.gov/)에서 데이터를 받아 집계하고, 중요한 CVE는 AI가 한국어로 번역·해설합니다.

**🔗 https://today-cve-information.vercel.app/** — 서버·로그인·설치 없이 바로 열립니다.

![오늘의 브리핑과 건수·위험도 판단](docs/screenshots/hero.png)

## 무엇을 볼 수 있나

**오늘 무슨 일이 있었는가 → 무엇이 가장 위험한가 → 왜 위험한가 → 어떤 유형·제품이 많은가 → 추세는 어떤가**
순서로 읽히도록 4개 탭(오늘 / 월별 비교 / 추이·기록 / 검색)에 나눠 구성했습니다.

- **오늘의 브리핑** — 그날 집계된 수치(총 건수·심각도 분포·최다 유형/제품)만 근거로 AI가 쓴 1~3문장 요약. 근거 없는 사건·수치는 지어내지 않고, 생성에 실패하면 카드째 숨김
- **오늘 건수와 위험도** — 신규 CVE 수, 심각도 분포, 그리고 그 분포로 판단한 보통/주의/위험 3단계
- **가장 위험한 CVE** — CVSS 순으로 정렬. 제목과 한 줄 해석만 먼저 보이고, 펼치면 번역·원문·발생 원인·방지법
- **취약점 유형(CWE)·제품별 집계** — 오늘 무엇이 많았는지. 막대를 누르면 실제 CVE와 그 해설이 그대로 펼쳐짐
- **월별 비교와 추이** — 지난 달들과의 비교, 최근 14일 추이, 날짜별 전체 기록
- **CVE 검색** — 지금까지 화면에 불러온 대표 CVE·미분류 CVE·차트 예시를 대상으로 CVE 번호·제품명·CWE·키워드로 찾기

## 화면

CVE 카드는 제목·CVSS·CWE까지만 보여주고, 상세는 눌러야 펼쳐집니다. AI가 생성한 부분은 초록색으로 구분합니다.

![대표 CVE 카드](docs/screenshots/highlights.png)

차트는 "CWE 분포" 같은 분류명 대신 **결론을 제목으로** 답니다. 막대를 누르면 그 유형에 해당하는 실제 CVE와 해설이 나옵니다.

![취약점 유형 차트](docs/screenshots/category.png)

![제품·벤더 차트](docs/screenshots/product.png)

월별 비교 탭에서는 지난 달들과 유형·제품 순위를 겹쳐 볼 수 있습니다.

![월별 CWE·제품 비교](docs/screenshots/monthly-comparison.png)

추이·기록 탭은 최근 14일 흐름과 날짜별 전체 기록을 보여줍니다.

![최근 추이와 날짜별 기록](docs/screenshots/trend.png)

검색 탭에서는 지금까지 불러온 CVE를 번호·제품명·CWE·키워드로 바로 찾을 수 있습니다.

![CVE 검색](docs/screenshots/search.png)

## 어떻게 동작하나

```
Cloudflare Cron Trigger (매일 09:00 KST 정각)
  └ GitHub API로 workflow_dispatch 호출
        ↓
GitHub Actions
  └ NVD CVE API 2.0 조회 (오늘 00:00 KST ~ 실행 시각)
  └ 심각도·CWE 유형·제품 집계
  └ 중요 CVE는 Gemini로 번역 + 해석 + 발생 원인 + 방지법 생성, 오늘의 브리핑도 함께 생성
  └ data/history.json 에 하루 1건 추가 → commit & push
        ↓
Vercel (GitHub 연동, push마다 자동 재배포)
  └ 같은 저장소의 history.json 을 fetch 해서 렌더링
```

GitHub Actions의 `schedule` cron은 정시(0분)에 부하가 몰려 실행 시각이 매일 들쭉날쭉해지는 문제가 있어(
자세한 내용은 [`cloudflare-worker/README.md`](cloudflare-worker/README.md)), 실행 시각만 Cloudflare Cron Trigger가
정확히 맞춰 트리거하고 실제 작업은 그대로 GitHub Actions가 합니다.

서버리스 프록시 없이 **정적 사이트 + 하루 1회 배치**로만 굴러갑니다.

## 설계 원칙

- **지어내지 않는다** — AI 해설은 NVD 공식 CWE 분류를 근거로만 생성하고, 근거가 없으면 그 항목을 아예 비웁니다.
  CWE가 없는 CVE는 해설 없이 목록으로만 보여주고, 한글 이름이 없는 CWE는 ID를 그대로 씁니다.
- **비밀값을 만들지 않는다** — 브라우저가 쓰는 건 전부 무키 공개 데이터입니다.
  Gemini 키는 배치 환경(GitHub Actions 시크릿)에만 있고 배포 파일·Git 기록 어디에도 없습니다.
- **실패해도 값은 남긴다** — 조회에 실패하면 마지막 정상값을 유지한 채 "오래된 데이터"임을 배너로 알립니다.
  `?debug=1`로 timeout·인증 실패·호출 제한·오프라인·응답 형식 변경 5종을 직접 재현해 볼 수 있습니다.

![장애 재현 시 배너](docs/screenshots/failure-offline.png)

## 기술 스택

순수 HTML/CSS/JS (프레임워크 없음) · Node.js 20 배치 · GitHub Actions · Vercel
· [NVD CVE API 2.0](https://nvd.nist.gov/developers/vulnerabilities)(무키) · Gemini API(번역·해설, 무료 티어)

## 구조

```
index.html                       # 화면
assets/app.js, style.css         # 렌더링·집계·장애 시뮬레이터
data/history.json                # 날짜별 기록 — 배치가 쓰고, 화면은 읽기만
scripts/
├── fetch-daily-count.mjs        # NVD 조회 → 집계·번역·해설·브리핑 → history.json 갱신
├── cwe-info.mjs                 # CWE 한글 라벨·근거 문장 매핑
├── backfill-cwe-labels.mjs      # 매핑 추가 시 과거 기록에 소급 적용
└── eval/                        # LLM 출력(분류·번역·해설·브리핑) 품질 평가 프레임워크
.github/workflows/                # workflow_dispatch로 실행되는 배치 (스케줄은 아래 워커가 트리거)
cloudflare-worker/                # 매일 09:00 KST 정각에 위 워크플로를 깨우는 Cron Trigger
docs/                             # 기획서·진행 관리 문서, 스크린샷
├── PLAN.md
├── PROGRESS.md
├── AI_EVAL_REPORT.md            # LLM 출력 품질 평가 결과와 해석
├── AI_EVAL_PROGRESS.md          # 위 평가의 진행 상태판
└── screenshots/                  # 이 README의 스크린샷
assignment/                      # 과제 단계 자료·개편 전 스크린샷 (동결)
```

## 문서

- [`docs/SHOWCASE.md`](docs/SHOWCASE.md) — 스크린샷·아키텍처·AI 품질 평가 결과를 한 번에 모은 소개 자료
- [`docs/PLAN.md`](docs/PLAN.md) — 서비스 기획서
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — 진행 상황과 설계 결정 이력
- [`docs/AI_EVAL_REPORT.md`](docs/AI_EVAL_REPORT.md) — 분류·번역/해설·브리핑 등 LLM 출력 품질 평가 결과
- [`scripts/eval/README.md`](scripts/eval/README.md) — 위 평가 프레임워크 사용법
- [`assignment/`](assignment/) — 과제 원문·제출 문서·근거 자료 (실 서비스 문서와 분리)
