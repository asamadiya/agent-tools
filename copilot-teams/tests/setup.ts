// Test setup, applied to every test file via vitest.config.ts.
//
// CRITICAL: clear TMUX_PANE before any test runs. Otherwise vitest inherits
// the env var from whatever pane spawned `npm test` and the integration tests'
// `handleAgent` will treat that pane as the parent and split it horizontally
// — turning a test run into a destructive layout change in the developer's
// own workspace. Tests that need to exercise the split-pane path set
// TMUX_PANE explicitly to a pane they created themselves.
delete process.env.TMUX_PANE;
