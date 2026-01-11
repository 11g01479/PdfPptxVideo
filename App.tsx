
import React, { useState, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { analyzePdfForPpt, generateSpeechForText } from './services/geminiService';
import { createPresentation } from './services/pptxService';
import { AnalysisResult, AppState, Slide } from './types';
import StepCard from './components/StepCard';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`;

const App: React.FC = () => {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [appState, setAppState] = useState<AppState>({ status: 'idle', progress: 0 });
  const [loadingMsg, setLoadingMsg] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setPdfFile(file);
      setAnalysis(null);
      setVideoUrl(null);
      setAppState({ status: 'idle', progress: 0 });
    }
  };

  const renderPdfToImages = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const images: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      setLoadingMsg(`PDFを画像として展開中... (${i}/${pdf.numPages} ページ)`);
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      await page.render({ canvasContext: ctx, viewport }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.9));
    }
    return { images, numPages: pdf.numPages };
  };

  const startAnalysis = async () => {
    if (!pdfFile) return;
    try {
      setAppState({ status: 'rendering', progress: 10 });
      const { images, numPages } = await renderPdfToImages(pdfFile);
      setAppState({ status: 'analyzing', progress: 40 });
      setLoadingMsg("AIがドキュメントを読み取っています...");

      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(pdfFile);
      });

      const result = await analyzePdfForPpt(base64, numPages);
      
      // AIの結果とPDFページを厳密にマッピング（1ページも漏らさない）
      const finalSlides: Slide[] = [];
      for (let i = 0; i < numPages; i++) {
        const aiSlide = result.slides.find(s => s.pageIndex === i);
        finalSlides.push({
          pageIndex: i,
          title: aiSlide?.title || `ページ ${i + 1}`,
          notes: aiSlide?.notes || "このページの解説を生成できませんでした。",
          imageUrl: images[i]
        });
      }

      setAnalysis({ ...result, slides: finalSlides });
      setAppState({ status: 'reviewing', progress: 70 });
    } catch (error: any) {
      setAppState({ status: 'error', progress: 0, error: error.message });
    }
  };

  const createVideo = async () => {
    if (!analysis) return;
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const dest = audioCtx.createMediaStreamDestination();
    
    try {
      // --- ステップ1: 音声合成と画像の事前ロード ---
      setAppState({ status: 'audio_generating', progress: 0 });
      const preloadedImages: HTMLImageElement[] = [];
      const slidesWithAudio = [...analysis.slides];
      
      for (let i = 0; i < slidesWithAudio.length; i++) {
        setLoadingMsg(`素材を準備中... (${i + 1}/${slidesWithAudio.length})`);
        
        // 音声生成
        slidesWithAudio[i].audioBuffer = await generateSpeechForText(slidesWithAudio[i].notes, audioCtx);
        
        // 画像プリロード
        const img = new Image();
        img.src = slidesWithAudio[i].imageUrl!;
        await new Promise(r => img.onload = r);
        preloadedImages.push(img);
        
        setAppState(prev => ({ ...prev, progress: Math.floor(((i + 1) / slidesWithAudio.length) * 50) }));
      }

      // --- ステップ2: 動画録画の開始 ---
      setAppState({ status: 'video_recording', progress: 50 });
      const canvas = canvasRef.current!;
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d')!;
      
      // ストリームの設定
      const stream = canvas.captureStream(30);
      dest.stream.getAudioTracks().forEach(track => stream.addTrack(track));
      
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      
      const recordingPromise = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      });

      // 録画開始前の「初期描画」（ページ1を先に見せておく）
      const drawFrame = (img: HTMLImageElement) => {
        ctx.fillStyle = "#0f172a"; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const ratio = Math.min(canvas.width / img.width, canvas.height / img.height);
        const nw = img.width * ratio;
        const nh = img.height * ratio;
        ctx.drawImage(img, (canvas.width - nw) / 2, (canvas.height - nh) / 2, nw, nh);
      };

      if (preloadedImages.length > 0) {
        drawFrame(preloadedImages[0]);
      }

      // 録画開始
      recorder.start();
      // レコーダーが開始するのをわずかに待つ
      await new Promise(r => setTimeout(r, 200));

      for (let i = 0; i < slidesWithAudio.length; i++) {
        const slide = slidesWithAudio[i];
        const img = preloadedImages[i];
        setLoadingMsg(`動画を構成中: ${i + 1}ページ目`);
        
        // 描画
        drawFrame(img);
        
        // 音声再生
        const source = audioCtx.createBufferSource();
        source.buffer = slide.audioBuffer!;
        source.connect(dest);
        source.connect(audioCtx.destination);
        
        const duration = slide.audioBuffer!.duration;
        source.start();
        
        // 音声の長さ分だけ待機（少し余裕を持たせる）
        await new Promise(r => setTimeout(r, duration * 1000 + 500)); 
      }

      recorder.stop();
      const videoBlob = await recordingPromise;
      setVideoUrl(URL.createObjectURL(videoBlob));
      setAppState({ status: 'completed', progress: 100 });
      
      // AudioContextをクローズ
      audioCtx.close();
    } catch (error: any) {
      setAppState({ status: 'error', progress: 0, error: error.message });
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-20">
      <div className="max-w-5xl mx-auto px-4 py-12">
        <header className="text-center mb-16 animate-in fade-in slide-in-from-top duration-700">
          <div className="inline-block px-4 py-1 mb-4 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-bold uppercase tracking-widest">
            Free AI Explainer Video Creator
          </div>
          <h1 className="text-6xl font-black mb-6 bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 tracking-tight">
            PDF to Explainable Video
          </h1>
          <p className="text-slate-400 text-xl max-w-2xl mx-auto font-medium">
            アップロードしたPDFをAIが解説。<br />
            音声付き動画とノート付きPPTを無料で即座に作成します。
          </p>
        </header>

        <main className="space-y-6">
          <StepCard number={1} title="PDFをアップロード" active={appState.status === 'idle'} completed={!!pdfFile && appState.status !== 'idle'}>
            <div className="flex flex-col items-center">
              <label className="w-full flex flex-col items-center py-12 bg-slate-800/20 rounded-3xl border-2 border-dashed border-slate-700 cursor-pointer hover:border-cyan-500 hover:bg-slate-800/40 transition-all group">
                <div className="p-5 rounded-2xl bg-slate-900 mb-6 group-hover:scale-110 transition-all shadow-xl">
                  <svg className="w-12 h-12 text-slate-400 group-hover:text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                </div>
                <span className="text-slate-300 font-bold text-lg">{pdfFile ? pdfFile.name : "ファイルを選択 (無料解析)"}</span>
                <input type="file" className="hidden" accept=".pdf" onChange={handleFileUpload} />
              </label>
              {pdfFile && appState.status === 'idle' && (
                <button onClick={startAnalysis} className="mt-8 px-12 py-5 bg-gradient-to-r from-cyan-600 to-blue-700 hover:from-cyan-500 hover:to-blue-600 text-white font-black rounded-2xl shadow-2xl transition-all transform hover:scale-105 text-lg">
                  今すぐ無料解析を開始
                </button>
              )}
            </div>
          </StepCard>

          <StepCard number={2} title="解説の生成とプレビュー" active={['rendering', 'analyzing', 'reviewing', 'audio_generating', 'video_recording'].includes(appState.status)} completed={appState.status === 'completed'}>
            {['rendering', 'analyzing', 'audio_generating', 'video_recording'].includes(appState.status) ? (
              <div className="flex flex-col items-center py-16 text-center">
                <div className="w-20 h-20 border-4 border-slate-800 border-t-cyan-500 rounded-full animate-spin mb-8"></div>
                <p className="text-2xl font-bold mb-4 tracking-tight">{loadingMsg}</p>
                <div className="w-full max-w-md bg-slate-800 h-3 rounded-full overflow-hidden shadow-inner">
                  <div className="bg-gradient-to-r from-cyan-500 to-blue-600 h-full transition-all duration-500 ease-out" style={{ width: `${appState.progress}%` }}></div>
                </div>
              </div>
            ) : analysis ? (
              <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
                <div className="bg-slate-900/80 p-6 rounded-2xl border border-slate-800 shadow-inner">
                  <h4 className="text-cyan-400 font-black text-xl mb-1 tracking-tight">解析結果: {analysis.presentationTitle}</h4>
                  <p className="text-slate-400 text-sm italic">{analysis.summary}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[500px] overflow-y-auto pr-4 scrollbar-thin">
                  {analysis.slides.map((slide, idx) => (
                    <div key={idx} className="bg-slate-800/40 p-5 rounded-2xl border border-slate-700/50 hover:border-cyan-500/30 transition-all flex flex-col gap-4">
                      <div className="aspect-video bg-black rounded-lg overflow-hidden border border-slate-700 shadow-lg">
                        {slide.imageUrl && <img src={slide.imageUrl} alt="" className="w-full h-full object-contain" />}
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black bg-cyan-600 text-white px-2 py-0.5 rounded uppercase">PAGE {idx+1}</span>
                          <h5 className="font-bold text-slate-100 truncate text-sm">{slide.title}</h5>
                        </div>
                        <p className="text-xs text-slate-400 line-clamp-3 bg-slate-950/50 p-3 rounded-lg border border-slate-800">{slide.notes}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap justify-center gap-6 pt-6">
                  <button onClick={createVideo} className="px-10 py-5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black rounded-2xl shadow-2xl transition-all transform hover:scale-105 active:scale-95 flex items-center gap-3">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" /></svg>
                    音声付き動画を生成 (無料)
                  </button>
                  <button onClick={() => createPresentation(analysis)} className="px-10 py-5 bg-slate-100 text-slate-950 hover:bg-white font-black rounded-2xl shadow-2xl transition-all transform hover:scale-105 active:scale-95 flex items-center gap-3">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 012-2h4.586A1 1 0 0111.293 2.707l3 3a1 1 0 01.293.707V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" /></svg>
                    PPTファイルを保存
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-20 text-center opacity-40 italic">
                PDFの解析が完了すると、スライド一覧が表示されます。
              </div>
            )}
          </StepCard>

          <StepCard number={3} title="動画の完成" active={appState.status === 'completed'} completed={appState.status === 'completed'}>
            {videoUrl ? (
              <div className="flex flex-col items-center py-6 animate-in zoom-in-95 duration-500">
                <div className="w-full max-w-3xl aspect-video rounded-3xl overflow-hidden shadow-2xl border-4 border-slate-800 bg-black relative mb-10 group">
                  <video src={videoUrl} controls className="w-full h-full object-contain" />
                  <div className="absolute top-4 right-4 bg-green-500 text-white px-3 py-1 rounded-full text-xs font-black shadow-lg">READY</div>
                </div>
                <div className="flex gap-6">
                  <a href={videoUrl} download="ai_presentation.webm" className="px-12 py-5 bg-green-600 hover:bg-green-500 text-white font-black rounded-2xl shadow-2xl transition-all transform hover:scale-105 flex items-center gap-3">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    動画をダウンロード
                  </a>
                  <button onClick={() => window.location.reload()} className="px-12 py-5 bg-slate-800 hover:bg-slate-700 text-white font-black rounded-2xl transition-all border border-slate-700">
                    新しく作成する
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-20 text-center opacity-40 italic">
                動画生成ボタンを押すと、こちらにプレイヤーが表示されます。
              </div>
            )}
          </StepCard>
        </main>
        
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {appState.status === 'error' && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50 animate-in fade-in duration-300">
          <div className="bg-slate-900 p-10 rounded-[32px] border border-red-500/30 text-center max-w-lg w-full shadow-2xl">
            <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h2 className="text-2xl font-black mb-4 text-white">エラーが発生しました</h2>
            <p className="text-slate-400 mb-8 leading-relaxed">{appState.error}</p>
            <button onClick={() => window.location.reload()} className="w-full py-5 bg-red-600 hover:bg-red-500 text-white font-black rounded-2xl shadow-xl transition-all">トップに戻る</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
