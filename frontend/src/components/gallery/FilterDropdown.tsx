'use client';

// Dropdown button for one gallery filter — updates the URL query parameter when an option is selected.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown } from 'lucide-react';
import { buildHref } from '@/lib/pagination';
import type { License, ModelsParams } from '@/lib/types';

export default function FilterDropdown({
  label,
  paramKey,
  options,
  params = {},
}: {
  label: string;
  paramKey: 'tag' | 'license' | 'price';
  options: readonly string[];
  params?: ModelsParams;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const currentParam = params[paramKey];
  const value =
    options.find((o) => o.toLowerCase() === currentParam?.toLowerCase()) ?? options[0];
  const chosen = value !== options[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selectOption = (o: string) => {
    setOpen(false);
    const isAll = o === options[0];
    const next: ModelsParams = { ...params, page: 1 };
    if (paramKey === 'tag') {
      next.tag = isAll ? undefined : o.toLowerCase();
    } else if (paramKey === 'license') {
      next.license = isAll ? undefined : (o.toUpperCase() as License);
    } else if (paramKey === 'price') {
      next.price = isAll ? undefined : (o.toLowerCase() as 'free' | 'paid');
    }
    router.push(buildHref(next));
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors ${
          chosen ? 'border-white text-white' : 'border-white/15 text-white/65 hover:border-white/30 hover:text-white'
        } bg-white/5`}
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-hud/70">{label}</span>
        <span>{value}</span>
        <ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          aria-label={label}
          className="absolute right-0 top-full z-20 mt-2 max-h-72 min-w-[160px] overflow-auto rounded-lg border border-white/15 bg-black/95 p-1 backdrop-blur"
        >
          {options.map((o) => (
            <li key={o}>
              <button
                type="button"
                aria-pressed={o === value}
                onClick={() => selectOption(o)}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-sm transition-colors hover:bg-white/10 ${
                  o === value ? 'text-white' : 'text-white/65 hover:text-white'
                }`}
              >
                {o}
                {o === value && <Check aria-hidden className="h-4 w-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
