function intEnv(name, fallback, min, max) {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const config = {
  port: intEnv('PORT', 43124, 0, 65535),
  host: process.env.HOST || '0.0.0.0',
  roundSeconds: intEnv('ROUND_SECONDS', 60, 2, 300),
  quizSeconds: intEnv('QUIZ_SECONDS', 10, 2, 60),
  quizQuestions: intEnv('QUIZ_QUESTIONS', 5, 1, 20),
  mixedQuizQuestions: intEnv('MIXED_QUIZ_QUESTIONS', 3, 1, 20),
  stageIntroMs: intEnv('STAGE_INTRO_MS', 2600, 0, 10000),
  quizSuspenseMs: intEnv('QUIZ_SUSPENSE_MS', 550, 0, 5000),
  quizRevealMs: intEnv('QUIZ_REVEAL_MS', 3000, 200, 10000),
  syncWindowMs: intEnv('SYNC_WINDOW_MS', 1600, 200, 5000),
  offlineThresholdMs: intEnv('OFFLINE_THRESHOLD_MS', 22000, 5000, 120000),
  pollTimeoutMs: intEnv('POLL_TIMEOUT_MS', 12000, 1000, 30000),
  throwCooldownMs: intEnv('THROW_COOLDOWN_MS', 280, 80, 2000),
  maxSplatsPerPlayer: intEnv('MAX_SPLATS', 60, 10, 200),
  roomTtlMs: 30 * 60 * 1000,
};
