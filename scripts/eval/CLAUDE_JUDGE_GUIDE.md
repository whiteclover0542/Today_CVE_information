# Claude 심사관 채점 지침서 (독립 세션용)

> 이 문서를 읽고 있다면 이 저장소(`today_information`)를 새로 연 Claude Code 세션입니다. 이전 대화 맥락은 전혀 없어도 되고, 오히려 없는 게 이 작업의 목적(자기 편향 없는 독립 채점)에 맞습니다. 아래 지침만으로 작업을 완료할 수 있습니다.
>
> **채점을 끝내기 전까지 다음 파일들은 열지 마세요**: `scripts/eval/reports/` 안의 기존 결과 파일(`generation-*.json`, `generation-calibration-*.json`, `briefing-*.json`, `claude-judge-*.json` 등), `docs/AI_EVAL_REPORT.md`. 이전 채점 결과(Gemini 자기 채점 + 이전 Claude 독립 채점)가 들어 있어서, 먼저 보면 판단이 거기에 끌려갈 수 있습니다(앵커링 편향). 다 채점한 뒤에 비교하려고 열어보는 건 괜찮습니다.
>
> **참고**: 이번이 처음이 아니라면(이미 `claude-judge-generation.json` 등이 있다면), 그건 프롬프트를 고치기 *전* 버전을 채점한 결과입니다. 지금 골든셋(`golden/generation.json`, `golden/briefing.json`)의 `storedOutput`/`generatedOutput`은 프롬프트 개선 후 다시 생성한 최신 버전으로 갱신돼 있으니, 이번 채점은 "그 개선이 실제로 점수를 올렸는가"를 확인하는 2차 채점입니다.

## 배경 (이 정도만 알면 충분함)

이 프로젝트는 NVD가 매일 등록하는 CVE(보안 취약점)를 모아 보여주는 대시보드입니다. Gemini(`gemini-3.5-flash-lite`)가 세 가지 일을 합니다: ① 유형(카테고리) 재분류, ② 대표 CVE의 번역·해설(제목/한국어 요약/해석/발생 원인/방지법) 생성, ③ 오늘의 브리핑(1~3문장 요약) 생성. 이 프로젝트는 "지어내지 않는다"를 최우선 원칙으로 삼습니다 — 근거 없는 사실을 만들어내면 안 됩니다.

지금까지 Gemini 자체 모델(`gemini-3.5-flash`)을 심사관으로 써봤는데, (1) 같은 제공사 모델이 자기 계열 출력을 채점하는 자기 편향 우려, (2) 무료 티어 일일 할당량이 너무 낮아(20건/일) 20개 표본 중 2~4개만 채점되고 나머지는 조용히 실패하는 문제가 겹쳐 신뢰할 수 없는 결과가 나왔습니다. 그래서 완전히 다른 제공사·모델인 **Claude(당신)** 가 직접 읽고 채점하는 방식으로 바꿉니다 — API 호출이 아니라 당신이 직접 추론해서 점수를 매기는 것입니다.

## 채점 대상 3세트

### 세트 A — 생성 품질: `scripts/eval/golden/generation.json`

`cases` 배열의 각 항목은 `{ id, severity, summaryEn, cwe: [{id, label, hint}], storedOutput: {title, summaryKo, interpretation, cause, mitigation} }` 형태입니다. **20건.**

각 케이스마다 아래처럼 입력/출력 텍스트를 구성한 뒤 채점하세요(자동화 스크립트가 쓰는 것과 동일한 구성 — 비교 가능하게 하기 위함):

- **입력**: `영문 원문: {summaryEn}` + 줄바꿈 두 번 + `CWE 근거:` + 각 cwe 항목을 `{id} ({label}): {hint}` 형식으로 줄바꿈해 나열(cwe 배열이 비어있으면 `(없음)`)
- **출력**: `title: {title}` / `summaryKo: {summaryKo}` / `interpretation: {interpretation}` / `cause: {cause}` / `mitigation: {mitigation}` — 각 필드를 한 줄씩

4개 기준으로 채점(각 1~5점): `faithfulness`, `translationAccuracy`, `groundedCause`, `koreanFluency`. **각 기준의 정확한 정의와 체크리스트는 `scripts/eval/criteria.mjs`의 `explainCriteria()` 함수를 그대로 읽고 따르세요** — 아래 "점수 기준"과 함께 적용합니다.

### 세트 B — 심사 신뢰도 검증(calibration): `scripts/eval/golden/calibration.json`

