
import pptxgen from "pptxgenjs";
import { AnalysisResult } from "../types";

export const createPresentation = async (data: AnalysisResult): Promise<void> => {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_16x9';

  // Title Slide
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

  // Page-by-Page Slides
  data.slides.forEach((slide) => {
    const s = pres.addSlide();
    
    // スライド画像が生成されている場合はそれを全面に配置
    if (slide.imageUrl) {
      // DataURL形式でも安全に扱えるように指定
      s.addImage({
        data: slide.imageUrl,
        x: 0,
        y: 0,
        w: "100%",
        h: "100%",
        sizing: { type: 'contain', w: 10, h: 5.625 }
      });
    } else {
      s.background = { color: "1E293B" };
      s.addText(slide.title, {
        x: 0, y: 2, w: "100%", h: 1,
        align: "center", fontSize: 32, color: "FFFFFF", bold: true
      });
    }

    // スピーカーノートにAI生成の解説を追加
    s.addNotes(slide.notes);
  });

  // ファイル保存
  const safeName = data.presentationTitle.replace(/[/\\?%*:|"<>]/g, '-');
  await pres.writeFile({ fileName: `${safeName}.pptx` });
};
