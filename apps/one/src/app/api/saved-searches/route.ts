import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * Wave 5 minimal saved searches endpoint.
 * Auth note: user_id is passed via header (x-user-id) or query param.
 * Once proper auth lands (Wave 8), this picks up real session_id.
 * DO NOT use in production without hardening against user_id injection.
 */

export async function GET(request: NextRequest) {
  try {
    // Wave 8: Replace with req.user.id or session.user_id
    const userId =
      request.headers.get('x-user-id') ||
      request.nextUrl.searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id required' },
        { status: 400 }
      );
    }

    const result = await pool.query(
      'SELECT id, user_id, name, params, created_at FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('GET /api/saved-searches error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch saved searches' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, name, params } = body;

    // Wave 8: Replace with req.user.id or session.user_id
    const userId =
      request.headers.get('x-user-id') || user_id;

    if (!userId || !name || !params) {
      return NextResponse.json(
        { error: 'user_id, name, and params required' },
        { status: 400 }
      );
    }

    const result = await pool.query(
      `INSERT INTO saved_searches (user_id, name, params)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, name) DO UPDATE
       SET params = $3
       RETURNING id, user_id, name, params, created_at`,
      [userId, name, JSON.stringify(params)]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error('POST /api/saved-searches error:', error);
    return NextResponse.json(
      { error: 'Failed to save search' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    const userId =
      request.headers.get('x-user-id') ||
      request.nextUrl.searchParams.get('user_id');

    if (!id || !userId) {
      return NextResponse.json(
        { error: 'id and user_id required' },
        { status: 400 }
      );
    }

    // Ensure user can only delete their own searches
    const result = await pool.query(
      'DELETE FROM saved_searches WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: 'Saved search not found or access denied' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/saved-searches error:', error);
    return NextResponse.json(
      { error: 'Failed to delete saved search' },
      { status: 500 }
    );
  }
}
