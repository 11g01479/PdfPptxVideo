
import JSZip from 'jszip';

export interface PptxContent {
  slides: {
    index: number;
    text: string;
    notes: string;
    image?: string; // Base64 encoded image
  }[];
}

export const extractTextFromPptx = async (file: File): Promise<PptxContent> => {
  const zip = await JSZip.loadAsync(file);
  const slideFiles = Object.keys(zip.files).filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'));
  
  // スライド番号で数値的にソート
  slideFiles.sort((a, b) => {
    const numA = parseInt(a.match(/\d+/)![0]);
    const numB = parseInt(b.match(/\d+/)![0]);
    return numA - numB;
  });

  const slides: PptxContent['slides'] = [];

  for (let i = 0; i < slideFiles.length; i++) {
    const slidePath = slideFiles[i];
    const slideNum = slidePath.match(/\d+/)![0];
    
    // 1. テキスト抽出
    const slideXml = await zip.file(slidePath)?.async('text');
    const textMatches = slideXml?.match(/<a:t>([^<]+)<\/a:t>/g) || [];
    const slideText = textMatches.map(m => m.replace(/<\/?a:t>/g, '')).join(' ');

    // 2. ノート抽出
    const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    let notesText = "";
    const notesXml = await zip.file(notesPath)?.async('text');
    if (notesXml) {
      const notesMatches = notesXml.match(/<a:t>([^<]+)<\/a:t>/g) || [];
      notesText = notesMatches.map(m => m.replace(/<\/?a:t>/g, '')).join(' ');
    }

    // 3. 画像抽出 (Relationshipファイルを解析)
    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
    let slideImageBase64: string | undefined;
    const relsXml = await zip.file(relsPath)?.async('text');
    
    if (relsXml) {
      // 最初の画像メディアを探す
      const imageMatch = relsXml.match(/Target="\.\.\/media\/([^"]+\.(png|jpg|jpeg|gif|webp))"/i);
      if (imageMatch) {
        const mediaPath = `ppt/media/${imageMatch[1]}`;
        const imageFile = zip.file(mediaPath);
        if (imageFile) {
          const buffer = await imageFile.async('base64');
          const ext = imageMatch[2].toLowerCase();
          const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
          slideImageBase64 = `data:${mimeType};base64,${buffer}`;
        }
      }
    }

    slides.push({
      index: i,
      text: slideText,
      notes: notesText,
      image: slideImageBase64
    });
  }

  return { slides };
};
