import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';

function cleanPathname(name: string): string {
  return name.replace(/[\uFEFF\u200B\u00A0]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'audio';
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // 限制文件大小 50MB
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Max 50MB.' }, { status: 400 });
    }

    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 用干净的文件名上传
    const ext = file.name.split('.').pop() || 'mp3';
    const cleanName = `meeting-audio-${Date.now()}.${ext}`;

    const blob = await put(cleanName, buffer, {
      access: 'public',
      contentType: file.type || 'audio/mpeg',
    });

    return NextResponse.json({ url: blob.url });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
