# AI 품질 평가 프레임워크

이 프로젝트가 LLM(Gemini)을 쓰는 세 곳 — ① '기타' CVE 재분류, ② 대표 CVE 번역·해설(제목/한국어 요약/해석/원인/방지법), ③ 오늘의 브리핑 — 을 평가하기 위한 오프라인 도구 모음이다. 매일 도는 배치(`fetch-daily-count.mjs`)와는 완전히 분리돼 있고, 사람이 필요할 때 수동으로 돌린다.

## 왜 이렇게 나눴는가

- **분류(①)**: 닫힌 집합(정해진 카테고리 중 하나를 고름)이라 "정답이 있다" — 정확도·F1 같은 결정론적 지표로 채점할 수 있다.
- **생성(②③)**: 열린 텍스트라 "정답 문장"이 없다 — 대신 [G-Eval](https://arxiv.org/abs/2303.16634) 방식(LLM 심사관에게 평가 기준과 체크리스트를 주고 1~5점을 매기게 함)으로 채점한다. 이 프로젝트가 가장 중시하는 "지어내지 않는다" 원칙 때문에 `faithfulness`/`groundedCause`/`noFabrication` 기준을 항상 최우선으로 둔다.

## 폴더 구조

```
scripts/eval/
  cwe-category-truth.mjs         CWE → 정답 카테고리 매핑(사람이 CWE 공식 정의 보고 작성)
  build-classification-golden-set.mjs   data/history.json에서 분류 골든셋 자동 생성
  build-generation-golden-set.mjs       data/history.json에서 생성 품질 골든셋 자동 생성(다양성 표본)
  golden/
    classification.json          (자동 생성) 분류 골든셋
    generation.json               (자동 생성) 생성 품질 골든셋 — 실제 운영 출력 포함
    calibration.json              (손으로 작성) 심사 모델 자체를 검증하는 good/bad 사례
    briefing.json                 (손으로 작성) 브리핑용 합성 통계 시나리오
  geval.mjs                       범용 G-Eval 구현(Gemini 호출, self-consistency 평균)
  criteria.mjs                    이 프로젝트 전용 평가 기준(faithfulness, translationAccuracy 등)
  metrics.mjs                     결정론적 지표(accuracy/F1, 한글 비율, 낯선 CVE ID 탐지 등)
  report.mjs                      JSON+Markdown 리포트 저장 유틸
  run-classification-eval.mjs     분류 평가 실행
  run-generation-eval.mjs         생성 품질 평가 실행(스냅샷/재생성/calibration)
  run-briefing-eval.mjs           브리핑 품질 평가 실행
  run-all.mjs                     위 네 가지를 한 번에 돌리고 종합 Markdown 리포트 하나로 요약
  reports/                        (자동 생성, gitignore 권장) 실행할 때마다 타임스탬프로 쌓이는 결과물
```

## 사용법

```bash
# 1) 골든셋 생성/갱신 — data/history.json이 쌓일 때마다 다시 돌리면 됨
node scripts/eval/build-classification-golden-set.mjs
node scripts/eval/build-generation-golden-set.mjs

# 2) 개별 평가
node scripts/eval/run-classification-eval.mjs
node scripts/eval/run-generation-eval.mjs                 # 운영에 저장된 출력을 그대로 채점(회귀 스냅샷)
node scripts/eval/run-generation-eval.mjs --regenerate     # 같은 입력으로 지금 프롬프트로 다시 생성해서 채점
node scripts/eval/run-generation-eval.mjs --calibration    # 심사 모델 자체가 제대로 작동하는지 검증
node scripts/eval/run-briefing-eval.mjs

# 3) 전체 종합 리포트 (위 4개를 순서대로 돌리고 Markdown 하나로 요약)
node scripts/eval/run-all.mjs
```

결과는 `scripts/eval/reports/`에 `<종류>-<타임스탬프>.json`과 `.md`로 같이 저장된다. `run-all.mjs`는 추가로 `summary-<타임스탬프>.md` 하나에 4개 리포트의 핵심 수치와 각 상세 리포트 경로를 표로 정리한다.

## 필요 환경변수

`GEMINI_API_KEY`(단일 키) 또는 `GEMINI_API_KEYS`(쉼표/줄바꿈으로 구분한 여러 키) — 분류의 LLM 재분류 단계와, 생성/브리핑 평가의 G-Eval 심사 호출 둘 다에 필요하다.
- 없어도 분류 평가는 돌아간다(규칙 매칭만으로 채점 — 그 자체로 "LLM 재분류가 실제로 얼마나 기여하는지"를 보여주는 기준선이 된다).
- 생성/브리핑 평가는 키가 없으면 안내 메시지를 내고 종료한다(심사가 핵심이라 대체 경로가 없음).

### 심사 모델을 두 번 바꾼 이유 (pro → flash → flash-lite)

처음엔 운영(`gemini-3.5-flash-lite`)보다 무거운 모델을 심사용으로 쓰려 했다: pro 등급(`gemini-*-pro*`)은 이 프로젝트가 쓰는 무료 티어 키에서 할당량이 아예 0(`RESOURCE_EXHAUSTED`, 재시도 무의미)이라 접근 자체가 안 됐고, 차선으로 쓴 non-lite `gemini-3.5-flash`는 **일일 무료 할당량이 20건뿐**이라 실제로 돌려보니 생성 품질 평가(케이스당 최대 12콜, 20건)가 20콜만 성공하고 나머지는 전부 429로 조용히 실패했다(평균만 보고 "20건 다 채점됐다"고 착각하기 쉬운 함정이었음 — `gEvalScore`가 이제 `samples`회 중 일부만 성공하면 `partialFailureNote`를 같이 반환하도록 고쳐서 이런 착시를 막는다). 결국 운영에서 이미 매일 문제없이 쓰는 `gemini-3.5-flash-lite`로 정착했다.

이 사정으로 **키 하나만으로는 20건 규모 평가도 하루 안에 다 못 돌릴 수 있다.** `geval.mjs`는 그래서 `GEMINI_API_KEYS`로 여러 키를 순환 사용하고, 한 키가 429면 대기 없이 바로 다음 키로 넘어가며, 풀 전체가 한 바퀴 다 429일 때만 서버가 알려준 시간만큼 기다렸다가 한 번 더 시도한다(`callJudgeWithRotation`).

### 더 근본적인 대안: Claude를 독립 심사관으로

같은 제공사(Google) 모델이 자기 계열 출력을 채점하는 자기 편향 우려는 flash-lite로도 완전히 해소되지 않는다. 그래서 **완전히 다른 제공사·모델인 Claude가 별도의 새 세션에서 API 호출 없이 직접 읽고 채점하는 방식**을 병행 지원한다 — [`scripts/eval/CLAUDE_JUDGE_GUIDE.md`](CLAUDE_JUDGE_GUIDE.md)가 그 독립 세션이 따라야 할 자기완결적 지침서다(이 프로젝트를 새로 연 세션이 사전 맥락 없이 바로 채점할 수 있게 작성됨). 결과는 `scripts/eval/reports/claude-judge-*.json`으로 저장되고, `docs/AI_EVAL_REPORT.md`에서 Gemini 자기 채점 결과와 나란히 비교한다.

## 골든셋을 어떻게 신뢰할 수 있는가

- **분류 골든셋**은 사람이 CVE 설명을 하나씩 읽고 라벨을 붙인 게 아니라, NVD가 공식적으로 매기는 CWE 분류를 근거로 자동 생성한다(`cwe-category-truth.mjs`). 애매한 CWE는 아예 골든셋에서 뺐다 — 정답을 억지로 끼워 맞추지 않는 게 억지로 채우는 것보다 낫다는 판단.
- **생성 골든셋**은 정답 문장이 없는 대신, 실제 운영에서 나온 출력을 그대로 담아 "지금 배포된 프롬프트의 평균 품질"을 재는 스냅샷으로 쓴다. 프롬프트를 고친 뒤에는 `--regenerate`로 같은 입력에 대해 다시 생성해 점수가 실제로 올랐는지 비교하면 된다.
- **calibration 골든셋**은 골든셋이 아니라 심사 모델을 검증하는 용도다. 고의로 오염시킨 출력(고유명사 오역, 없는 사건 지어내기, 근거 없는 원인 서술)을 넣어뒀고, 이게 낮은 점수를 받아야 다른 모든 평가 결과를 신뢰할 수 있다. `run-generation-eval.mjs --calibration`을 돌리면 good/bad 그룹의 평균 점수 격차를 보여준다 — 격차가 작거나 역전되면 심사 프롬프트나 모델을 의심해야 한다.

## 알려진 한계

- G-Eval 원 논문은 토큰 로그확률로 기댓값 점수를 내지만, 여기서는 같은 호출을 3회 반복(self-consistency)한 평균으로 근사한다. 정밀도보다 재현성·구현 단순성을 택한 것.
- 분류 골든셋은 대표 CVE(highlights)에서만 뽑는다 — CWE가 없어 대표에도 못 오른 CVE(secondaryHighlights)는 애초에 전문(영문 설명)을 저장하지 않아 골든셋에 넣을 수 없다.
- 브리핑은 아직 운영 데이터에 실적이 없어(신규 기능) 골든셋이 전부 손으로 만든 합성 시나리오다. 실제 운영에서 브리핑이 쌓이면 생성 골든셋처럼 실제 사례 기반으로 바꾸는 게 좋다.
