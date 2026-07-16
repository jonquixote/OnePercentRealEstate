import { NextRequest, NextResponse } from 'next/server';
import { fetchValuationRow, computeValuation, type Valuation } from '@/lib/valuation';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export function shapeResponse(v: Valuation, isPro: boolean) {
  const base = {
    intrinsic: Math.round(v.intrinsic),
    marginOfSafety: v.marginOfSafety,
    headline:
      v.marginOfSafety >= 0
        ? `${(v.marginOfSafety * 100).toFixed(0)}% below intrinsic value`
        : `${(Math.abs(v.marginOfSafety) * 100).toFixed(0)}% above intrinsic value`,
  };
  if (!isPro) return base;
  return { ...base, ownerReturn: v.ownerReturn, inputs: v.inputs };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  try {
    const row = await fetchValuationRow(id);
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const isPro = (await getSessionUser())?.tier === 'pro';
    return NextResponse.json(shapeResponse(computeValuation(row), isPro));
  } catch (err) {
    console.error('/api/valuation error:', err);
    return NextResponse.json({ error: 'valuation failed' }, { status: 500 });
  }
}
