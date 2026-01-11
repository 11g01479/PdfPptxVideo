
export interface Slide {
  title: string;
  notes: string;
  pageIndex: number;
  imageUrl?: string;
  audioBuffer?: AudioBuffer; // 生成された音声データ
}

export interface AnalysisResult {
  presentationTitle: string;
  summary: string;
  slides: Slide[];
}

export interface AppState {
  status: 'idle' | 'rendering' | 'analyzing' | 'reviewing' | 'audio_generating' | 'video_recording' | 'completed' | 'error';
  progress: number;
  error?: string;
}

export enum ModelName {
  TEXT = 'gemini-3-flash-preview',
  TTS = 'gemini-2.5-flash-preview-tts'
}
