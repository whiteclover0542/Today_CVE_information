// CWE(공식 취약점 유형 분류)를 근거로, fetch-daily-count.mjs의 CATEGORY_RULES 중 어떤 key가
// "정답"인지 사람이 직접 매핑해둔 표. LLM이나 정규식 결과가 아니라 각 CWE의 공식 정의와
// CATEGORY_RULES 패턴을 대조해서 만든 것이라, 분류 품질을 재는 골든셋의 정답지로 쓸 수 있다.
//
// 애매하거나(여러 유형에 걸치거나) CATEGORY_RULES 어디에도 명확히 안 맞는 CWE는 이 표에서 아예 뺐다.
// 정답을 억지로 끼워 맞추면 골든셋 자체가 오염되기 때문 — 그런 CWE는 골든셋 생성 시 통째로 제외된다.
//
// 'other'로 표시한 항목은 반대 방향 증거다: 이 CWE는 CATEGORY_RULES의 어떤 유형에도 해당하지
// 않으므로, 분류기가 무리하게 다른 유형에 끼워 맞추지 않고 '기타'를 유지하는 게 정답이라는 뜻.
// (분류기가 과도하게 유형을 지어내는지 확인하는 음성 사례로 쓰인다.)
export const CWE_CATEGORY_TRUTH = {
  'CWE-79': 'xss',
  'CWE-89': 'sqli',
  'CWE-78': 'rce', // OS 명령 인젝션 — rce 패턴이 command injection을 포함
  'CWE-77': 'rce', // 명령 인젝션 일반
  'CWE-94': 'rce', // 코드 인젝션
  'CWE-22': 'path-traversal',
  'CWE-352': 'csrf',
  'CWE-306': 'auth-bypass', // 인증 누락 — "missing authentication" 패턴과 정확히 일치
  'CWE-287': 'auth-bypass', // 부적절한 인증
  'CWE-288': 'auth-bypass', // 우회 경로를 통한 인증 우회
  'CWE-290': 'auth-bypass', // 위장을 통한 인증 우회
  'CWE-269': 'priv-esc',
  'CWE-284': 'access-control',
  'CWE-862': 'access-control', // 권한 검사 누락 — "missing authorization" 패턴과 일치
  'CWE-863': 'access-control',
  'CWE-285': 'access-control', // 부적절한 인가 — "improper authorization" 패턴과 일치
  'CWE-798': 'hardcoded-cred',
  'CWE-434': 'file-upload',
  'CWE-502': 'deserialization',
  'CWE-611': 'xxe',
  'CWE-918': 'ssrf',
  'CWE-190': 'integer-overflow',
  'CWE-191': 'integer-overflow', // 정수 언더플로우 — 패턴에 underflow 포함
  'CWE-125': 'buffer-overflow',
  'CWE-787': 'buffer-overflow',
  'CWE-122': 'buffer-overflow', // 힙 버퍼 오버플로우
  'CWE-416': 'use-after-free',
  'CWE-476': 'null-deref',
  'CWE-843': 'type-confusion',
  'CWE-367': 'race-condition',
  'CWE-134': 'format-string',
  'CWE-90': 'ldap-injection',
  'CWE-327': 'weak-crypto',
  'CWE-330': 'weak-crypto', // 예측 가능한 난수 — "insecure randomness" 패턴과 일치
  'CWE-319': 'cleartext',
  'CWE-311': 'cleartext', // 암호화 누락 — "missing encryption of sensitive data" 패턴과 일치
  'CWE-639': 'idor',
  'CWE-20': 'input-validation',
  'CWE-400': 'dos',
  'CWE-295': 'cert-validation',
  'CWE-297': 'cert-validation', // 인증서-호스트 불일치도 인증서 검증 오류의 하위 사례
  'CWE-601': 'open-redirect',
  'CWE-200': 'info-disclosure',

  // --- 아래는 CATEGORY_RULES 어디에도 해당하지 않아 '기타'가 정답인 CWE(음성 사례) ---
  'CWE-347': 'other', // 전자서명 검증 미흡 — 암호 관련이지만 weak-crypto/cert-validation 정의와는 다름
  'CWE-494': 'other', // 무결성 검증 없는 코드 다운로드
  'CWE-117': 'other', // 로그 인젝션 — 인젝션 계열이지만 sqli/rce/ldap 어디에도 안 맞음
  'CWE-1385': 'other', // WebSocket Origin 검증 누락
  'CWE-193': 'other', // Off-by-one
  'CWE-943': 'other', // 데이터 조회 로직 인젝션(일반) — sqli만큼 구체적이지 않음
};