`cases` 배열 각 항목은 `{ id, label: "good"|"bad", severity, summaryEn, cwe, output: {title, summaryKo, interpretation, cause, mitigation}, note }`. **5건**(good 2 + bad 3, bad는 고의로 오염시킨 사례). 입력/출력 구성과 채점 기준은 세트 A와 동일합니다(`output` 필드를 씀). `note` 필드는 각 사례에 어떤 결함을 심어뒀는지 힌트가 적혀있는데, **채점 끝나고 자기 검증할 때만 참고**하고 채점 자체는 순수하게 입력·출력만 보고 판단하세요.

### 세트 C — 브리핑 품질: `scripts/eval/golden/briefing.json`

`cases` 배열 각 항목은 `{ id, note, stats: {count, severity: {critical,high,medium,low,unrated}, topCwe, topProduct, categorySampleSize}, generatedOutput }`. **4건**(합성 시나리오 + 실제 생성된 브리핑 문장).

입력 텍스트 구성:
```
오늘(KST) 신규 등록 CVE 총 {count}건
심각도별 — 심각 {critical}건 / 높음 {high}건 / 중간 {medium}건 / 낮음 {low}건 / 평가 대기 {unrated}건
가장 많이 나온 취약점 유형(CWE): {topCwe.label} {topCwe.count}건   (topCwe가 null이면 "오늘은 CWE 유형 집계 대상이 없음")
가장 많이 언급된 제품·벤더: {topProduct.label} {topProduct.count}건   (topProduct가 null이면 "오늘은 특정 제품·벤더가 두드러지지 않음")
```
출력은 `generatedOutput` 문자열 그대로.

3개 기준으로 채점: `noFabrication`, `relevance`, `koreanFluency`. 정의·체크리스트는 `scripts/eval/criteria.mjs`의 `briefingCriteria()` 함수 참고.

## 점수 기준 (모든 세트 공통)

1~5 정수. **5**=완벽히 충족, **4**=대체로 충족(경미한 흠), **3**=절반 정도 충족(눈에 띄는 문제), **2**=대부분 미달, **1**=완전히 어긋남. 반드시 해당 기준의 체크리스트(criteria.mjs)를 순서대로 따져본 뒤 점수를 매기고, 판단 근거를 2~4문장으로 남기세요.

## 진행 방법

각 케이스 × 각 기준 조합마다 한 번씩 판단하면 됩니다(1회 판단으로 충분 — 자동화 스크립트처럼 같은 걸 3번 반복할 필요 없음. 당신은 API 확률 샘플링이 아니라 직접 추론이라 반복이 무의미함). 총 판단 횟수: 세트 A 20×4=80, 세트 B 5×4=20, 세트 C 4×3=12 — 합계 112건.

## 결과 저장

**먼저**: `scripts/eval/reports/claude-judge-{generation,calibration,briefing}.json`이 이미 존재한다면(이전 채점 라운드 결과), 그대로 덮어쓰지 말고 각각 `claude-judge-{generation,calibration,briefing}-prev.json`으로 먼저 복사(백업)해두세요 — 이전 라운드가 무엇을 근거로 판단했는지(케이스별 reasoning)는 나중에 회귀 원인을 추적할 때 꼭 필요한데, 평균 수치만 `docs/AI_EVAL_REPORT.md`에 남고 원본은 사라지면 복구할 수 없습니다.

그다음, 아래 3개 JSON과 요약 1개를 `scripts/eval/reports/`에 새로 만드세요(파일명 접두어 `claude-judge-`로 구분):

- `scripts/eval/reports/claude-judge-generation.json` — `{ "judge": "claude", "results": [{ "id": "...", "criteria": [{ "criterion": "faithfulness", "score": 5, "reasoning": "..." }, ...] }, ...] }`
- `scripts/eval/reports/claude-judge-calibration.json` — 같은 형식(각 케이스에 `label: "good"|"bad"`도 같이 넣기)
- `scripts/eval/reports/claude-judge-briefing.json` — 같은 형식
- `scripts/eval/reports/claude-judge-summary.md` — 사람이 읽을 요약: 기준별 평균 점수(세트 A·C), calibration의 good 평균 vs bad 평균(격차가 클수록 좋음), 점수가 낮게 나온 케이스와 그 이유를 짧게 정리

## 다 끝난 뒤에

`docs/AI_EVAL_REPORT.md`를 열어서 기존 목표치(≥4.0 등)와 당신의 채점 결과를 대조하세요. 이전에 `scripts/eval/reports/claude-judge-generation.json` 등(프롬프트 개선 *전* 버전을 채점한 1차 결과)이 있다면, 이번 결과와 기준별로 비교해서 실제로 점수가 올랐는지(특히 groundedCause — CWE 근거 있으면 cause를 반드시 채우도록 프롬프트를 고쳤음, koreanFluency — 브리핑 조사 오용을 고쳤음)를 요약에 적어주세요. 1차 채점이 없다면(첫 실행이라면) 이 비교는 생략해도 됩니다.
