# Repository instructions

- Read README.md and the applicable owner direction before working.
- `main` is the default branch. Use a focused task branch and the configured
  task-worktree helper; use the catalog bot commit/push helpers and a PR.
- Application source belongs here. Keep credentials, vehicle identity, location,
  personal recordings and host-specific deployment facts outside this repo.
- The initial receiver is receive-only. Do not reset the CAN interface or add
  vehicle commands as part of telemetry or replay work.
- Keep unavailable, invalid, stale and disconnected values distinct from zero.
- Use uv for Python tooling. Use local frontend assets with no CDN dependency.
- Keep the interface responsive on an Intel Atom browser. Test with recorded
  fixtures before requesting a physical vehicle test; batch physical checks.
- Treat the product as an instrument panel: no hero or marketing copy, and use
  plain labels rather than programming terms. Instrument configuration belongs
  behind an explicit Edit/Done mode, hidden during normal use.
- Experimental design entries are independent. Do not inspect another entry or
  include provider/model identities in their source before the owner compares them.
- Put generated screenshots, logs, reviews and other task evidence outside Git
  in the configured task-evidence directory.
