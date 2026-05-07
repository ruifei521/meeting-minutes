import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // 检查文件大小（限制25MB）
    const MAX_SIZE = 25 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large. Max 25MB allowed.' }, { status: 400 });
    }

    // 把文件转成 buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. 调用 302AI Whisper 转写
    const whisperFormData = new FormData();
    const blob = new Blob([buffer], { type: file.type });
    whisperFormData.append('file', blob, file.name);
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
    const transcript = whisperData.text;

    if (!transcript || transcript.trim().length < 10) {
      return NextResponse.json({ error: 'Transcription failed or audio was too short.' }, { status: 500 });
    }

    // 2. 调用 GPT 提取结构化纪要
    const prompt = `You are a professional meeting minute writer. Analyze the transcript below and output EXACTLY in this format:

## Summary
[A concise summary of the meeting in 80-100 words. Cover the main topics discussed and overall meeting purpose.]

## Key Decisions
[Numbered list of all decisions made. Be specific about what was decided and any commitments made.]

## Action Items
[For each action item, format as:
• Task: [description] | Owner: [person name or "Unassigned"] | Deadline: [date or "Not specified"] | Status: Pending]

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
    const result = gptData.choices[0].message.content;

    return NextResponse.json({
      transcript,
      result,
      filename: file.name,
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
