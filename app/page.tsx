'use client';

import { useState, useRef } from 'react';

interface ActionItem {
  id: string;
  task: string;
  owner: string;
  completed: boolean;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [result, setResult] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setTranscript(null);
    setShareUrl(null);
    setActionItems([]);
    setUploadProgress('');

    try {
      // Step 1: 直接上传文件到我们的服务器，由服务器转发到 Vercel Blob
      setUploadProgress('Uploading file...');
      const formData = new FormData();
      formData.append('file', file);
      const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || 'Upload failed');
      const blobUrl = uploadData.url;

      setUploadProgress('Processing audio...');

      // Step 2: 调用转录 API
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: blobUrl }),
      });

      const rawText = await res.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        setError(`Server returned non-JSON (status ${res.status}): ${rawText.slice(0, 200)}`);
        return;
      }

      if (!res.ok) {
        setError(data?.error || `Server error (${res.status})`);
        return;
      }

      setResult(data.result);
      setTranscript(data.transcript);
      if (data.shareUrl) {
        setShareUrl(`https://meeting-minutes-mocha.vercel.app${data.shareUrl}`);
      }
      if (data.actionItems) {
        setActionItems(data.actionItems);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setUploadProgress('');
    }
  };

  const copyResult = () => {
    if (result) navigator.clipboard.writeText(result);
  };

  const copyShareLink = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const toggleAction = async (actionId: string) => {
    setActionItems(prev => prev.map(item =>
      item.id === actionId ? { ...item, completed: !item.completed } : item
    ));
    try {
      await fetch('/api/toggle-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId }),
      });
    } catch {}
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      <div className="max-w-3xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Meeting Minutes AI
          </h1>
          <p className="text-slate-400">Upload your meeting audio, get structured minutes + action items</p>
        </div>

        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
          }}
          className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
            dragOver ? 'border-blue-400 bg-blue-400/10' : 'border-slate-600 hover:border-slate-400'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
            className="hidden"
          />
          <div className="text-5xl mb-4">🎙️</div>
          <p className="text-slate-300 mb-2">Drop audio file here or click to upload</p>
          <p className="text-sm text-slate-500">MP3, WAV, M4A, WebM, OGG • Max 50MB</p>
        </div>

        {file && (
          <div className="mt-6 p-4 bg-slate-700/50 rounded-lg flex items-center justify-between">
            <div>
              <p className="font-medium">{file.name}</p>
              <p className="text-sm text-slate-400">{formatFileSize(file.size)}</p>
            </div>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-slate-600 rounded-lg font-medium transition-colors"
            >
              {loading ? (uploadProgress || 'Processing...') : 'Generate Minutes'}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300">
            ⚠️ {error}
          </div>
        )}

        {result && (
          <div className="mt-8 space-y-6">
            {shareUrl && (
              <div className="p-4 bg-green-900/30 border border-green-700 rounded-lg">
                <p className="text-green-300 text-sm mb-2">✅ Share link generated:</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={shareUrl}
                    readOnly
                    className="flex-1 bg-slate-800 px-3 py-2 rounded text-sm text-slate-300"
                  />
                  <button
                    onClick={copyShareLink}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium"
                  >
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            {actionItems.length > 0 && (
              <div className="p-4 bg-slate-700/50 rounded-lg">
                <h3 className="font-semibold mb-3 text-lg">📋 Action Items</h3>
                <div className="space-y-2">
                  {actionItems.map((item) => (
                    <label key={item.id} className="flex items-start gap-3 p-3 bg-slate-800/50 rounded cursor-pointer hover:bg-slate-800">
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={() => toggleAction(item.id)}
                        className="mt-1 w-4 h-4 rounded"
                      />
                      <div className={item.completed ? 'line-through text-slate-500' : ''}>
                        <p className="font-medium">{item.task}</p>
                        <p className="text-sm text-slate-400">Owner: {item.owner}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="p-6 bg-slate-700/50 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">📝 Meeting Minutes</h3>
                <button
                  onClick={copyResult}
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-500 rounded text-sm"
                >
                  Copy All
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-slate-300 text-sm font-mono">{result}</pre>
            </div>

            {transcript && (
              <details className="p-4 bg-slate-700/50 rounded-lg">
                <summary className="cursor-pointer font-medium text-slate-400 hover:text-slate-300">
                  📜 View Full Transcript
                </summary>
                <p className="mt-4 text-sm text-slate-400 whitespace-pre-wrap">{transcript}</p>
              </details>
            )}
          </div>
        )}

        <p className="text-center text-slate-500 text-sm mt-12">Powered by AI</p>
      </div>
    </div>
  );
}
