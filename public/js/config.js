/* Frontend configuration. Nothing secret belongs in this file: it is public.
   The Anthropic API key lives ONLY in server environment variables (see README). */
window.HT_CONFIG = {
  // Where the frontend sends AI requests. Point this at another backend if you host it elsewhere.
  aiEndpoint: "/api/ai",
  healthEndpoint: "/api/health",

  // [ARTIFACT-RUNTIME] Keep false for a standalone website.
  // Set true only when this page runs inside Claude Artifact AND js/runtime-artifact.js is loaded
  // (see the commented <script> tag in index.html). Details: README, "Ketergantungan Claude Artifact".
  useArtifactRuntime: false
};
