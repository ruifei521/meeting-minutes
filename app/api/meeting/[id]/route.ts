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

    // 兼容 Upstash Redis 可能已自动解析的情况
    let meeting: MeetingData;
    try {
      meeting = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (parseErr) {
      // 数据已损坏（如旧代码写入的 "[object Object]"），提示用户重新上传
      return NextResponse.json(
        { error: 'Meeting data corrupted, please re-upload the audio file' },
        { status: 500 }
      );
    }

    return NextResponse.json(meeting);

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
