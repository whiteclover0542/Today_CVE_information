# 스케줄러 (Cloudflare Workers Cron Trigger)

GitHub Actions의 `schedule` cron은 정시(0분)에 부하가 몰려 실행 시각이 매일 들쭉날쭉해지는 문제가 있습니다
(짧게는 몇 분, 길게는 몇 시간까지 지연). 이를 피하기 위해 실제 실행은 여전히 GitHub Actions에서 하되,
"언제 실행할지"만 Cloudflare Cron Trigger가 정확한 시각에 트리거하도록 분리했습니다.

```
Cloudflare Cron Trigger (00:00 UTC 정각, 분 단위로 정확)
  └ GitHub API POST .../actions/workflows/daily-cve-count.yml/dispatches
        ↓
GitHub Actions (workflow_dispatch로 즉시 실행 시작)
  └ 기존과 동일: NVD 조회 → 집계 → Gemini 번역/해설 → history.json commit & push
```

## 처음 설정하는 법

1. **GitHub PAT 발급** (Cloudflare Worker가 workflow_dispatch를 호출할 때 씀)
   - GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token
   - Repository access: **이 저장소만** 선택 (`Today_CVE_information`)
   - Permissions: **Actions: Read and write** 만 부여 (그 외 권한 불필요)
   - 만료 기간을 설정했다면 캘린더에 갱신 알림을 걸어두세요.

2. **Cloudflare 계정 준비 & wrangler 로그인**
   ```bash
   cd cloudflare-worker
   npx wrangler login
   ```

3. **시크릿 등록** (1번에서 만든 PAT — 절대 wrangler.toml이나 코드에 직접 넣지 않기)
   ```bash
   npx wrangler secret put GITHUB_TOKEN
   ```

4. **배포**
   ```bash
   npx wrangler deploy
   ```

5. **동작 확인** (선택) — 배포된 워커 URL로 접속하면 즉시 한 번 dispatch를 날려볼 수 있습니다.
   ```bash
   curl https://today-cve-scheduler.<your-subdomain>.workers.dev
   ```
   → GitHub 저장소 Actions 탭에서 `Daily CVE Count` 실행이 바로 시작되는지 확인.

## 설정 바꾸기

- 저장소 이름이 바뀌거나 브랜치가 바뀌면 `wrangler.toml`의 `[vars]`만 수정하면 됩니다 (코드 수정 불필요).
- 실행 시각을 바꾸려면 `wrangler.toml`의 `[triggers] crons` 값을 수정 후 재배포.
