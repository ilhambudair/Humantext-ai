"use strict";
/* ============================================================
   [ARTIFACT-RUNTIME]  OPTIONAL, LEGACY — NOT LOADED BY DEFAULT
   ============================================================
   This is the exact integration the app used while it lived inside a Claude Artifact.
   It only works when the page is hosted by Claude Artifact, because `window.claude` is injected
   by that host: it is not a public API and it does not exist on your own domain.

   It is kept (not deleted) so the original behaviour stays documented and can be re-enabled:
     1. In index.html, uncomment the <script src="/js/runtime-artifact.js"> line.
     2. In js/config.js set useArtifactRuntime: true.
   On a normal website leave both alone; the frontend then uses /api/ai instead.

   Dependencies provided by the Artifact host in the original version:
     window.claude.use("sample")     -> text generation (streaming via onText, AbortSignal, modelTier)
     window.claude.use("downloads")  -> save-file dialog
   Errors from the host use codes such as not_granted, sampling_disabled, not_declared,
   capability_disabled, capability_removed, rate_limited, session_expired, refused,
   empty_completion, upstream_error, cancelled; ai.js still understands all of them.
*/
window.HT_ARTIFACT_RUNTIME = {
  async init() {
    let sample = null, downloads = null;
    if (window.claude && typeof window.claude.use === "function") {
      sample = await window.claude.use("sample").catch(() => null);
      downloads = await window.claude.use("downloads").catch(() => null);
    }
    return { sample, downloads };
  }
};
