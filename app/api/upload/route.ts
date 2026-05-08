import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

// 强制将文件名中的非ASCII字符替换为下划线，防止 BOM 等字符导致 SDK 报错
function cleanPathname(name: string): string {
  return name.replace(/[\uFEFF\u200B\u00A0]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'audio';
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const clean = cleanPathname(pathname);
        return {
          allowedContentTypes: ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm', 'audio/ogg'],
          maximumSizeInBytes: 50 * 1024 * 1024, // 50MB max
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
