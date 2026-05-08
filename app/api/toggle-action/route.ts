import { NextResponse } from 'next/server';
import { getRedis, MeetingData } from '@/lib/redis';

export async function POST(request: Request) {
  try {
    const { meetingId, actionId } = await request.json();

    if (!meetingId || !actionId) {
      return NextResponse.json({ error: 'Missing meetingId or actionId' }, { status: 400 });
    }

    const redis = getRedis();

    const raw = await redis.get(`meeting:${meetingId}`);
    if (!raw) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    const meeting: MeetingData = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const actionIndex = meeting.actionItems.findIndex(a => a.id === actionId);
    if (actionIndex === -1) {
      return NextResponse.json({ error: 'Action item not found' }, { status: 404 });
    }

    meeting.actionItems[actionIndex].completed = !meeting.actionItems[actionIndex].completed;

    // 保持 30 天 TTL
    await redis.set(`meeting:${meetingId}`, JSON.stringify(meeting), { ex: 30 * 24 * 60 * 60 });

    return NextResponse.json({
      success: true,
      actionItems: meeting.actionItems,
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
