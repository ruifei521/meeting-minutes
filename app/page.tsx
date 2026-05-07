'use client';

import { useState, useRef } from 'react';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setTranscript(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        return;
      }

      setResult(data.result);
      setTranscript(data.transcript);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyResult = () => {
    if (result) navigator.clipboard.writeText(result);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      <div className="max-w-3xl mx-auto px-4 py-16">

        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">
            🗒️ AI Meeting Minutes
          </h1>
          <p className="text-slate-400 text-lg">
            Upload your meeting audio. Get structured notes, decisions, and action items in seconds.
          </p>
        </div>

        {/* Upload Area */}
        <div
          className={`border-2 border-dashed rounded-2xl p-12 text-center mb-8 transition-colors cursor-pointer ${
            dragOver
              ? 'border-blue-400 bg-blue-500/10'
              : 'border-slate-600 hover:border-slate-400'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const droppedFile = e.dataTransfer.files[0];
            if (droppedFile && droppedFile.type.startsWith('audio/')) {
              setFile(droppedFile);
              setError(null);
            } else {
              setError('Please upload an audio file (MP3, M4A, WAV, etc.)');
            }
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const selectedFile = e.target.files?.[0] || null;
              setFile(selectedFile);
              setError(null);
            }}
          />

          {file ? (
            <div className="space-y-3">
              <div className="text-3xl">🎵</div>
              <p className="text-white font-medium">{file.name}</p>
              <p className="text-slate-400 text-sm">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                }}
                className="text-sm text-slate-500 hover:text-slate-300 underline"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-5xl mb-4">📎</div>
              <p className="text-lg text-slate-300">
                Drag & drop your audio file here
              </p>
              <p className="text-slate-500">or click to browse</p>
              <p className="text-slate-600 text-sm mt-4">
                Supports MP3, M4A, WAV, WebM • Max 25MB
              </p>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 mb-6 text-red-300 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* Submit Button */}
        <div className="text-center mb-16">
          <button
            onClick={handleSubmit}
            disabled={!file || loading}
            className={`px-10 py-4 rounded-xl font-semibold text-lg transition-all ${
              !file || loading
                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
            }`}
          >
            {loading ? (
              <span className="flex items-center gap-3 justify-center">
                <span className="animate-spin inline-block">⚙️</span>
                Transcribing & Analyzing...
              </span>
            ) : (
              '🚀 Generate Meeting Minutes'
            )}
          </button>
          {loading && (
            <p className="text-slate-500 text-sm mt-3">
              Usually takes 30-90 seconds depending on audio length
            </p>
          )}
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-slate-800 rounded-2xl p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">📝 Meeting Minutes</h2>
                <button
                  onClick={copyResult}
                  className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                >
                  📋 Copy to clipboard
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-slate-300 text-sm leading-relaxed font-mono bg-slate-900 p-4 rounded-xl overflow-x-auto">
                {result}
              </pre>
            </div>

            {transcript && (
              <details className="bg-slate-800/50 rounded-xl">
                <summary className="p-4 cursor-pointer text-slate-400 hover:text-slate-300 text-sm">
                  📄 Show full transcript
                </summary>
                <pre className="px-4 pb-4 text-slate-500 text-xs leading-relaxed whitespace-pre-wrap font-mono">
                  {transcript}
                </pre>
              </details>
            )}

            {/* Upgrade CTA */}
            <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 rounded-2xl p-6 text-center">
              <p className="text-amber-300 font-medium mb-2">
                ❤️ Like this tool?
              </p>
              <p className="text-slate-400 text-sm mb-4">
                This is a free MVP. Want unlimited meetings + PDF export?
              </p>
              <a
                href="#"
                className="inline-block bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-6 py-2 rounded-lg transition-colors"
              >
                ☕ Support & Get Early Access
              </a>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-16 text-slate-600 text-sm">
          Built with 302AI • No account needed • Your files stay private
        </div>
      </div>
    </div>
  );
}
