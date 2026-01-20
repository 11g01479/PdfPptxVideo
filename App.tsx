
import React, { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { analyzeDocument, generateSpeechForText } from './services/geminiService';
import { createPresentation } from './services/pptxService';
import { extractTextFromPptx, PptxContent } from './services/pptxParser';
import { AnalysisResult, AppState, Slide } from './types';
import StepCard from './components/StepCard';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`;

const DAILY_LIMIT = 5; 

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [appState, setAppState] = useState<AppState>({ status: 'idle', progress: 0 });
  const [loadingMsg, setLoadingMsg] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [remainingQuota, setRemainingQuota] = useState<number>(DAILY_LIMIT);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const checkQuota = () => {
      const today = new Date().toISOString().split('T')[0];
      const storedData = localStorage.getItem('pdf_video_quota');
      if (storedData) {
        const { date, count } = JSON.parse(storedData);
        if (date === today) setRemainingQuota(Math.max(0, DAILY_LIMIT - count));
        else {
          localStorage.setItem('pdf_video_quota', JSON.stringify({ date: today, count: 0 }));
          setRemainingQuota(DAILY_LIMIT);
        }
      } else {
        localStorage.setItem('pdf_video_quota', JSON.stringify({ date: today, count: 0 }));
        setRemainingQuota(DAILY_LIMIT);
      }
    };
    checkQuota();
  }, []);

  const useQuota = () => {
    const today = new Date().toISOString().split('T')[0];
    const storedData = localStorage.getItem('pdf_video_quota');
    if (storedData) {
      const { count } = JSON.parse(storedData);
      localStorage.setItem('pdf_video_quota', JSON.stringify({ date: today, count: count + 1 }));
      setRemainingQuota(DAILY_LIMIT - (count + 1));
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setAnalysis(null);
      setVideoUrl(null);
      setAppState({ status: 'idle', progress: 0 });
    }
  };

  const handleNoteChange = (index: number, newNote: string) => {
    if (!analysis) return;
    const newSlides = [...analysis.slides];
    newSlides[index].notes = newNote;
    setAnalysis({ ...analysis, slides: newSlides });
  };

  const renderPdfToImages = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const images: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      setLoadingMsg(`PDFを画像として展開中... (${i}/${pdf.numPages})`);
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      await page.render({ canvasContext: ctx, viewport }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.9));
    }
    return images;
  };

  const createSlideImagesFromPptx = async (content: PptxContent): Promise<string[]> => {
    const images: string[] = [];
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d')!;

    for (const slide of content.slides) {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (slide.image) {
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const ratio = Math.min(canvas.width / img.width, canvas.height / img.height);
            const nw = img.width * ratio, nh = img.height * ratio;
            ctx.drawImage(img, (canvas.width - nw) / 2, (canvas.height - nh) / 2, nw, nh);
            resolve(null);
          };
          img.onerror = () => resolve(null);
          img.src = slide.image!;
        });
      }

      if (!slide.image) {
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 50px sans-serif';
        ctx.textAlign = 'center';
        const title = slide.text.split('\n')[0] || `Slide ${slide.index + 1}`;
        ctx.fillText(title.slice(0, 30), canvas.width / 2, 180);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '28px sans-serif';
        const lines = slide.text.match(/.{1,50}/g) || [];
        lines.slice(0, 8).forEach((line, i) => {
          ctx.fillText(line, canvas.width / 2, 280 + (i * 40));
        });
      } else {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
        ctx.fillRect(0, 0, canvas.width, 60);
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`Slide ${slide.index + 1}`, 30, 40);
      }

      images.push(canvas.toDataURL('image/jpeg', 0.8));
    }
    return images;
  };

  const startAnalysis = async () => {
    if (!file || remainingQuota <= 0) return;
    try {
      setAppState({ status: 'rendering', progress: 10 });
      let images: string[] = [];
      let pageCount = 0;
      let pptxContent: PptxContent | undefined;

      if (file.type === 'application/pdf') {
        images = await renderPdfToImages(file);
        pageCount = images.length;
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
        setLoadingMsg("PowerPointから画像とテキストを抽出中...");
        pptxContent = await extractTextFromPptx(file);
        pageCount = pptxContent.slides.length;
        setLoadingMsg("スライド画像を再構成中...");
        images = await createSlideImagesFromPptx(pptxContent);
      }

      setAppState({ status: 'analyzing', progress: 40 });
      setLoadingMsg("AIがドキュメントを読み取っています...");

      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });

      const result = await analyzeDocument(base64, file.type, pageCount || undefined, pptxContent);
      
      const finalSlides = result.slides.map((s, i) => ({
        ...s,
        imageUrl: images[i] || undefined
      }));

      setAnalysis({ ...result, slides: finalSlides });
      setAppState({ status: 'reviewing', progress: 70 });
    } catch (error: any) {
      console.error("Analysis Error:", error);
      setAppState({ status: 'error', progress: 0, error: error.message });
    }
  };

  const createVideo = async () => {
    if (!analysis) return;
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const dest = audioCtx.createMediaStreamDestination();
    
    try {
      setAppState({ status: 'audio_generating', progress: 0 });
      const slidesWithAudio = [...analysis.slides];
      
      for (let i = 0; i < slidesWithAudio.length; i++) {
        setLoadingMsg(`音声素材を生成中... (${i + 1}/${slidesWithAudio.length})\n※Google APIの無料制限回避のため時間がかかる場合があります`);
        try {
          slidesWithAudio[i].audioBuffer = await generateSpeechForText(slidesWithAudio[i].notes, audioCtx);
        } catch (err: any) {
          throw err;
        }
        setAppState(prev => ({ ...prev, progress: Math.floor(((i + 1) / slidesWithAudio.length) * 50) }));
        // 無料枠のRate Limitを考慮して少し間隔をあける
        await new Promise(r => setTimeout(r, 2000));
      }

      setAppState({ status: 'video_recording', progress: 50 });
      const canvas = canvasRef.current!;
      canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d')!;
      const stream = canvas.captureStream(30); 
      dest.stream.getAudioTracks().forEach(track => stream.addTrack(track));
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      const recordingPromise = new Promise<Blob>((resolve) => recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' })));

      const drawFrame = (slide: Slide) => {
        ctx.fillStyle = "#0f172a"; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        if (slide.imageUrl) {
          const img = new Image();
          img.src = slide.imageUrl;
          const ratio = Math.min(canvas.width / img.width, canvas.height / img.height);
          const nw = img.width * ratio, nh = img.height * ratio;
          ctx.drawImage(img, (canvas.width - nw) / 2, (canvas.height - nh) / 2, nw, nh);
        }
      };

      recorder.start();
      for (let i = 0; i < slidesWithAudio.length; i++) {
        const slide = slidesWithAudio[i];
        setLoadingMsg(`動画エンコード中: ${i + 1} / ${slidesWithAudio.length} スライド`);
        const duration = slide.audioBuffer!.duration;
        const endTime = Date.now() + (duration * 1000) + 300;
        
        const source = audioCtx.createBufferSource();
        source.buffer = slide.audioBuffer!;
        source.connect(dest); source.connect(audioCtx.destination);
        source.start();

        while (Date.now() < endTime) {
          drawFrame(slide);
          await new Promise(r => requestAnimationFrame(r));
        }
      }
      recorder.stop();
      const videoBlob = await recordingPromise;
      useQuota();
      setVideoUrl(URL.createObjectURL(videoBlob));
      setAppState({ status: 'completed', progress: 100 });
      audioCtx.close();
    } catch (error: any) {
      console.error("Video Generation Error:", error);
      setAppState({ status: 'error', progress: 0, error: error.message });
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-20">
      <div className="max-w-5xl mx-auto px-4 py-12">
        <header className="text-center mb-16">
          <div className="flex flex-col items-center gap-4 mb-4">
            <div className="inline-block px-4 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-bold uppercase tracking-widest">
              AI Document Explainer
            </div>
            <div className={`inline-flex items-center gap-3 px-5 py-2 rounded-2xl border ${remainingQuota > 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'} font-bold text-sm`}>
              残り生成枠: {remainingQuota} 回
            </div>
          </div>
          <h1 className="text-5xl md:text-6xl font-black mb-6 bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 tracking-tight">
            PDF & PPT to Video
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto leading-relaxed">
            ファイルをアップロードしてAIが解説を生成。<br />
            解説文は自由に編集でき、最後に音声付きの動画を作成します。
          </p>
        </header>

        <main className="space-y-6">
          <StepCard number={1} title="ファイルをアップロード" active={appState.status === 'idle'} completed={!!file && appState.status !== 'idle'}>
            <div className="flex flex-col items-center">
              <label className="w-full flex flex-col items-center py-12 bg-slate-800/20 rounded-3xl border-2 border-dashed border-slate-700 cursor-pointer hover:border-cyan-500 hover:bg-slate-800/40 transition-all group overflow-hidden relative">
                <div className="p-5 rounded-2xl bg-slate-900 mb-4 group-hover:scale-110 transition-all z-10">
                  <svg className="w-12 h-12 text-slate-400 group-hover:text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                </div>
                <span className="text-slate-300 font-bold text-lg z-10">{file ? file.name : "PDFまたはPowerPointを選択"}</span>
                <input type="file" className="hidden" accept=".pdf,.pptx" onChange={handleFileUpload} />
              </label>
              <p className="mt-4 text-xs text-slate-500">※Gemini APIの無料枠制限により、スライド数が多いと生成に失敗する場合があります。</p>
              {file && appState.status === 'idle' && (
                <button onClick={startAnalysis} className="mt-8 px-10 py-4 bg-cyan-600 hover:bg-cyan-500 text-white font-black rounded-xl shadow-xl transition-all transform hover:scale-105 active:scale-95">
                  AI解析を開始
                </button>
              )}
            </div>
          </StepCard>

          <StepCard number={2} title="解説の確認と編集" active={['rendering', 'analyzing', 'reviewing', 'audio_generating', 'video_recording'].includes(appState.status)} completed={appState.status === 'completed'}>
            {['rendering', 'analyzing', 'audio_generating', 'video_recording'].includes(appState.status) ? (
              <div className="flex flex-col items-center py-12 text-center">
                <div className="w-16 h-16 border-4 border-slate-800 border-t-cyan-500 rounded-full animate-spin mb-6"></div>
                <p className="text-xl font-bold mb-4 text-white whitespace-pre-line leading-relaxed">{loadingMsg}</p>
                <div className="w-full max-w-md bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div className="bg-cyan-500 h-full transition-all duration-500" style={{ width: `${appState.progress}%` }}></div>
                </div>
              </div>
            ) : analysis ? (
              <div className="space-y-8">
                <div className="bg-slate-900/80 p-6 rounded-2xl border border-slate-800">
                  <h4 className="text-cyan-400 font-black text-xl mb-2">{analysis.presentationTitle}</h4>
                  <p className="text-slate-400 text-sm leading-relaxed">{analysis.summary}</p>
                </div>

                <div className="grid grid-cols-1 gap-6 max-h-[600px] overflow-y-auto pr-2 scrollbar-thin">
                  {analysis.slides.map((slide, idx) => (
                    <div key={idx} className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/50 flex flex-col md:flex-row gap-6">
                      <div className="w-full md:w-64 shrink-0 aspect-video bg-black rounded-lg overflow-hidden border border-slate-700">
                        {slide.imageUrl ? <img src={slide.imageUrl} alt="" className="w-full h-full object-contain" /> : <div className="w-full h-full flex items-center justify-center text-xs text-slate-600 bg-slate-900">PREVIEW</div>}
                      </div>
                      <div className="flex-1 space-y-4">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-cyan-500 uppercase">Slide {idx + 1}</span>
                          <span className="text-xs text-slate-500">{slide.notes.length} 文字</span>
                        </div>
                        <h5 className="font-bold text-slate-100 text-lg">{slide.title}</h5>
                        <textarea 
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg p-4 text-sm text-slate-300 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all outline-none min-h-[120px] resize-none"
                          value={slide.notes}
                          onChange={(e) => handleNoteChange(idx, e.target.value)}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap justify-center gap-4 pt-6">
                  <button onClick={createVideo} className="px-10 py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black rounded-xl shadow-xl transition-all transform hover:scale-105 active:scale-95 flex items-center gap-3">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" /></svg>
                    動画を生成
                  </button>
                  <button onClick={() => createPresentation(analysis)} className="px-10 py-4 bg-slate-100 text-slate-950 hover:bg-white font-black rounded-xl transition-all active:scale-95">
                    PPTを保存
                  </button>
                </div>
              </div>
            ) : null}
          </StepCard>

          <StepCard number={3} title="動画の完成" active={appState.status === 'completed'} completed={appState.status === 'completed'}>
            {videoUrl && (
              <div className="flex flex-col items-center py-6">
                <div className="w-full max-w-3xl aspect-video rounded-3xl overflow-hidden shadow-2xl border-4 border-slate-900 bg-black mb-8">
                  <video src={videoUrl} controls className="w-full h-full object-contain" />
                </div>
                <a href={videoUrl} download="presentation_video.webm" className="px-12 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl shadow-xl transition-all flex items-center gap-3">
                  ダウンロード
                </a>
              </div>
            )}
          </StepCard>
        </main>
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {appState.status === 'error' && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-6 z-50">
          <div className="bg-slate-900 p-8 rounded-3xl border border-red-500/30 text-center max-w-lg w-full">
            <h2 className="text-2xl font-black mb-4 text-white">処理が中断されました</h2>
            <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl mb-6">
              <p className="text-red-400 text-sm break-words leading-relaxed">{appState.error}</p>
            </div>
            {appState.error?.includes("制限") && (
              <div className="text-left bg-slate-800/50 p-4 rounded-xl mb-8 text-xs text-slate-400 space-y-2">
                <p>💡 解決のヒント:</p>
                <ul className="list-disc list-inside">
                  <li>スライドの枚数を10枚以下に減らしてください。</li>
                  <li>Gemini APIの無料枠制限によるものです。数分〜数時間あけて再試行してください。</li>
                  <li>有料のGoogle AI Studio APIキーを設定すると制限を回避できます。</li>
                </ul>
              </div>
            )}
            <button onClick={() => window.location.reload()} className="w-full py-4 bg-slate-700 hover:bg-slate-600 text-white font-black rounded-xl transition-colors">
              トップに戻る
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
