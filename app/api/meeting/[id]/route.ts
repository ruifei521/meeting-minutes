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
    const data = await redis.get(`meeting:${id}`) as string | null;

    if (!data) {
      return NextResponse.json({ error: 'Meeting not found or expired' }, { status: 404 });
    }

    const meeting: MeetingData = JSON.parse(data);

    return NextResponse.json(meeting);

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}