# SightPath — web app (v2)

SightPath in the browser: webcam calibration and pursuit testing, deployable to
Vercel. This is the measurement app described in
[`docs/v2-web.md`](../docs/v2-web.md) — it computes the same numbers as the
Python desktop app in `src/`, and it holds **no patient data**: no server-side
storage, no account, and nothing leaves the browser.

## Commands

| Command              | What it does                                    |
| -------------------- | ----------------------------------------------- |
| `npm run dev`        | Start the dev server on `http://localhost:3000` |
| `npm run build`      | Production build (Next.js)                      |
| `npm start`          | Serve the production build                      |
| `npm test`           | Run the Vitest suite once                       |
| `npm run typecheck`  | Type check with `tsc --noEmit`                  |
| `npm run test:watch` | Run the Vitest suite in watch mode              |

The camera needs a secure context: `http://localhost` is fine in development,
any other host needs https.

## Layout

```
web/
├── app/               # Next.js App Router routes
├── components/        # React components: camera, calibration, test
├── lib/               # The measurement logic — no React in here
│   ├── calibration.ts # Calibration flow and model fitting
│   ├── features.ts    # Polynomial features for the gaze model
│   ├── metrics.ts     # Pursuit metrics (parity with src/metrics.py)
│   ├── saccade.ts     # Saccade protocol (parity with src/saccade_test.py)
│   ├── fixation.ts    # Fixation stability, BCEA, microsaccades
│   ├── validation.ts  # Grid validation (parity with src/validation.py)
│   ├── trajectory.ts  # Trajectory, position over time, heatmap
│   ├── patterns.ts    # Target geometry and the calibration grid
│   ├── ridge.ts       # Ridge regression (parity with src/gaze_estimator.py)
│   └── types.ts       # Shared types
├── public/            # Served as-is by the app
│   ├── models/        # The face landmarker model
│   └── wasm/          # The MediaPipe wasm runtime
├── tests/             # Vitest suite
│   ├── fixtures/      # Expectations produced by the Python implementation
│   └── *.test.ts
├── next.config.ts     # Cross-origin isolation headers for the wasm build
└── package.json
```

## Parity fixtures

The files in `tests/fixtures/` were produced by the **Python** implementation in
`src/`: the generator runs the desktop code over a deterministic synthetic frame
set and writes out those frames together with the metrics it computed. The tests
here feed the same frames to this app's port and assert the same numbers — that
is what keeps the two versions measuring the same thing.

Regenerate them with the generator script, which lives at the repository root
(not in this app):

```bash
python tools/generate_parity_fixtures.py
python tools/generate_parity_saccade.py
python tools/generate_parity_fixation.py
python tools/generate_parity_validation.py
python tools/generate_parity_trajectory.py
```

It writes `web/tests/fixtures/*.json`. Run it whenever the Python metric
implementation changes, then run `npm test`: a mismatch between the two is the
signal that the versions have drifted apart.

## No server-side storage

The app has no server-side storage. Nothing is written to a database, an API or
a file: the camera, the calibration and the test all run in the page, and the
result is what the operator sees on screen. There is no account and no
environment variable to configure, which is also why it deploys to a static host
without a backend. The "What deliberately stays in v1" section of
[`docs/v2-web.md`](../docs/v2-web.md) explains why the clinical data stays in
the desktop app.
