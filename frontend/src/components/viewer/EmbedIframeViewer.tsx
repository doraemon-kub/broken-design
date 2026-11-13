"use client";

// Iframe 3D Viewer — streams from CDN (/cdn/models/:id/file.glb?key= or /preview.glb)
// Automatically falls back to preview.glb with a non-crashing notice when embed_key is invalid/revoked.
import { useEffect, useRef, useState } from "react";
import { CDN_SERVICE_URL } from "@/lib/api";

export interface EmbedIframeViewerProps {
  id: string;
  embedKey?: string;
  autoRotate?: boolean;
  cameraControls?: boolean;
  background?: string;
  exposure?: string;
  shadowIntensity?: string;
}

export default function EmbedIframeViewer({
  id,
  embedKey = "",
  autoRotate = true,
  cameraControls = true,
  background = "#09090b",
  exposure = "1",
  shadowIntensity = "1",
}: EmbedIframeViewerProps) {
  const [ready, setReady] = useState(false);
  const [usingFallbackPreview, setUsingFallbackPreview] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const viewerRef = useRef<HTMLElement | null>(null);

  const cleanKey = embedKey.trim();
  const baseCdn = `${CDN_SERVICE_URL}/cdn/models/${encodeURIComponent(id)}`;
  const previewSrc = `${baseCdn}/preview.glb`;
  const fullSrc = `${baseCdn}/file.glb?key=${encodeURIComponent(cleanKey)}`;
  const posterSrc = `${baseCdn}/poster.webp`;

  const activeSrc = cleanKey && !usingFallbackPreview ? fullSrc : previewSrc;

  useEffect(() => {
    import("@google/model-viewer")
      .then(() => setReady(true))
      .catch(() => setUnavailable(true));
  }, []);

  useEffect(() => {
    const el = viewerRef.current;
    if (!el || !ready) return;

    const onError = () => {
      if (cleanKey && !usingFallbackPreview) {
        // Key is invalid/revoked — fall back to preview.glb without crashing
        setUsingFallbackPreview(true);
      } else {
        setUnavailable(true);
      }
    };

    el.addEventListener("error", onError);
    return () => el.removeEventListener("error", onError);
  }, [ready, cleanKey, usingFallbackPreview]);

  return (
    <div
      style={{ backgroundColor: background }}
      className="relative h-screen w-screen overflow-hidden select-none"
    >
      {ready && !unavailable ? (
        <model-viewer
          ref={viewerRef}
          src={activeSrc}
          poster={posterSrc}
          loading="lazy"
          crossorigin="anonymous"
          {...(autoRotate ? { "auto-rotate": "" } : {})}
          {...(cameraControls ? { "camera-controls": "" } : {})}
          exposure={exposure}
          shadow-intensity={shadowIntensity}
          style={{ width: "100%", height: "100%", backgroundColor: background }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-4 text-center font-mono text-xs text-white/60">
          {unavailable ? "3D model unavailable on CDN" : "Loading 3D viewer…"}
        </div>
      )}

      {usingFallbackPreview && !unavailable && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/20 bg-black/80 px-3 py-1.5 font-mono text-xs text-amber-400"
        >
          ต้องซื้อเพื่อใช้งาน · แสดงไฟล์ตัวอย่าง (Preview)
        </div>
      )}
    </div>
  );
}
