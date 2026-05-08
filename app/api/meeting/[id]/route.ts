import { NextResponse } from 'next/server';
import { getRedis, MeetingData } from '@/lib/redis';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Missing meeting ID' }, { status: 400 });
    }

    const redis = getRedis();
    const raw = await redis.get(`meeting:${id}`);

    if (!raw) {
      return NextResponse.json({ error: 'Meeting not found or expired' }, { status: 404 });
    }

    // Upstash Redis 可能自动解析 JSON，需兼容字符串和对象两种情况
    const meeting: MeetingData = typeof raw === 'string' ? JSON.parse(raw) : raw;

    return NextResponse.json(meeting);

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
