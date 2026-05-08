import { NextResponse } from 'next/server';
import { getRedis, MeetingData } from '@/lib/redis';

export async function POST(request: Request) {
  try {
    const { meetingId, actionId } = await request.json();

    if (!meetingId || !actionId) {
      return NextResponse.json({ error: 'Missing meetingId or actionId' }, { status: 400 });
    }

    const redis = getRedis();

    // Get current data
    const data = await redis.get(`meeting:${meetingId}`) as string | null;
    if (!data) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    const meeting: MeetingData = JSON.parse(data);

    // Toggle the action item
    const actionIndex = meeting.actionItems.findIndex(a => a.id === actionId);
    if (actionIndex === -1) {
      return NextResponse.json({ error: 'Action item not found' }, { status: 404 });
    }

    meeting.actionItems[actionIndex].completed = !meeting.actionItems[actionIndex].completed;

    // Save back to Redis
    await redis.set(`meeting:${meetingId}`, JSON.stringify(meeting));

    return NextResponse.json({
      success: true,
      actionItems: meeting.actionItems,
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}