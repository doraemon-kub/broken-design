"use client";

// 3D Model Preview wired to the CDN (/cdn/models/:id/preview.glb & /file.glb?key=)
import { useEffect, useRef, useState } from "react";
import { Box, KeyRound, RotateCw } from "lucide-react";
import { CDN_SERVICE_URL } from "@/lib/api";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ModelPreview({
  id,
  title,
  paid,
  posterUrl,
}: {
  id: string;
  title: string;
  paid: boolean;
  posterUrl?: string;
}) {
  const isRealModel = UUID_RE.test(id);
  const [viewerReady, setViewerReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(!isRealModel);
  const [autoRotate, setAutoRotate] = useState(true);
  const [embedKey, setEmbedKey] = useState("");
  const [appliedKey, setAppliedKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const viewerRef = useRef<HTMLElement | null>(null);

  const baseCdn = `${CDN_SERVICE_URL}/cdn/models/${encodeURIComponent(id)}`;
  const previewSrc = `${baseCdn}/preview.glb`;
  const fullSrc = `${baseCdn}/file.glb?key=${encodeURIComponent(appliedKey)}`;
  const activeSrc = appliedKey ? fullSrc : previewSrc;
  const poster = posterUrl || `${baseCdn}/poster.webp`;

  useEffect(() => {
    if (!isRealModel) return;
    import("@google/model-viewer")
      .then(() => setViewerReady(true))
      .catch(() => setLoadFailed(true));
  }, [isRealModel]);

  useEffect(() => {
    const el = viewerRef.current;
    if (!el || !viewerReady) return;

    const onError = () => {
      if (appliedKey) {
        setKeyError(
          "Invalid or expired embed_key — switched back to public preview.",
        );
        setAppliedKey("");
      } else {
        setLoadFailed(true);
      }
    };

    const onLoad = () => {
      if (appliedKey) setKeyError(null);
    };

    el.addEventListener("error", onError);
    el.addEventListener("load", onLoad);
    return () => {
      el.removeEventListener("error", onError);
      el.removeEventListener("load", onLoad);
    };
  }, [viewerReady, appliedKey]);

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-white/10 bg-white/[0.06]">
        {isRealModel && viewerReady && !loadFailed ? (
          <>
            <model-viewer
              ref={viewerRef}
              src={activeSrc}
              poster={poster}
              alt={title}
              loading="eager"
              crossorigin="anonymous"
              camera-controls=""
              {...(autoRotate ? { "auto-rotate": "" } : {})}
              exposure="1"
              shadow-intensity="1"
              style={{
                width: "100%",
                height: "100%",
                backgroundColor: "transparent",
              }}
            />
            <div className=" absolute bottom-3 right-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAutoRotate((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] backdrop-blur transition-colors ${
                  autoRotate
                    ? "border-hud/50 bg-black/70 text-hud"
                    : "border-white/20 bg-black/70 text-white/70 hover:text-white"
                }`}
              >
                <RotateCw className="h-3.5 w-3.5" />
                {autoRotate ? "Auto-Rotate: ON" : "Auto-Rotate: OFF"}
              </button>
            </div>
          </>
        ) : (
          <div
            aria-hidden
            className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/40"
          >
            <Box className="h-8 w-8" />
            <span className="text-sm">3D preview</span>
          </div>
        )}
      </div>

      {paid && isRealModel && !loadFailed && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <KeyRound className="h-4 w-4 text-hud/80" />
            <input
              type="text"
              value={embedKey}
              onChange={(e) => setEmbedKey(e.target.value)}
              placeholder="Have an embed_key? Paste to stream full model…"
              className="min-w-0 flex-1 rounded border border-white/15 bg-black/60 px-2.5 py-1 font-mono text-xs text-white placeholder:text-white/40 focus:border-hud/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setKeyError(null);
                setAppliedKey(embedKey.trim());
              }}
              className="rounded border border-white/20 bg-white/10 px-3 py-1 font-mono text-xs text-white transition-colors hover:bg-white/20"
            >
              {appliedKey ? "Update Key" : "Stream Full"}
            </button>
          </div>
          {keyError && (
            <p className="mt-1.5 font-mono text-xs text-amber-400">
              {keyError}
            </p>
          )}
          {appliedKey && !keyError && (
            <p className="mt-1.5 font-mono text-xs text-hud">
              Streaming authenticated full model via /cdn/models/{id}/file.glb
            </p>
          )}
        </div>
      )}
    </div>
  );
}
