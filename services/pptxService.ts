
import pptxgen from "pptxgenjs";
import { AnalysisResult } from "../types";

/**
 * 編集済みの解説内容を反映した新しいPowerPointファイルを作成・ダウンロードします。
 */
export const createPresentation = async (data: AnalysisResult): Promise<void> => {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_16x9';

  // タイトルスライドの作成
  const titleSlide = pres.addSlide();
  titleSlide.background = { color: "0F172A" };
  titleSlide.addText(data.presentationTitle, {
    x: 0, y: 2.2, w: "100%", h: 1,
    align: "center", fontSize: 40, color: "38BDF8", bold: true
  });
  titleSlide.addText(data.summary, {
    x: 1, y: 3.5, w: 8, h: 1.5,
    align: "center", fontSize: 16, color: "94A3B8"
  });

  // 各ページスライドの作成
  data.slides.forEach((slide) => {
    const s = pres.addSlide();
    
    // スライド画像がある場合はそれを優先的に全面配置
    if (slide.imageUrl) {
      try {
        s.addImage({
          data: slide.imageUrl,
          x: 0,
          y: 0,
          w: "100%",
          h: "100%",
          sizing: { type: 'contain', w: 10, h: 5.625 }
        });
      } catch (err) {
        console.error("Failed to add image to slide:", err);
        // 画像追加に失敗した場合は背景色で代用
        s.background = { color: "1E293B" };
        s.addText(`[Image missing: ${slide.title}]`, { x: 0, y: 2.5, w: "100%", align: "center", color: "FF0000" });
      }
    } else {
      s.background = { color: "1E293B" };
      s.addText(slide.title, {
        x: 0, y: 2, w: "100%", h: 1,
        align: "center", fontSize: 32, color: "FFFFFF", bold: true
      });
    }

    // AIが生成した解説文を「ノート」として追加
    // これにより、プレゼン資料としても即戦力になります。
    s.addNotes(slide.notes);
  });

  // ファイル名のサニタイズ（OSで禁止されている文字を置換）
  const safeName = data.presentationTitle.replace(/[/\\?%*:|"<>]/g, '-');
  
  // ファイルをブラウザでダウンロード
  await pres.writeFile({ fileName: `${safeName}_ai_explanation.pptx` });
};
