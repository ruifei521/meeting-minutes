import { NextResponse } from 'next/server';
import { redis, MeetingData } from '@/lib/redis';

function cleanText(text: string): string {
  return text.replace(/[\uFEFF\u200B\u00A0]/g, '').trim();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
    }

    // 1. Fetch file from Vercel Blob
    const blobRes = await fetch(url);
    if (!blobRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch file from storage' }, { status: 500 });
    }

    const blobBuffer = await blobRes.arrayBuffer();
    const buffer = Buffer.from(blobBuffer);

    // Check file size (50MB max for Blob)
    const MAX_SIZE = 50 * 1024 * 1024;
    if (buffer.length > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large. Max 50MB allowed.' }, { status: 400 });
    }

    // Get filename from URL
    const filename = url.split('/').pop()?.split('?')[0] || 'audio.mp3';
    const mimeType = blobRes.headers.get('content-type') || 'audio/mpeg';

    // 2. Call 302AI Whisper for transcription
    const whisperFormData = new FormData();
    const fileBlob = new Blob([buffer], { type: mimeType });
    const safeFilename = filename.replace(/[\uFEFF\u200B\u00A0]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'audio.mp3';
    whisperFormData.append('file', fileBlob, safeFilename);
    whisperFormData.append('model', 'whisper-1');

    const whisperRes = await fetch('https://api.302.ai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: whisperFormData,
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      return NextResponse.json({ error: `Whisper error: ${errText}` }, { status: 500 });
    }

    const whisperData = await whisperRes.json();
    const rawTranscript = whisperData.text as string;
    const transcript = cleanText(rawTranscript);

    if (!transcript || transcript.trim().length < 10) {
      return NextResponse.json({ error: 'Transcription failed or audio was too short.' }, { status: 500 });
    }

    // 3. Call GPT for structured minutes + action items
    const prompt = `You are a professional meeting minute writer. Analyze the transcript below.

Return a JSON object with EXACTLY this structure (no markdown, no code blocks, just raw JSON):
{
  "summary": "A concise summary in 80-100 words",
  "decisions": ["Decision 1", "Decision 2"],
  "actionItems": [
    {"task": "Description of task", "owner": "Person name or Unassigned", "deadline": "Date or Not specified"}
  ]
}

Rules:
- Extract ALL action items, even implicit ones
- Be specific about what needs to be done
- Include the person responsible if mentioned
- summary should cover main topics and meeting purpose

---
Transcript:
${transcript}`;

    const gptRes = await fetch('https://api.302.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
    });

    if (!gptRes.ok) {
      const errText = await gptRes.text();
      return NextResponse.json({ error: `GPT error: ${errText}` }, { status: 500 });
    }

    const gptData = await gptRes.json();
    const rawContent = gptData.choices[0].message.content;

    // Parse GPT response
    let parsed: any;
    try {
      const cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({
        transcript,
        result: rawContent,
        filename: safeFilename,
        shareUrl: null,
      });
    }

    // 4. Generate unique ID and store in Redis
    const id = crypto.randomUUID().slice(0, 8);
    const meetingData: MeetingData = {
      id,
      summary: parsed.summary || '',
      decisions: parsed.decisions || [],
      actionItems: (parsed.actionItems || []).map((item: any, idx: number) => ({
        id: `action-${idx}`,
        task: item.task || '',
        owner: item.owner || 'Unassigned',
        completed: false,
      })),
      transcript,
      createdAt: Date.now(),
    };

    await redis.set(`meeting:${id}`, JSON.stringify(meetingData), { ex: 30 * 24 * 60 * 60 });

    const resultText = `## Summary\n${meetingData.summary}\n\n## Key Decisions\n${meetingData.decisions.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n\n## Action Items\n${meetingData.actionItems.map(a => `• ${a.task} | Owner: ${a.owner} | Status: ${a.completed ? '✅ Done' : '⏳ Pending'}`).join('\n')}`;

    return NextResponse.json({
      transcript,
      result: resultText,
      filename: safeFilename,
      shareId: id,
      actionItems: meetingData.actionItems,
      shareUrl: `/minutes/${id}`,
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
