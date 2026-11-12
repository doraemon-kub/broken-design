import dotenv from 'dotenv';
dotenv.config();

export const env = {
  port: Number(process.env.PORT) || 4001,
  // Number of reverse proxies in front of the app (Render = 1). Needed so rate limits see the real client IP.
  trustProxy: Number(process.env.TRUST_PROXY) || 0,
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  watermarkSecret: process.env.WATERMARK_SECRET || 'lixyte-broken-design-watermark-secret-2026',
  storageProvider: (process.env.STORAGE_PROVIDER || 'local') as 'local' | 'supabase',
  storageDir: process.env.STORAGE_DIR || './storage_data',
  tmpUploadDir: process.env.TMP_UPLOAD_DIR || './tmp_uploads',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_KEY || '',
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'models',
  maxModelSizeBytes: Number(process.env.MAX_MODEL_SIZE_BYTES) || 52428800,
  maxPreviewSizeBytes: Number(process.env.MAX_PREVIEW_SIZE_BYTES) || 5242880,
  maxPosterSizeBytes: Number(process.env.MAX_POSTER_SIZE_BYTES) || 1048576,
};
