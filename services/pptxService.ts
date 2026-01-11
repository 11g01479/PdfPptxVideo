
import pptxgen from "pptxgenjs";
import { AnalysisResult } from "../types";

export const createPresentation = async (data: AnalysisResult): Promise<void> => {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_16x9';

  // Title Slide
  const titleSlide = pres.addSlide();
  titleSlide.background = { color: "1E293B" };
  titleSlide.addText(data.presentationTitle, {
    x: 0, y: 2.2, w: "100%", h: 1,
    align: "center", fontSize: 40, color: "38BDF8", bold: true
  });
  titleSlide.addText("AI Generated Speaker Notes from PDF Content", {
    x: 0, y: 3.2, w: "100%", h: 0.5,
    align: "center", fontSize: 20, color: "94A3B8"
  });

  // Page-by-Page Slides
  data.slides.forEach((slide) => {
    const s = pres.addSlide();
    
    // Original PDF Page as full-content image
    if (slide.imageUrl) {
      s.addImage({
        data: slide.imageUrl,
        x: 0,
        y: 0,
        w: "100%",
        h: "100%",
        sizing: { type: 'contain', w: 10, h: 5.625 }
      });
    }

    // Add Slide Title (Optional overlay for accessibility)
    s.addText(slide.title, {
      x: 0.2, y: 0.1, w: 9.6, h: 0.4,
      fontSize: 12, color: "FFFFFF", bold: true, align: 'left',
      fill: { color: '0F172A', transparency: 60 }
    });

    // CRITICAL: Put the AI analysis into Speaker Notes
    s.addNotes(slide.notes);
  });

  // Save the presentation
  const safeName = data.presentationTitle.replace(/[/\\?%*:|"<>]/g, '-');
  await pres.writeFile({ fileName: `${safeName}.pptx` });
};
