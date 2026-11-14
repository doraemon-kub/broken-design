'use client';

// User Dashboard — profile overview, seller toggle, purchased models, embed keys & GLB downloads
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  Code2,
  Copy,
  Download,
  KeyRound,
  Layers,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Store,
  User as UserIcon,
} from 'lucide-react';
import {
  CDN_SERVICE_URL,
  enableSellerMode,
  fetchMyPurchases,
  fetchSellerStatus,
  regenerateEmbedKey,
} from '@/lib/api';
import { creatorHandle, initials } from '@/lib/creators';
import { formatPrice } from '@/lib/format';
import type { AuthUser, PurchaseItem } from '@/lib/types';

const CARD = 'rounded-lg border border-white/10 bg-white/5 p-5 sm:p-6';
const LABEL = 'font-mono text-[11px] uppercase tracking-[0.16em] text-hud/70';

export default function MePage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [purchases, setPurchases] = useState<PurchaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // 1. Load user & token from storage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (storedToken) {
      setToken(storedToken);
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser));
        } catch {
          // fallback if invalid json
        }
      }
    }
    setLoading(false);
  }, []);

  // 2. Fetch purchases and seller status
  useEffect(() => {
    if (!token) return;

    let mounted = true;
    (async () => {
      try {
        const [purchaseList, isSeller] = await Promise.all([
          fetchMyPurchases(token).catch(() => []),
          fetchSellerStatus(token).catch(() => false),
        ]);

        if (mounted) {
          setPurchases(purchaseList);
          setUser((prev) => {
            const next = prev ? { ...prev, is_seller: isSeller } : prev;
            if (next) localStorage.setItem('user', JSON.stringify(next));
            return next;
          });
        }
      } catch (err: any) {
        if (mounted) setStatusMsg(err?.message || 'Could not load your purchases.');
      }
    })();

    return () => {
      mounted = false;
    };
  }, [token]);

  // Handle Enable Seller Mode
  const handleEnableSeller = async () => {
    if (!token) return;
    try {
      setBusyAction('enable-seller');
      setStatusMsg(null);
      await enableSellerMode(token);
      setUser((prev) => {
        const updated = prev ? { ...prev, is_seller: true } : prev;
        if (updated) localStorage.setItem('user', JSON.stringify(updated));
        return updated;
      });
      setStatusMsg('Seller mode activated! You can now upload models and view your sales.');
    } catch (err: any) {
      setStatusMsg(err?.message || 'Failed to enable seller mode.');
    } finally {
      setBusyAction(null);
    }
  };

  // Handle Regenerate Embed Key
  const handleRegenerateKey = async (purchaseId: string) => {
    if (!token) return;
    if (!window.confirm('Are you sure you want to regenerate this key? Your previous embed_key will immediately stop streaming.')) {
      return;
    }

    try {
      setBusyAction(`regen-${purchaseId}`);
      setStatusMsg(null);
      const res = await regenerateEmbedKey(purchaseId, token);
      setPurchases((prev) =>
        prev.map((p) => (p.id === purchaseId ? { ...p, embedKey: res.embedKey } : p)),
      );
      setStatusMsg('Embed key regenerated successfully.');
    } catch (err: any) {
      setStatusMsg(err?.message || 'Could not regenerate key.');
    } finally {
      setBusyAction(null);
    }
  };

  // Handle Download GLB with Watermark
  const handleDownload = async (modelId: string, title: string) => {
    try {
      setBusyAction(`dl-${modelId}`);
      setStatusMsg(null);
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${CDN_SERVICE_URL}/cdn/models/${encodeURIComponent(modelId)}/download`, {
        headers,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message || `Download failed (${res.status})`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = title.replace(/[^\w\u0E00-\u0E7F-]+/g, '_').replace(/^_+|_+$/g, '') || 'model';
      a.download = `${safeName}.glb`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatusMsg(`Downloading ${title}.glb (watermarked for your account)`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Download failed.');
    } finally {
      setBusyAction(null);
    }
  };

  // Copy helper
  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-[1200px] px-4 pb-16 pt-24 md:px-6">
        <p className="font-mono text-sm text-white/50">Loading profile…</p>
      </main>
    );
  }

  // Not logged in view
  if (!token) {
    return (
      <main className="mx-auto max-w-[800px] px-4 pb-16 pt-28 md:px-6">
        <div className={`${CARD} text-center`}>
          <p className={LABEL}>[ Account Required ]</p>
          <h1 className="mt-4 font-display text-2xl uppercase tracking-wide text-white">Sign In to View Your Profile</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-white/65">
            Log in to manage your purchased 3D models, access your streaming embed keys, or switch to Creator mode.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-4">
            <Link
              href="/login"
              className="h-10 rounded-lg bg-white px-5 text-sm font-medium leading-10 text-black transition-colors hover:bg-white/85"
            >
              Log in to Lixyte
            </Link>
            <Link
              href="/gallery"
              className="h-10 rounded-lg border border-white/20 px-5 text-sm font-mono uppercase tracking-wider leading-10 text-white/80 transition-colors hover:bg-white/10"
            >
              Browse Gallery
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const displayName = user?.display_name || user?.email?.split('@')[0] || 'User';
  const handle = creatorHandle(displayName);

  return (
    <main className="mx-auto max-w-[1200px] px-4 pb-16 pt-24 md:px-6">
      {/* Toast / Notification */}
      {statusMsg && (
        <div className="mb-6 flex items-center justify-between rounded-lg border border-hud/30 bg-hud/10 px-4 py-3 text-sm text-hud">
          <span>{statusMsg}</span>
          <button
            type="button"
            onClick={() => setStatusMsg(null)}
            className="ml-4 font-mono text-xs opacity-70 hover:opacity-100"
          >
            [Close]
          </button>
        </div>
      )}

      {/* Profile Header */}
      <div className={`${CARD} flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between`}>
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-full border border-hud/40 bg-hud/10 font-mono text-xl font-bold text-hud">
            {initials(displayName)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl uppercase text-white">{displayName}</h1>
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                  user?.is_seller
                    ? 'border-hud/40 bg-hud/15 text-hud'
                    : 'border-white/20 bg-white/5 text-white/70'
                }`}
              >
                {user?.is_seller ? 'Creator' : 'Buyer'}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-white/50">{user?.email}</p>
          </div>
        </div>

        {/* Action button based on Seller status */}
        <div className="flex flex-wrap gap-2">
          {user?.is_seller ? (
            <>
              <Link
                href="/seller"
                className="flex h-9 items-center gap-2 rounded-lg border border-hud/30 bg-hud/10 px-3.5 text-xs font-mono uppercase tracking-wider text-hud transition-colors hover:bg-hud/20"
              >
                <Store className="h-4 w-4" />
                Seller Dashboard
              </Link>
              <Link
                href={`/creators/${handle}`}
                className="flex h-9 items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-3.5 text-xs font-mono uppercase tracking-wider text-white/80 transition-colors hover:bg-white/10"
              >
                <UserIcon className="h-4 w-4" />
                Public Profile
              </Link>
              <Link
                href="/upload"
                className="flex h-9 items-center gap-2 rounded-lg bg-white px-3.5 text-xs font-mono uppercase tracking-wider text-black transition-colors hover:bg-white/85"
              >
                <Layers className="h-4 w-4" />
                Upload .glb
              </Link>
            </>
          ) : (
            <button
              type="button"
              disabled={busyAction === 'enable-seller'}
              onClick={handleEnableSeller}
              className="flex h-9 items-center gap-2 rounded-lg bg-white px-4 text-xs font-mono uppercase tracking-wider text-black transition-colors hover:bg-white/85 disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />
              {busyAction === 'enable-seller' ? 'Activating…' : 'Become a Creator'}
            </button>
          )}
        </div>
      </div>

      {/* Become a Creator Banner (if not seller) */}
      {!user?.is_seller && (
        <div className="mt-6 rounded-lg border border-hud/30 bg-gradient-to-r from-hud/10 via-transparent to-transparent p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className={LABEL}>[ Creator Opportunity ]</p>
              <h2 className="mt-1 font-display text-lg uppercase text-white">Sell your 3D assets on Lixyte</h2>
              <p className="mt-1 text-sm text-white/65">
                Enable creator mode on this account to upload .glb files, set pricing or offer free downloads, and track analytics.
              </p>
            </div>
            <button
              type="button"
              disabled={busyAction === 'enable-seller'}
              onClick={handleEnableSeller}
              className="whitespace-nowrap rounded-lg bg-hud px-4 py-2 font-mono text-xs uppercase tracking-wider text-black font-semibold transition-colors hover:bg-hud/85 disabled:opacity-60"
            >
              Enable Seller Mode
            </button>
          </div>
        </div>
      )}

      {/* Purchases Section */}
      <section className="mt-10">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="font-display text-lg uppercase text-white">
            Purchased Models & Embed Keys
            <span className="ml-2 font-mono text-xs text-white/50">({purchases.length})</span>
          </h2>
          <Link
            href="/gallery"
            className="font-mono text-xs text-hud transition-colors hover:underline"
          >
            Explore Gallery →
          </Link>
        </div>

        {purchases.length === 0 ? (
          <div className={`${CARD} mt-6 text-center py-12`}>
            <KeyRound className="mx-auto h-8 w-8 text-white/30" />
            <h3 className="mt-3 font-display text-base uppercase text-white">No purchases yet</h3>
            <p className="mt-1 text-sm text-white/50">
              When you purchase 3D models, your unique streaming embed_key and downloads will appear here.
            </p>
            <Link
              href="/gallery"
              className="mt-5 inline-block rounded-lg bg-white px-4 py-2 text-xs font-mono uppercase tracking-wider text-black transition-colors hover:bg-white/85"
            >
              Browse 3D Models
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid gap-6">
            {purchases.map((item) => {
              const vmSnippet = `<vm-model model-id="${item.modelId}" cdn-base="${CDN_SERVICE_URL}" key="${item.embedKey}" auto-rotate camera-controls></vm-model>`;
              const iframeSnippet = `<iframe src="http://localhost:3000/embed/${item.modelId}?key=${item.embedKey}" width="600" height="400" allow="fullscreen" style="border:0"></iframe>`;

              return (
                <div key={item.id} className={`${CARD} space-y-4`}>
                  {/* Top Bar: Title, License, Price, Actions */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/models/${item.modelId}`}
                          className="font-display text-lg uppercase text-white transition-colors hover:text-hud"
                        >
                          {item.title}
                        </Link>
                        <span className="rounded border border-white/20 px-1.5 py-0.5 font-mono text-[10px] uppercase text-white/65">
                          {item.licenseType}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-xs text-white/40">
                        Purchased for {formatPrice(item.amountCents || item.priceCents)} · ID: {item.modelId}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busyAction === `dl-${item.modelId}`}
                        onClick={() => handleDownload(item.modelId, item.title)}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 font-mono text-xs uppercase tracking-wider text-white transition-colors hover:bg-white/10 disabled:opacity-60"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download .glb
                      </button>
                    </div>
                  </div>

                  {/* Embed Key Box */}
                  <div className="rounded-lg border border-white/10 bg-black/60 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <KeyRound className="h-4 w-4 text-hud" />
                        <span className="font-mono text-xs uppercase tracking-wider text-white/80">
                          Your Embed Key:
                        </span>
                        <code className="rounded bg-white/10 px-2 py-0.5 font-mono text-xs text-hud">
                          {item.embedKey}
                        </code>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => copyText(item.embedKey, `key-${item.id}`)}
                          className="flex h-7 items-center gap-1 rounded border border-white/15 px-2 font-mono text-[11px] text-white/70 hover:text-white"
                        >
                          {copiedKey === `key-${item.id}` ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-400" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" /> Copy Key
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          disabled={busyAction === `regen-${item.id}`}
                          onClick={() => handleRegenerateKey(item.id)}
                          className="flex h-7 items-center gap-1 rounded border border-red-500/30 px-2 font-mono text-[11px] text-red-400/80 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                          title="Generate a new embed_key. Invalids the previous key immediately."
                        >
                          <RefreshCw className={`h-3 w-3 ${busyAction === `regen-${item.id}` ? 'animate-spin' : ''}`} />
                          Regenerate Key
                        </button>
                      </div>
                    </div>

                    {/* Code Snippets for web developers */}
                    <div className="mt-3 pt-3 border-t border-white/5 flex flex-col gap-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] text-white/50 flex items-center gap-1">
                          <Code2 className="h-3.5 w-3.5" /> Web Component Snippet:
                        </span>
                        <button
                          type="button"
                          onClick={() => copyText(vmSnippet, `vm-${item.id}`)}
                          className="font-mono text-[11px] text-hud/80 hover:text-hud"
                        >
                          {copiedKey === `vm-${item.id}` ? '✓ Copied Code' : 'Copy <vm-model>'}
                        </button>
                      </div>
                      <pre className="overflow-x-auto rounded bg-black/40 p-2 font-mono text-[11px] text-white/70">
                        {vmSnippet}
                      </pre>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
