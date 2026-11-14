'use client';

// Seller Dashboard — sales summary, my models, soft delete, and links to public profile & upload
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  Coins,
  Download,
  Eye,
  Layers,
  Plus,
  RefreshCw,
  ShoppingBag,
  Store,
  Trash2,
  User,
} from 'lucide-react';
import {
  deleteModel,
  enableSellerMode,
  fetchSellerModels,
  fetchSellerSales,
  fetchSellerStatus,
} from '@/lib/api';
import { creatorHandle } from '@/lib/creators';
import { formatPrice } from '@/lib/format';
import type { AuthUser, SellerModelItem, SellerSalesSummary } from '@/lib/types';

const CARD = 'rounded-lg border border-white/10 bg-white/5 p-5 sm:p-6';
const LABEL = 'font-mono text-[11px] uppercase tracking-[0.16em] text-hud/70';

export default function SellerPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isSeller, setIsSeller] = useState<boolean | null>(null);
  const [models, setModels] = useState<SellerModelItem[]>([]);
  const [salesSummary, setSalesSummary] = useState<SellerSalesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // 1. Load user & token
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (storedToken) {
      setToken(storedToken);
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser));
        } catch {}
      }
    }
  }, []);

  // 2. Fetch seller status & data
  const loadData = async (authToken: string) => {
    try {
      setLoading(true);
      const sellerStatus = await fetchSellerStatus(authToken).catch(() => false);
      setIsSeller(sellerStatus);

      if (sellerStatus) {
        const [modelsList, sales] = await Promise.all([
          fetchSellerModels(authToken).catch(() => []),
          fetchSellerSales(authToken).catch(() => null),
        ]);
        setModels(modelsList);
        setSalesSummary(sales);
      }
    } catch (err: any) {
      setStatusMsg(err?.message || 'Could not load seller data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadData(token);
    } else {
      setLoading(false);
    }
  }, [token]);

  // Handle Enable Seller
  const handleEnableSeller = async () => {
    if (!token) return;
    try {
      setBusyAction('enable');
      await enableSellerMode(token);
      setIsSeller(true);
      setUser((prev) => {
        const next = prev ? { ...prev, is_seller: true } : prev;
        if (next) localStorage.setItem('user', JSON.stringify(next));
        return next;
      });
      setStatusMsg('Seller mode enabled! You can now manage your assets.');
      await loadData(token);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Failed to activate seller mode.');
    } finally {
      setBusyAction(null);
    }
  };

  // Handle Soft Delete Model
  const handleDeleteModel = async (modelId: string, title: string) => {
    if (!token) return;
    if (!window.confirm(`Are you sure you want to remove "${title}"? Existing paid buyers will retain access, but it will be hidden from the public gallery.`)) {
      return;
    }

    try {
      setBusyAction(`del-${modelId}`);
      await deleteModel(modelId, token);
      setModels((prev) => prev.map((m) => (m.id === modelId ? { ...m, isDeleted: true } : m)));
      setStatusMsg(`Model "${title}" has been retired (soft deleted).`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Could not delete model.');
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-[1200px] px-4 pb-16 pt-24 md:px-6">
        <p className="font-mono text-sm text-white/50">Loading seller dashboard…</p>
      </main>
    );
  }

  // Not logged in
  if (!token) {
    return (
      <main className="mx-auto max-w-[800px] px-4 pb-16 pt-28 md:px-6">
        <div className={`${CARD} text-center`}>
          <p className={LABEL}>[ Seller Access ]</p>
          <h1 className="mt-4 font-display text-2xl uppercase tracking-wide text-white">Sign In as Creator</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-white/65">
            You must be logged in to access the seller dashboard and monitor your 3D model sales.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-lg bg-white px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-white/85"
          >
            Log in to continue
          </Link>
        </div>
      </main>
    );
  }

  // Not a seller yet
  if (!isSeller) {
    return (
      <main className="mx-auto max-w-[800px] px-4 pb-16 pt-28 md:px-6">
        <div className={`${CARD} text-center`}>
          <Store className="mx-auto h-12 w-12 text-hud" />
          <p className={`${LABEL} mt-4`}>[ Seller Mode Inactive ]</p>
          <h1 className="mt-2 font-display text-2xl uppercase tracking-wide text-white">
            Activate Your Creator Store
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-white/65">
            Your account is currently in Buyer mode. Click below to activate Creator capabilities, upload 3D models, and earn revenue.
          </p>
          <button
            type="button"
            disabled={busyAction === 'enable'}
            onClick={handleEnableSeller}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-hud px-6 py-2.5 font-mono text-xs uppercase tracking-wider text-black font-semibold transition-colors hover:bg-hud/85 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            {busyAction === 'enable' ? 'Activating…' : 'Activate Seller Mode'}
          </button>
        </div>
      </main>
    );
  }

  const displayName = user?.display_name || 'Creator';
  const handle = creatorHandle(displayName);
  const activeModels = models.filter((m) => !m.isDeleted);

  return (
    <main className="mx-auto max-w-[1200px] px-4 pb-16 pt-24 md:px-6">
      {/* Toast Notification */}
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

      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl uppercase text-white">Creator Dashboard</h1>
            <span className="rounded border border-hud/40 bg-hud/15 px-2 py-0.5 font-mono text-[10px] uppercase text-hud">
              Seller Active
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-white/50">
            Welcome back, {displayName} · Handle: @{handle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/creators/${handle}`}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3.5 font-mono text-xs uppercase tracking-wider text-white transition-colors hover:bg-white/10"
          >
            <User className="h-4 w-4" />
            Public Profile
            <ArrowUpRight className="h-3.5 w-3.5 text-white/50" />
          </Link>
          <Link
            href="/upload"
            className="flex h-9 items-center gap-1.5 rounded-lg bg-white px-3.5 font-mono text-xs uppercase tracking-wider text-black transition-colors hover:bg-white/85"
          >
            <Plus className="h-4 w-4" />
            Upload New Model
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={CARD}>
          <div className="flex items-center justify-between text-white/50">
            <span className={LABEL}>[ Total Revenue ]</span>
            <Coins className="h-4 w-4 text-hud" />
          </div>
          <p className="mt-3 font-display text-2xl uppercase text-white">
            {formatPrice(salesSummary?.totalRevenue || 0)}
          </p>
          <p className="mt-1 font-mono text-[11px] text-white/40">Gross sales across all models</p>
        </div>

        <div className={CARD}>
          <div className="flex items-center justify-between text-white/50">
            <span className={LABEL}>[ Total Sales ]</span>
            <ShoppingBag className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-3 font-display text-2xl uppercase text-white">
            {salesSummary?.totalSales ?? 0} Orders
          </p>
          <p className="mt-1 font-mono text-[11px] text-white/40">Completed paid downloads</p>
        </div>

        <div className={CARD}>
          <div className="flex items-center justify-between text-white/50">
            <span className={LABEL}>[ Active Models ]</span>
            <Layers className="h-4 w-4 text-purple-400" />
          </div>
          <p className="mt-3 font-display text-2xl uppercase text-white">
            {activeModels.length} Models
          </p>
          <p className="mt-1 font-mono text-[11px] text-white/40">Published to Lixyte CDN</p>
        </div>
      </div>

      {/* Uploaded Models Table */}
      <section className="mt-10">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="font-display text-lg uppercase text-white">
            My 3D Models
            <span className="ml-2 font-mono text-xs text-white/50">({models.length})</span>
          </h2>
          <button
            type="button"
            onClick={() => token && loadData(token)}
            className="flex items-center gap-1 font-mono text-xs text-white/65 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {models.length === 0 ? (
          <div className={`${CARD} mt-6 text-center py-12`}>
            <Layers className="mx-auto h-8 w-8 text-white/30" />
            <h3 className="mt-3 font-display text-base uppercase text-white">No models published yet</h3>
            <p className="mt-1 text-sm text-white/50">
              Upload your first .glb asset to start showcasing and selling your 3D work.
            </p>
            <Link
              href="/upload"
              className="mt-5 inline-block rounded-lg bg-white px-4 py-2 text-xs font-mono uppercase tracking-wider text-black transition-colors hover:bg-white/85"
            >
              Upload a .glb Model
            </Link>
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 bg-white/5 font-mono text-[11px] uppercase tracking-wider text-white/50">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Views</th>
                  <th className="px-4 py-3">Downloads</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono text-xs">
                {models.map((m) => (
                  <tr key={m.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/models/${m.id}`}
                        className="font-medium text-white transition-colors hover:text-hud"
                      >
                        {m.title}
                      </Link>
                      <span className="block text-[11px] text-white/40">{m.id}</span>
                    </td>
                    <td className="px-4 py-3.5 text-white/80">
                      {m.priceCents === 0 ? 'Free' : formatPrice(m.priceCents)}
                    </td>
                    <td className="px-4 py-3.5 text-white/60">
                      <span className="flex items-center gap-1">
                        <Eye className="h-3.5 w-3.5" /> {m.viewCount ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-white/60">
                      <span className="flex items-center gap-1">
                        <Download className="h-3.5 w-3.5" /> {m.downloadCount ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {m.isDeleted ? (
                        <span className="rounded bg-red-500/10 px-2 py-0.5 text-red-400 border border-red-500/20">
                          Deleted
                        </span>
                      ) : m.isHidden ? (
                        <span className="rounded bg-amber-500/10 px-2 py-0.5 text-amber-400 border border-amber-500/20">
                          Hidden by Admin
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-emerald-400 border border-emerald-500/20">
                          Live
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/models/${m.id}`}
                          className="rounded border border-white/10 px-2 py-1 text-[11px] text-white/70 hover:text-white"
                        >
                          View
                        </Link>
                        {!m.isDeleted && (
                          <button
                            type="button"
                            disabled={busyAction === `del-${m.id}`}
                            onClick={() => handleDeleteModel(m.id, m.title)}
                            className="rounded border border-red-500/30 px-2 py-1 text-[11px] text-red-400/80 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                            title="Soft delete model"
                          >
                            <Trash2 className="h-3 w-3 inline" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent Sales History */}
      {salesSummary && salesSummary.sales && salesSummary.sales.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-lg uppercase text-white border-b border-white/10 pb-3">
            Recent Orders & Buyers
          </h2>
          <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-left text-sm font-mono text-xs">
              <thead className="border-b border-white/10 bg-white/5 text-[11px] uppercase tracking-wider text-white/50">
                <tr>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3">Buyer</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {salesSummary.sales.map((s) => (
                  <tr key={s.purchaseId} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-white">{s.title}</td>
                    <td className="px-4 py-3 text-white/70">{s.buyerName || 'Buyer'}</td>
                    <td className="px-4 py-3 text-emerald-400 font-medium">
                      +{formatPrice(s.priceCents)}
                    </td>
                    <td className="px-4 py-3 text-white/40">
                      {new Date(s.soldAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

