import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const prover = searchParams.get('prover');
    const contract = searchParams.get('contract');
    if (!prover || !contract) return new Response('Missing params', { status: 400 });

    const result = await sql.query(
      `SELECT last_epoch, cumulative_rewards FROM prover_progress WHERE prover_address=$1 AND contract_address=$2`,
      [prover, contract]
    );
    const row = result[0] || {};
    const lastEpoch = row.last_epoch ?? null;
    const cumulativeRewards = row.cumulative_rewards ?? "0";
    return Response.json({ lastEpoch, cumulativeRewards });
  } catch (e: any) {
    console.error('API GET /api/progress error:', e?.message || e);
    return new Response('Internal Server Error', { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { prover, contract, lastEpoch, cumulativeRewards } = await req.json();
    if (!prover || !contract || lastEpoch == null || cumulativeRewards == null) 
      return new Response('Missing body params', { status: 400 });

    await sql.query(
      `INSERT INTO prover_progress (prover_address, contract_address, last_epoch, cumulative_rewards)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (prover_address, contract_address)
        DO UPDATE SET last_epoch=EXCLUDED.last_epoch, cumulative_rewards=EXCLUDED.cumulative_rewards, updated_at=now()`,
      [prover, contract, lastEpoch, cumulativeRewards]
    );
    return Response.json({ ok: true });
  } catch (e: any) {
    console.error('API POST /api/progress error:', e?.message || e);
    return new Response('Internal Server Error', { status: 500 });
  }
}

