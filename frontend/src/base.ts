// The app may be served from a secret path prefix. The prefix is injected into
// index.html when the container starts (docker-entrypoint.d/40-base-path.sh),
// so it never lives in this repository. Empty string = served from the root.
declare global {
  interface Window {
    __CHESS_BASE__?: string;
  }
}

export const BASE = window.__CHESS_BASE__ || '';
