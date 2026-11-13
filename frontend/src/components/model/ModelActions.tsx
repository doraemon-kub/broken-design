"use client";

//  Model download & checkout actions connected to CDN (/cdn/models/:id/download) & Core API
import { useState } from "react";
import { CDN_SERVICE_URL, CORE_API_URL } from "@/lib/api";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ModelActions({
  modelId,
  title = "model",
  free,
  priceLabel,
}: {
  modelId?: string;
  title?: string;
  free: boolean;
  priceLabel: string;
}) {
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [embedKey, setEmbedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isRealModel = Boolean(modelId && UUID_RE.test(modelId));

  const handleDownload = async () => {
    if (!isRealModel || !modelId) {
      setStatusMsg(
        "This is a sample catalogue item — upload or open a real model to download its .glb file.",
      );
      return;
    }

    try {
      setBusy(true);
      setStatusMsg(null);
      const token =
        typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(
        `${CDN_SERVICE_URL}/cdn/models/${encodeURIComponent(modelId)}/download`,
        {
          headers,
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error?.message || `Download failed (${res.status})`,
        );
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName =
        title.replace(/[^\w\u0E00-\u0E7F-]+/g, "_").replace(/^_+|_+$/g, "") ||
        "model";
      a.download = `${safeName}.glb`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatusMsg("Download started (.glb)");
    } catch (err: any) {
      setStatusMsg(err?.message || "Unable to download model from CDN.");
    } finally {
      setBusy(false);
    }
  };

  const handleBuy = async () => {
    if (!isRealModel || !modelId) {
      setStatusMsg("Checkout is available for uploaded models.");
      return;
    }

    const token =
      typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) {
      setStatusMsg(
        "Please sign in first to purchase or download this paid model.",
      );
      return;
    }

    try {
      setBusy(true);
      setStatusMsg(null);
      const checkoutRes = await fetch(
        `${CORE_API_URL}/api/models/${encodeURIComponent(modelId)}/checkout`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const checkoutData = await checkoutRes.json().catch(() => null);
      if (
        !checkoutRes.ok &&
        checkoutData?.error?.code !== "ALREADY_PURCHASED"
      ) {
        throw new Error(
          checkoutData?.error?.message ||
            `Checkout failed (${checkoutRes.status})`,
        );
      }

      const payRes = await fetch(
        `${CORE_API_URL}/api/models/${encodeURIComponent(modelId)}/pay-mock`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const payData = await payRes.json().catch(() => null);
      if (payRes.ok && payData?.embedKey) {
        setEmbedKey(payData.embedKey);
        setStatusMsg("Purchase completed! Your embed_key is ready below.");
        return;
      }

      // If already purchased, trigger download directly
      await handleDownload();
    } catch (err: any) {
      setStatusMsg(err?.message || "Checkout could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={free ? handleDownload : handleBuy}
        className="h-10 w-full rounded-lg bg-white px-3.5 text-[15px] font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-60"
      >
        {busy
          ? "Processing…"
          : free
            ? "Get this model (.glb)"
            : `Buy for ${priceLabel}`}
      </button>

      {!free && isRealModel && (
        <button
          type="button"
          disabled={busy}
          onClick={handleDownload}
          className="h-9 w-full rounded-lg border border-white/20 bg-white/5 px-3 text-xs font-mono uppercase tracking-wider text-white/80 transition-colors hover:bg-white/10 disabled:opacity-60"
        >
          Already bought? Download .glb
        </button>
      )}

      {embedKey && (
        <div className="rounded border border-hud/40 bg-black/70 p-2.5 font-mono text-xs text-hud">
          <div className="text-[10px] uppercase tracking-wider text-white/60">
            Your embed_key
          </div>
          <div className="mt-1 break-all select-all">{embedKey}</div>
        </div>
      )}

      {statusMsg && (
        <p role="status" className="text-sm text-amber">
          {statusMsg}
        </p>
      )}
    </div>
  );
}
