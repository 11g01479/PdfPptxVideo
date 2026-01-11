
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { AnalysisResult, ModelName } from "../types";

const getAIClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

// Base64デコード
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// PCMデータをAudioBufferに変換
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
  const response = await ai.models.generateContent({
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
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("音声データの生成に失敗しました。");

  const audioBytes = decode(base64Audio);
  return await decodeAudioData(audioBytes, audioCtx, 24000, 1);
};

export const analyzePdfForPpt = async (base64Pdf: string, pageCount: number): Promise<AnalysisResult> => {
  const ai = getAIClient();
  
  const prompt = `このPDFドキュメントをページごとに詳細に分析してください。
【総ページ数】: ${pageCount}ページ

【指示内容】
1. PDFの全 ${pageCount} ページを1枚ずつのスライドとして構成してください。
2. 各ページに対して、その内容に基づいた「スライドタイトル」と、詳細な「解説（スピーカーノート）」を作成してください。
3. ページ番号（pageIndex: 0 から ${pageCount - 1} まで）を一切飛ばさず、全てのページを含めてください。
4. スピーカーノートには、そのページで説明すべき要点や発表用のスクリプトを、聴衆が理解しやすい丁寧な日本語で記述してください。

以下のJSONフォーマットで回答してください：
{
  "presentationTitle": "ドキュメント全体の包括的なタイトル",
  "summary": "内容全体の簡潔なサマリー",
  "slides": [
    {
      "pageIndex": 0,
      "title": "1ページ目の内容を要約したタイトル",
      "notes": "このページで発表者が読み上げるべき詳細な解説文（スピーカーノート）"
    }
  ]
}`;

  const response = await ai.models.generateContent({
    model: ModelName.TEXT,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: "application/pdf",
            data: base64Pdf
          }
        },
        { text: prompt }
      ]
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
  });

  const text = response.text;
  if (!text) {
    throw new Error("AIから有効な解析結果が得られませんでした。");
  }

  const result: AnalysisResult = JSON.parse(text);
  result.slides.sort((a, b) => a.pageIndex - b.pageIndex);
  return result;
};
