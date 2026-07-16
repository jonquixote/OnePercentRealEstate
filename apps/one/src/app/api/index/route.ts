import { NextResponse } from 'next/server';
import { getRankedSnapshots } from '@/lib/index-data';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { month, rows } = await getRankedSnapshots();
    return NextResponse.json({ month, rows });
  } catch (err) {
    console.error('/api/index error:', err);
    return NextResponse.json({ error: 'Failed to fetch index data' }, { status: 500 });
  }
}
