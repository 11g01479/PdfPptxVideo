
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { AnalysisResult, ModelName } from "../types";
import { PptxContent } from "./pptxParser";

const getAIClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

/**
 * 指数バックオフ付きのリトライ関数
 * 429 (Quota Exceeded) や 503 (Overloaded) の際に再試行します。
 */
const callWithRetry = async (fn: () => Promise<any>, maxRetries = 5): Promise<any> => {
  let delay = 3000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await fn();
      return result;
    } catch (error: any) {
      const rawError = error?.message || "";
      let errorDetail = "";
      
      try {
        // JSON形式のエラーメッセージをパースして詳細を取得
        const parsed = JSON.parse(rawError.substring(rawError.indexOf('{')));
        errorDetail = parsed?.error?.message || "";
      } catch (e) {
        errorDetail = rawError;
      }

      const isQuotaExceeded = errorDetail.includes("quota") || errorDetail.includes("429") || errorDetail.includes("RESOURCE_EXHAUSTED");
      const isOverloaded = errorDetail.includes("503") || errorDetail.includes("overloaded") || errorDetail.includes("UNAVAILABLE");

      // 一時的な過負荷(503)の場合はリトライ
      if (isOverloaded && i < maxRetries - 1) {
        console.warn(`AI model overloaded. Retrying... (${i + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }

      // クォータ制限(429)の場合
      if (isQuotaExceeded) {
        throw new Error("Gemini APIの利用制限（無料枠の上限）に達しました。1日あたりのリクエスト数または短時間の頻度が上限を超えています。しばらく時間をおいてから再度お試しください。");
      }

      // 安全フィルター
      if (errorDetail.includes("SAFETY")) {
        throw new Error("コンテンツがAIの安全ポリシーによりブロックされました。");
      }

      throw new Error(`AI解析エラー: ${errorDetail || "不明なエラーが発生しました。"}`);
    }
  }
};

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const generateSpeechForText = async (text: string, audioCtx: AudioContext): Promise<AudioBuffer> => {
  const ai = getAIClient();
  
  const response = await callWithRetry(() => ai.models.generateContent({
    model: ModelName.TTS,
    contents: [{ parts: [{ text: `落ち着いたトーンで丁寧に読み上げてください： ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  }));

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("音声データの生成に失敗しました。");

  const audioBytes = decode(base64Audio);
  return await decodeAudioData(audioBytes, audioCtx, 24000, 1);
};

export const analyzeDocument = async (
  base64Data: string, 
  mimeType: string, 
  pageCount?: number,
  pptxContent?: PptxContent
): Promise<AnalysisResult> => {
  const ai = getAIClient();
  
  let contentPart: any;
  let systemContext = "";

  if (mimeType === 'application/pdf') {
    contentPart = {
      inlineData: {
        mimeType: mimeType,
        data: base64Data
      }
    };
    systemContext = "このPDFドキュメントを詳細に分析してください。";
  } else {
    const pptxText = pptxContent?.slides.map(s => 
      `Slide ${s.index + 1}:\n[Text on Slide]: ${s.text}\n[Original Speaker Notes]: ${s.notes}`
    ).join('\n\n---\n\n');
    
    contentPart = { text: `以下はPowerPointファイルから抽出された内容です：\n\n${pptxText}` };
    systemContext = "提供されたPowerPointのテキストと既存のノートを元に、より自然で分かりやすい解説動画用スクリプトを作成してください。";
  }

  const prompt = `
${systemContext}
${pageCount ? `【想定ページ数】: ${pageCount}ページ` : ''}

【指示内容】
1. ドキュメントの内容を論理的なスライド構成に分解してください。
2. 各スライドに対して、目を引く「タイトル」と、視聴者に語りかけるような丁寧な「解説（スピーカーノート）」を作成してください。
3. 既存のノートがある場合はそれを最大限尊重しつつ、動画として聞き取りやすい言葉にブラッシュアップしてください。

以下のJSONフォーマットで回答してください：
{
  "presentationTitle": "タイトル",
  "summary": "サマリー",
  "slides": [
    {
      "pageIndex": 0,
      "title": "スライドタイトル",
      "notes": "このスライドの読み上げ解説文"
    }
  ]
}`;

  const response = await callWithRetry(() => ai.models.generateContent({
    model: ModelName.TEXT,
    contents: {
      parts: [contentPart, { text: prompt }]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          presentationTitle: { type: Type.STRING },
          summary: { type: Type.STRING },
          slides: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                pageIndex: { type: Type.INTEGER },
                title: { type: Type.STRING },
                notes: { type: Type.STRING }
              },
              required: ["pageIndex", "title", "notes"]
            }
          }
        },
        required: ["presentationTitle", "summary", "slides"]
      }
    }
  }));

  const text = response.text;
  if (!text) throw new Error("AIから回答が得られませんでした。");

  return JSON.parse(text);
};
