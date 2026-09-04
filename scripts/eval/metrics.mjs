// LLM 호출 없이 계산하는 결정론적 지표들. G-Eval(geval.mjs)이 다루는 "품질이 얼마나 좋은가"와
// 달리, 여기는 "명백히 틀렸는지/규칙을 어겼는지"를 값싸고 재현 가능하게 잡아내는 역할을 한다.

// --- 분류(카테고리) 평가용 ---

// predictions/goldens: 같은 순서로 대응하는 categoryKey 배열.
export function classificationMetrics(predictions, goldens) {
  if (predictions.length !== goldens.length) {
    throw new Error('predictions와 goldens 길이가 다름');
  }
  const n = predictions.length;
  let correct = 0;
  const confusion = {}; // confusion[golden][predicted] = count
  const labels = new Set();

  for (let i = 0; i < n; i += 1) {
    const g = goldens[i];
    const p = predictions[i];
    labels.add(g);
    labels.add(p);
    if (g === p) correct += 1;
    (confusion[g] ||= {});
    confusion[g][p] = (confusion[g][p] || 0) + 1;
  }

  // 라벨별 precision/recall/F1 (macro 평균용)
  const perLabel = {};
  for (const label of labels) {
    let tp = 0, fp = 0, fn = 0;
    for (const g of labels) {
      for (const p of labels) {
        const count = confusion[g]?.[p] || 0;
        if (g === label && p === label) tp += count;
        else if (g !== label && p === label) fp += count;
        else if (g === label && p !== label) fn += count;
      }
    }
    const precision = tp + fp === 0 ? null : tp / (tp + fp);
    const recall = tp + fn === 0 ? null : tp / (tp + fn);
    const f1 = precision && recall && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
    perLabel[label] = { tp, fp, fn, precision, recall, f1 };
  }

  const f1s = Object.values(perLabel).map((l) => l.f1).filter((v) => v !== null);
  const macroF1 = f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null;

  return {
    n,
    accuracy: n === 0 ? null : correct / n,
    macroF1,
    perLabel,
    confusion,
  };
}

// --- 생성(번역·해설·브리핑) 평가용 휴리스틱 ---

// 한글(가-힣) 비율 — 결과가 영어 원문을 그대로 베끼거나(번역 실패) 다른 언어가 섞였는지 값싸게 감지.
export function koreanRatio(text) {
  if (!text) return 0;
  const chars = [...text].filter((c) => !/\s/.test(c));
  if (chars.length === 0) return 0;
  const korean = chars.filter((c) => /[가-힣]/.test(c));
  return korean.length / chars.length;
}

// 출력 텍스트에 소스 CVE ID가 아닌 다른 CVE-YYYY-NNNNN 패턴이 등장하면 십중팔구 다른 사건을
// 지어내거나 착각해 끌어온 것 — 이 프로젝트의 "위조 금지" 원칙 위반을 값싸게 잡는 안전장치.
export function findUnexpectedCveIds(text, sourceCveId) {
  if (!text) return [];
  const matches = text.match(/CVE-\d{4}-\d{4,}/g) || [];
  return [...new Set(matches)].filter((id) => id !== sourceCveId);
}

export function isEmptyField(value) {
  return value === null || value === undefined || value.toString().trim() === '';
}

// 길이가 비정상적으로 짧거나(내용 없음) 길면(프롬프트 무시하고 장황해짐) 표시만 해주는 용도.
export function lengthFlag(text, { min = 5, max = 500 } = {}) {
  if (!text) return 'empty';
  const len = text.trim().length;
  if (len < min) return 'too_short';
  if (len > max) return 'too_long';
  return 'ok';
}
