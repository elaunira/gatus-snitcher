# gatus-snitcher

Reusable GitHub Action that reports a success or error to a [Gatus](https://github.com/TwiN/gatus) external endpoint using the official external endpoint API. It’s designed for jobs that run outside of Gatus but should still contribute to uptime/health via an external endpoint.

- Validates inputs and sends a JSON payload with status and optional details.
- Uses a bearer (or custom) auth header with your API token.
- Exposes outputs for the reported `endpoint`, `http-status`, and `status`.

By default, the action performs a POST to:

```
<base-url>/api/v1/endpoints/{key}/external?success={true|false}&error={msg}&duration={duration}
```

Where `key` is built from `<GROUP>_<NAME>` with the characters space, `/`, `_`, `,`, `.`, and `#` replaced by `-` (e.g., `core_ext--ep-test`). You can override the base path/suffix via `endpoint-path` and `endpoint-suffix` if your deployment differs.

## Inputs

### Required
- `base-url`: Base URL of your Gatus instance (required when `mode: report`).
- `group`: Group of the external endpoint.
- `name`: Name of the external endpoint.
- `token`: API token for Gatus (required when `mode: report`).

### Optional
- `auth-header`: Header used for token; default `Authorization`.
- `auth-scheme`: Scheme before token; default `Bearer` (set to empty to send raw token).
- `duration`: Duration string (e.g., `10s`, `250ms`). If omitted in `report` mode, the action uses the timer started in `start` mode (if present).
- `dry-run`: If `true`, logs request without sending.
- `endpoint-path`: API base path; default `/api/v1/endpoints`.
- `endpoint-suffix`: Suffix appended after the key; default `/external`.
- `error-message`: Description for failures.
- `extra-headers`: Additional HTTP headers as JSON or newline-delimited `Key: Value` lines (e.g., Cloudflare Access headers).
- `mode`: `start` to record a timer or `report` to send the result; default `report`.
- `status`: `success` (default) or anything else treated as `error` (e.g., pass `${{ job.status }}`).
- `timer-id`: Optional namespace for the timer (defaults to the derived `<GROUP>_<NAME>` key).
- `timeout-ms`: HTTP timeout in ms; default `15000`.

## Outputs

- `endpoint`: Full URL used for the report.
- `http-status`: HTTP status code returned by Gatus.
- `status`: Status reported to Gatus (`success` or `error`).

## Usage

Replace `elaunira/gatus-snitcher@v1` with the tag/commit of this repository once published.

### Report success in a job

```yaml
name: Example Success
on:
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run your workload
        run: |
          echo "Do something..."
          # Simulate some work
          sleep 2

      - name: Report success to Gatus
        uses: elaunira/gatus-snitcher@v1
        with:
          base-url: https://status.example.com
          group: ci
          name: nightly-build
          token: ${{ secrets.GATUS_TOKEN }}
          status: success
          duration: 2s
```

### Two-phase timer (start/report) in one job

Use the action once to start a timer, run your workload, then call it again to report. The second call will compute the duration from the stored start time if you don’t pass `duration` explicitly. You can also pass `job.status` directly; the action treats any non-`success` value as an error.

```yaml
name: Timed Job
on:
  workflow_dispatch:

jobs:
  timed:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Start timer
        uses: elaunira/gatus-snitcher@v1
        with:
          mode: start
          group: ci
          name: timed-task

      - name: Do work
        run: |
          echo "Doing work..."
          sleep 2

      - name: Report to Gatus
        if: always()
        uses: elaunira/gatus-snitcher@v1
        with:
          mode: report
          base-url: https://status.example.com
          group: ci
          name: timed-task
          token: ${{ secrets.GATUS_TOKEN }}
          status: ${{ job.status }}   # success -> success, others -> error
          # duration omitted -> computed from the earlier Start timer step
```

Notes:
- If you need multiple timers in the same job, add `timer-id` to both calls with the same value to namespace the timer (defaults to the derived `<GROUP>_<NAME>` key).
- Ensure the final report step uses `if: always()` so it runs even when the job fails.

### Report error on failure

```yaml
name: Example Error
on:
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run tests
        run: |
          npm test

      - name: Report error to Gatus
        if: failure()
        uses: elaunira/gatus-snitcher@v1
        with:
          base-url: https://status.example.com
          group: ci
          name: nightly-tests
          token: ${{ secrets.GATUS_TOKEN }}
          status: error
          error-message: "Tests failed"
```

### Customize auth header or API path

Some deployments may use `X-API-Key` or a custom path:

```yaml
- name: Report with custom header and path
  uses: elaunira/gatus-snitcher@v1
  with:
    base-url: https://status.example.com
    group: ci
    name: import-job
    token: ${{ secrets.GATUS_TOKEN }}
    auth-header: X-API-Key
    auth-scheme: ""  # send token without scheme
    endpoint-path: /api/v1/endpoints
    endpoint-suffix: /external
```

### Add Cloudflare Access headers

If your Gatus API is protected by Cloudflare Access, pass the required headers:

```yaml
- name: Report with Cloudflare Access
  uses: elaunira/gatus-snitcher@v1
  with:
    base-url: https://status.example.com
    group: ci
    name: protected-job
    token: ${{ secrets.GATUS_TOKEN }}
    status: success
    extra-headers: |
      CF-Access-Client-Id: ${{ secrets.CF_ACCESS_CLIENT_ID }}
      CF-Access-Client-Secret: ${{ secrets.CF_ACCESS_CLIENT_SECRET }}
```

Add to your step only (inline snippet):

```yaml
with:
  extra-headers: |
    CF-Access-Client-Id: ${{ secrets.CF_ACCESS_CLIENT_ID }}
    CF-Access-Client-Secret: ${{ secrets.CF_ACCESS_CLIENT_SECRET }}
```

## Security

- Always store tokens in `secrets` (e.g., `${{ secrets.GATUS_TOKEN }}`) and never commit them.
- This action redacts header values in `dry-run` logs. Use `dry-run: true` for safe debugging.

## Development

- Source lives in `src/index.ts`; compiled output is `dist/index.js`.
- Build locally with Node.js LTS: `npm ci && npm run build`.
- Commit the generated `dist/` when publishing a release tag (GitHub Actions runners fetch the compiled file).

## Notes

- The action runs on the latest Node.js LTS on GitHub Actions and uses native `fetch`.
- Non-2xx responses or timeouts cause the step to fail and mark the job red.
- If you’re unsure of the expected path for your Gatus version, consult your Gatus docs and adjust `endpoint-path`/`endpoint-suffix` accordingly.

## Releasing

- dist is bundled with `@vercel/ncc` into a single `dist/index.js`.
- On pushes to the default branch that touch source, CI builds and commits `dist/`.
- Tag a release like `v1.0.0` to publish; the Release workflow verifies `dist` and creates a GitHub Release.
- After a release is published, a workflow automatically moves the floating tags for the major and minor series (e.g., `v1` and `v1.2`) to the new release commit.
