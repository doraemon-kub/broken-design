// Loaded first by cdn.test.ts — must run before config/env.ts reads process.env (dotenv never overrides these).
import os from "os";
import path from "path";
import fs from "fs";

export const TEST_STORAGE_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "cdn-test-"),
);

process.env.STORAGE_PROVIDER = "local";
process.env.STORAGE_DIR = TEST_STORAGE_DIR;
process.env.JWT_SECRET = "cdn-test-secret";
process.env.CDN_KEY_FAILURES_PER_15MIN = "10000";
process.env.CDN_DOWNLOADS_PER_MIN = "10000";
process.env.CDN_RATE_LIMIT_PER_MIN = "10000";
