// geval.mjs에 넘길 평가 기준(criterion) 정의 모음. 이 프로젝트의 "지어내지 않는다" 원칙이
// 최우선이라 faithfulness/groundedCause/noFabrication을 항상 1순위로 두고, 그 다음이
// 번역 정확도·가독성 같은 품질 기준이다.

// explainHighlightWithLlm() 출력(title/summaryKo/interpretation/cause/mitigation)을 평가할 때 쓴다.
// output에는 다섯 필드를 사람이 읽는 카드처럼 이어붙인 텍스트를 넣어서 넘기면 된다.
export function explainCriteria() {
  return [
    {
      criterion: 'faithfulness',
      criterionDescription:
        '출력이 입력(원문 CVE 설명과 CWE 근거)에 실제로 있는 내용만 담고 있는지. 원문에 없는 구체적 공격 사례, ' +
        '피해 규모, 공격 그룹, 날짜, 통계 등을 지어냈다면 심각한 위반이다.',
      evaluationSteps: [
        '출력(title/요약/해석/원인/방지법)에서 사실 주장을 모두 추출한다.',
        '각 주장이 입력의 원문 설명이나 CWE 근거로 뒷받침되는지 확인한다.',
        '뒷받침되지 않는 구체적 사실(수치, 사건, 공격자, 제품 세부사항 등)이 하나라도 있으면 크게 감점한다.',
        '원인/방지법이 일반적인 보안 상식 수준의 서술(예: "패치를 적용하세요")이라면 지어낸 것으로 보지 않는다.',
      ],
    },
    {
      criterion: 'translationAccuracy',
      criterionDescription:
        '영문 원문(summaryEn에 해당하는 입력)과 한국어 번역(summaryKo)이 의미상 일치하는지. 특히 프로젝트/제품 ' +
        '고유명사가 일반 단어로 오역되지 않았는지(예: "Submariner"를 "잠수함"으로 번역하는 식의 실수) 확인한다.',
      evaluationSteps: [
        '입력의 영문 설명과 출력의 한국어 요약을 문장 단위로 대조한다.',
        '숫자, 제품명, 고유명사가 정확히 대응하는지 확인한다.',
        '고유명사로 보이는 단어(대문자로 시작, 낯선 단어 등)가 사전적 의미로 잘못 번역됐는지 특히 주의 깊게 본다.',
        '의미가 왜곡되거나 반대로 번역된 부분이 있으면 크게 감점한다.',
      ],
    },
    {
      criterion: 'groundedCause',
      criterionDescription:
        '"발생 원인" 설명이 입력에 주어진 CWE 근거(있는 경우) 또는 원문 설명 문구로 실제로 뒷받침되는지.',
      evaluationSteps: [
        '입력에 CWE 근거가 주어졌는지 확인한다.',
        '출력의 원인 설명이 그 CWE 근거의 취지와 일치하는지 확인한다.',
        'CWE 근거가 없는데 원인을 구체적으로 단정했다면(빈 문자열로 남기지 않았다면) 감점한다.',
        'CWE 근거와 무관한 원인을 지어냈다면 크게 감점한다.',
      ],
    },
    {
      criterion: 'koreanFluency',
      criterionDescription: '한국어 문장이 자연스럽고 문법적으로 올바르며, 기계 번역 특유의 어색함이 없는지.',
      evaluationSteps: [
        '각 필드의 한국어 문장을 읽고 어순·조사·어미가 자연스러운지 확인한다.',
        '영어 원문을 그대로 직역해 어색한 표현이 있는지 확인한다.',
        '전문 용어가 지나치게 생소하게 옮겨져 일반 독자가 이해하기 어려운지 확인한다(해석 필드는 특히 비전문가 대상임을 감안한다).',
      ],
    },
  ];
}

// generateBriefingWithLlm() 출력(하루 브리핑 문장)을 평가할 때 쓴다.
// input에는 그날 집계 수치(건수/심각도/최다 CWE/최다 제품)를 넘긴다.
export function briefingCriteria() {
  return [
    {
      criterion: 'noFabrication',
      criterionDescription:
        '브리핑이 주어진 집계 수치에 없는 구체적 CVE 번호·제품명·공격 사례·"실제 공격이 있었다"는 식의 ' +
        '근거 없는 단정을 포함하지 않는지. 이 프로젝트는 수치 밖의 내용을 지어내는 것을 엄격히 금지한다.',
      evaluationSteps: [
        '브리핑 문장에서 사실 주장을 모두 추출한다.',
        '각 주장이 입력으로 주어진 수치(총 건수, 심각도별 건수, 최다 CWE, 최다 제품)로 직접 뒷받침되는지 확인한다.',
        '수치에 없는 특정 CVE, 제품, 공격 그룹, 피해 사례를 언급했다면 크게 감점한다.',
        '"실제 공격이 벌어지고 있다" 같이 근거 없이 위협을 과장하는 단정이 있으면 크게 감점한다.',
      ],
    },
    {
      criterion: 'relevance',
      criterionDescription: '브리핑이 그날의 핵심 수치(전체 건수, 심각도 분포, 두드러진 유형/제품)를 정확히 반영하는지.',
      evaluationSteps: [
        '입력 수치 중 가장 눈에 띄는 것(가장 큰 심각도, 가장 많은 CWE/제품)이 무엇인지 파악한다.',
        '브리핑이 그 핵심을 언급하거나, 특별히 두드러진 게 없다면 그렇게 담백하게 서술했는지 확인한다.',
        '수치와 무관한 이야기로 흐르거나 핵심을 놓쳤다면 감점한다.',
      ],
    },
    {
      criterion: 'koreanFluency',
      criterionDescription: '한국어 문장이 자연스럽고 간결하며 브리핑 톤에 맞는지.',
      evaluationSteps: [
        '문장이 자연스러운 한국어인지 확인한다.',
        '불필요하게 장황하거나 반대로 정보가 부족하지 않은지 확인한다.',
      ],
    },
  ];
}
