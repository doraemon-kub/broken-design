import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { uploadRouter } from "./modules/upload/upload.routes";
import { cdnRouter, verifyWatermarkMiddleware, verifyWatermarkHandler } from "./modules/cdn/cdn.routes";
import { errorHandler } from "./middlewares/error.middleware";
import { testDbConnection } from "./config/db";

const app = express();

app.set("trust proxy", env.trustProxy);
app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/health", async (_req, res) => {
  const dbStatus = await testDbConnection();
  res.json({
    service: "broken-design-cdn-service",
    status: "ok",
    database: dbStatus,
  });
});

app.use("/api", uploadRouter);
app.use("/cdn", cdnRouter);
app.post("/verify-watermark", verifyWatermarkMiddleware, verifyWatermarkHandler);
app.post("/api/verify-watermark", verifyWatermarkMiddleware, verifyWatermarkHandler);

app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`[Lixyte CDN-Service] running on http://localhost:${env.port}`);
});
