// 매일 00:00 UTC(=09:00 KST)에 GitHub Actions의 daily-cve-count.yml을 workflow_dispatch로 깨운다.
// GitHub의 schedule(cron) 트리거는 정시(0분)에 몰려 실행이 최대 몇 시간까지 밀리는 문제가 있어서,
// Cloudflare Cron Trigger(분 단위로 정확히 실행됨)가 대신 정확한 시각에 API를 호출하는 역할만 한다.
// 실제 NVD 조회·집계·번역·커밋은 전부 기존 GitHub Actions 워크플로 안에서 그대로 일어난다.
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchWorkflow(env));
  },

  // wrangler dev/curl로 수동 테스트할 때 쓰는 진입점 — 배포된 워커에 그대로 fetch로 접근해도 동작 확인 가능
  async fetch(request, env, ctx) {
    await dispatchWorkflow(env);
    return new Response('dispatched');
  },
};

async function dispatchWorkflow(env) {
  const { GITHUB_OWNER, GITHUB_REPO, GITHUB_WORKFLOW_FILE, GITHUB_REF, GITHUB_TOKEN } = env;

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW_FILE}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'today-cve-scheduler-worker',
    },
    body: JSON.stringify({ ref: GITHUB_REF }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`workflow_dispatch 실패: HTTP ${res.status} ${body}`);
    throw new Error(`workflow_dispatch failed: HTTP ${res.status}`);
  }

  console.log('workflow_dispatch 성공');
}
