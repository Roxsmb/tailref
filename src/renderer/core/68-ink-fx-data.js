/* TailRef app · ink fx UI verisi · Faz 4 (master spec Bölüm 3/4/5)
   ------------------------------------------------------------------
   Inspector bölüm grupları + built-in presetler. Yalnızca VERİ:
   panel davranışı 69-ink-fx-ui.js'te. Presetler TAM parametre
   konfigürasyonunu şema varsayılanlarıyla birleştirip saklar
   (spec: "Presets must store the complete parameter configuration").
   ========================================================= */
'use strict';

/* =========================================================
   inspector bölümleri (collapsible sections, Bölüm 3)
   ========================================================= */

const INK_FX_GROUPS = {
  'halftone': [
    ['Dot Settings', 'dotSize', 'dotSpacing', 'dotAngle', 'dotShape', 'dotScale', 'dotRotation'],
    ['Image Processing', 'contrast', 'brightness', 'threshold', 'tonalSensitivity', 'patternIntensity', 'edgePreservation'],
    ['Appearance', 'colorMode', 'dotColor', 'bgColor', 'invertPattern'],
  ],
  'risograph': [
    ['Ink Settings', 'inkCount', 'ink1Color', 'ink2Color', 'ink3Color', 'ink4Color', 'inkDensity', 'inkOpacity', 'inkSaturation', 'inkAbsorption'],
    ['Registration', 'regOffsetX', 'regOffsetY', 'channelOffset', 'regIrregularity'],
    ['Texture', 'paperGrain', 'inkGrain', 'printImperfections', 'inkBleeding', 'textureIntensity'],
    ['Color', 'colorSeparation', 'colorMixing', 'colorOverlap', 'contrast'],
  ],
  'watercolor': [
    ['Pigment', 'pigmentDiffusion', 'pigmentDensity', 'pigmentGranulation', 'pigmentPooling', 'pigmentVariation'],
    ['Water Behavior', 'waterSpread', 'absorption', 'edgeDiffusion', 'wetness', 'bleeding', 'edgeDarkening', 'paperAbsorption'],
    ['Appearance', 'paperTexture', 'colorVariation', 'transparency', 'textureIntensity'],
  ],
  'colored-pencil': [
    ['Stroke', 'strokeDensity', 'strokeDirection', 'strokeLength', 'pressureVariation', 'strokeIrregularity'],
    ['Pigment', 'pigmentCoverage', 'colorVariation', 'layeredPigment', 'pencilHardness'],
    ['Texture', 'pencilGrain', 'paperTooth', 'textureScale'],
  ],
  'crosshatching': [
    ['Angles', 'primaryAngle', 'secondaryAngle', 'thirdAngle', 'fourthAngle', 'directionalVariation'],
    ['Lines', 'lineThickness', 'lineSpacing', 'hatchDensity', 'toneSensitivity', 'edgePreservation'],
    ['Appearance', 'lineColor', 'bgColor'],
  ],
  'dithering': [
    ['Algorithm', 'algorithm', 'cellSize', 'ditherIntensity', 'patternScale'],
    ['Palette', 'palette', 'numColors', 'colorMode'],
    ['Image', 'threshold', 'contrast', 'brightness'],
  ],
  'chromatic-aberration': [
    ['Channel Offsets', 'redOffsetX', 'redOffsetY', 'greenOffsetX', 'greenOffsetY', 'blueOffsetX', 'blueOffsetY', 'separationDistance', 'direction'],
    ['Optics', 'radialIntensity', 'centerX', 'centerY', 'edgeFalloff', 'radius'],
    ['Blend', 'blendIntensity'],
  ],
  'ink-bleed': [
    ['Bleed', 'bleedAmount', 'spreadRadius', 'diffusionStrength', 'edgeExpansion'],
    ['Direction & Organic', 'directionalDistortion', 'organicVariation', 'fiberInfluence'],
    ['Pigment & Paper', 'pigmentDensity', 'paperAbsorption', 'edgeDarkening', 'colorBleeding'],
  ],
  'cmyk': [
    ['Plate Offsets', 'cyanOffsetX', 'cyanOffsetY', 'magentaOffsetX', 'magentaOffsetY', 'yellowOffsetX', 'yellowOffsetY', 'blackOffsetX', 'blackOffsetY'],
    ['Press', 'channelIntensity', 'registrationError', 'channelBlur', 'inkDensity'],
    ['Separation', 'colorSeparationStrength', 'bgColor'],
  ],
  'linocut': [
    ['Carving', 'carvingDensity', 'lineThickness', 'carvingDirection', 'carvingDetail'],
    ['Tone', 'contrast', 'threshold', 'mode'],
    ['Finish', 'edgeRoughness', 'textureIntensity', 'inkColor', 'paperColor'],
  ],
  'woodcut': [
    ['Grain', 'woodGrainDirection', 'grainScale'],
    ['Engraving', 'engravingDensity', 'lineThickness', 'lineSpacing', 'directionalVariation', 'carvingDepth'],
    ['Tone & Finish', 'contrast', 'edgeIrregularity', 'inkColor', 'bgColor'],
  ],
  'paper-grain': [
    ['Grain', 'grainIntensity', 'grainScale', 'paperRoughness', 'fiberDensity', 'surfaceVariation', 'textureContrast'],
    ['Distress', 'paperAging', 'stains', 'scratches', 'edgeWear'],
    ['Base', 'paperColor'],
  ],
  'oil-paint': [
    ['Brushstroke', 'brushstrokeSize', 'brushstrokeDirection', 'strokeLength', 'brushstrokeDensity'],
    ['Impasto', 'paintThickness', 'impastoDepth', 'surfaceRelief', 'lightingIntensity'],
    ['Surface', 'surfaceRoughness', 'canvasTexture', 'textureScale', 'colorVariation'],
  ],
  'charcoal': [
    ['Grain', 'charcoalGrain', 'grainScale', 'strokeVariation'],
    ['Smudge', 'smudgeIntensity', 'smudgeRadius', 'softness', 'edgeRoughness'],
    ['Tone & Paper', 'contrast', 'powderDensity', 'paperTexture', 'blackIntensity', 'highlightPreservation'],
  ],
  'stippling': [
    ['Dots', 'dotDensity', 'minDotSize', 'maxDotSize', 'dotSizeVariation', 'dotColor'],
    ['Distribution', 'distributionRandomness', 'distributionScale', 'clustering'],
    ['Tone & Edge', 'toneSensitivity', 'edgePreservation', 'bgColor'],
  ],
  'dry-brush': [
    ['Stroke', 'brushSize', 'brushDirection', 'strokeLength', 'strokeIrregularity', 'brokenCoverage'],
    ['Bristle', 'bristleTexture', 'edgeRoughness', 'grainIntensity'],
    ['Paint & Surface', 'paintDensity', 'colorVariation', 'textureScale', 'surfaceTexture'],
  ],
  'glitch-art': [
    ['Blocks', 'blockSize', 'blockFrequency', 'horizontalDisplacement', 'verticalDisplacement', 'distortionDirection', 'distortionStrength'],
    ['Channels & Noise', 'rgbDisplacement', 'channelSeparation', 'noiseAmount', 'scanlineIntensity'],
    ['Color', 'colorShift'],
  ],
  'contour': [
    ['Detection', 'algorithm', 'edgeThreshold', 'edgeSensitivity', 'detailLevel', 'noiseReduction', 'smoothing'],
    ['Line', 'edgeThickness', 'lineColor', 'invert'],
    ['Background', 'bgColor', 'transparentBackground'],
  ],
  'posterization': [
    ['Levels', 'tonalLevels', 'colorReduction', 'colorMode', 'colorPalette'],
    ['Tone', 'contrast', 'brightness', 'saturation', 'threshold', 'highlightControl', 'shadowControl'],
    ['Refinement', 'edgePreservation', 'ditherIntegration'],
  ],
  'color-halation': [
    ['Glow', 'highlightThreshold', 'glowRadius', 'spreadAmount', 'glowIntensity', 'falloff'],
    ['Color', 'halationColor', 'colorSaturation', 'colorVariation'],
    ['Blend & Core', 'blendIntensity', 'edgeSoftness', 'highlightPreservation', 'highlightMask'],
  ],
};

/* =========================================================
   built-in presetler (Bölüm 5)
   ---------------------------------------------------------
   Preset = { name, p: { key: değer } } — kısmi override;
   eksik anahtarlar şema varsayılanından gelir (complete
   configuration birleşimde garanti edilir).
   ========================================================= */

const INK_FX_PRESETS = {
  'halftone': [
    { name: 'Classic Comic', p: { dotSize: 16, dotSpacing: 20, dotAngle: 45, contrast: 1.4, threshold: 0.85, colorMode: 'mono', dotColor: '#111111' } },
    { name: 'Fine Newspaper', p: { dotSize: 6, dotSpacing: 8, dotAngle: 75, contrast: 1.1, threshold: 0.95, tonalSensitivity: 1.4 } },
    { name: 'Large Graphic Dots', p: { dotSize: 40, dotSpacing: 52, dotAngle: 15, contrast: 1.8, threshold: 0.75, dotShape: 'square' } },
    { name: 'Vintage Manga', p: { dotSize: 10, dotSpacing: 14, dotAngle: 30, brightness: 0.08, threshold: 0.9, dotColor: '#2b2b35' } },
  ],
  'risograph': [
    { name: 'Two-Color Print', p: { inkCount: 2, ink1Color: '#0078bf', ink2Color: '#ffe800', regOffsetX: 2, regOffsetY: -1, colorSeparation: 0.8, inkDensity: 1.1, inkOpacity: 1, paperGrain: 0.5 } },
    { name: 'Retro Poster', p: { inkCount: 3, contrast: 1.3, inkDensity: 1.2, printImperfections: 0.5, colorMixing: 0.4 } },
    { name: 'Misregistered Ink', p: { regOffsetX: 6, regOffsetY: -4, regIrregularity: 0.8, channelOffset: 0.6 } },
    { name: 'Experimental Layers', p: { inkCount: 4, inkOpacity: 0.55, colorOverlap: 0.9, inkBleeding: 0.7, inkSaturation: 1.3 } },
  ],
  'watercolor': [
    { name: 'Soft Wash', p: { pigmentDensity: 0.35, waterSpread: 0.8, wetness: 0.8, transparency: 0.75, edgeDarkening: 0.2 } },
    { name: 'Granulated Pigment', p: { pigmentGranulation: 0.9, pigmentPooling: 0.6, waterSpread: 0.4, paperTexture: 0.7 } },
    { name: 'Heavy Pigment', p: { pigmentDensity: 0.95, pigmentDiffusion: 0.3, transparency: 0.25, edgeDarkening: 0.7 } },
    { name: 'Wet-on-Wet', p: { wetness: 1, bleeding: 0.9, edgeDiffusion: 0.85, absorption: 0.8, pigmentVariation: 0.6 } },
  ],
  'colored-pencil': [
    { name: 'Fine Pencil', p: { pencilGrain: 0.4, paperTooth: 0.5, strokeDensity: 2, pencilHardness: 0.85, pigmentCoverage: 0.35 } },
    { name: 'Rough Sketch', p: { pencilGrain: 0.9, paperTooth: 0.9, strokeIrregularity: 0.8, pressureVariation: 0.8, pencilHardness: 0.3 } },
    { name: 'Dense Pigment', p: { pigmentCoverage: 0.95, layeredPigment: 0.9, strokeDensity: 5, pencilHardness: 0.55 } },
    { name: 'Soft Coloring', p: { pencilHardness: 0.25, pigmentCoverage: 0.6, colorVariation: 0.4, pencilGrain: 0.55 } },
  ],
  'crosshatching': [
    { name: 'Classic Etching', p: { primaryAngle: 45, secondaryAngle: 135, hatchDensity: 0.7, lineThickness: 1 } },
    { name: 'Loose Sketch', p: { lineSpacing: 14, hatchDensity: 0.4, directionalVariation: 0.6, lineThickness: 2 } },
    { name: 'Dense Shading', p: { hatchDensity: 1, lineSpacing: 6, thirdAngle: 75, toneSensitivity: 1.4 } },
  ],
  'dithering': [
    /* colorMode 'color' olmadan palet yok sayılır (mono ezer) */
    { name: 'Retro CGA', p: { palette: 'cga', colorMode: 'color', cellSize: 2 } },
    { name: 'Gameboy Green', p: { palette: 'gameboy', colorMode: 'color', algorithm: 'bayer', cellSize: 2 } },
    { name: 'Stucki Fine', p: { algorithm: 'stucki', palette: 'mono', cellSize: 1 } },
    { name: 'Bayer Poster', p: { algorithm: 'bayer', palette: 'levels', colorMode: 'color', numColors: 4, cellSize: 1 } },
  ],
  'chromatic-aberration': [
    { name: 'Subtle Lens', p: { separationDistance: 4, radialIntensity: 0.9, edgeFalloff: 0.8, blendIntensity: 0.6 } },
    { name: 'Anaglyph', p: { redOffsetX: 14, blueOffsetX: -14, radialIntensity: 0, separationDistance: 0, blendIntensity: 1 } },
    { name: 'Wide Split', p: { separationDistance: 28, radialIntensity: 0.7, edgeFalloff: 0.4 } },
  ],
  'ink-bleed': [
    { name: 'Fine Nib', p: { bleedAmount: 0.25, spreadRadius: 2, diffusionStrength: 0.3, edgeDarkening: 0.5 } },
    { name: 'Wet Ink', p: { bleedAmount: 0.8, spreadRadius: 8, diffusionStrength: 0.8, paperAbsorption: 0.7 } },
    { name: 'Blotting Paper', p: { bleedAmount: 0.6, spreadRadius: 5, paperAbsorption: 1, organicVariation: 0.8, fiberInfluence: 0.7 } },
  ],
  'cmyk': [
    { name: 'Tight Press', p: { registrationError: 0.5, channelBlur: 0.5, inkDensity: 1.1 } },
    { name: 'Vintage Offset', p: { registrationError: 6, channelBlur: 2, inkDensity: 0.85, colorSeparationStrength: 0.9 } },
    { name: 'Bold Posters', p: { registrationError: 10, channelBlur: 1.5, inkDensity: 1.35, channelIntensity: 1.2 } },
  ],
  'linocut': [
    { name: 'Bold Cut', p: { carvingDensity: 3, lineThickness: 3, threshold: 0.5, contrast: 1.5 } },
    { name: 'Fine Engraving', p: { carvingDensity: 7, lineThickness: 1, carvingDetail: 0.9, contrast: 1.1 } },
    { name: 'Rough Block', p: { edgeRoughness: 0.85, textureIntensity: 0.8, carvingDensity: 4, contrast: 1.3 } },
  ],
  'woodcut': [
    { name: 'Dürer Line', p: { engravingDensity: 7, lineSpacing: 6, lineThickness: 1, carvingDepth: 0.8 } },
    { name: 'Bold Block', p: { engravingDensity: 3, lineSpacing: 14, lineThickness: 2.5, contrast: 1.4 } },
    { name: 'End Grain', p: { grainScale: 2, engravingDensity: 6, directionalVariation: 0.1, edgeIrregularity: 0.5 } },
  ],
  'paper-grain': [
    { name: 'Fresh Sketchbook', p: { grainIntensity: 0.3, paperRoughness: 0.2, paperAging: 0.05, stains: 0, scratches: 0, edgeWear: 0.05 } },
    { name: 'Old Letter', p: { paperAging: 0.8, stains: 0.6, grainIntensity: 0.5, paperColor: '#efe4c8' } },
    { name: 'Heavy Distress', p: { scratches: 0.9, edgeWear: 0.9, stains: 0.7, surfaceVariation: 0.7, paperRoughness: 0.7 } },
  ],
  'oil-paint': [
    { name: 'Impasto Bold', p: { brushstrokeSize: 18, paintThickness: 0.9, impastoDepth: 0.9, lightingIntensity: 0.85, surfaceRelief: 0.8 } },
    { name: 'Smooth Blend', p: { brushstrokeSize: 14, paintThickness: 0.3, impastoDepth: 0.15, surfaceRoughness: 0.2, brushstrokeDensity: 6 } },
    { name: 'Palette Knife', p: { brushstrokeSize: 26, strokeLength: 50, brushstrokeDensity: 2, surfaceRoughness: 0.8, colorVariation: 0.4 } },
  ],
  'charcoal': [
    { name: 'Crisp Stick', p: { charcoalGrain: 0.4, smudgeIntensity: 0.1, softness: 0.25, contrast: 1.35 } },
    { name: 'Soft Smudge', p: { smudgeIntensity: 0.8, smudgeRadius: 16, softness: 0.85, charcoalGrain: 0.3 } },
    { name: 'Newsprint Sketch', p: { charcoalGrain: 0.9, powderDensity: 0.6, paperTexture: 0.8, strokeVariation: 0.7 } },
  ],
  'stippling': [
    { name: 'Fine Pen', p: { dotDensity: 0.45, minDotSize: 0.6, maxDotSize: 2.4, distributionScale: 0.8 } },
    { name: 'Bold Pointillism', p: { dotDensity: 0.65, minDotSize: 2, maxDotSize: 6.5, dotSizeVariation: 0.7, clustering: 0.3 } },
    { name: 'Scientific Plate', p: { distributionRandomness: 0.15, dotSizeVariation: 0.15, toneSensitivity: 1.4, edgePreservation: 0.5 } },
  ],
  'dry-brush': [
    { name: 'Watercolor Dry', p: { brushSize: 18, brokenCoverage: 0.7, bristleTexture: 0.8, paintDensity: 0.5 } },
    { name: 'Oil Scrub', p: { brushSize: 26, brushDirection: 10, brokenCoverage: 0.4, paintDensity: 0.9, grainIntensity: 0.3 } },
    { name: 'Rough Edge', p: { brushSize: 12, edgeRoughness: 0.9, strokeIrregularity: 0.8, grainIntensity: 0.8 } },
  ],
  'glitch-art': [
    { name: 'Signal Fault', p: { blockFrequency: 0.25, blockSize: 40, rgbDisplacement: 8, scanlineIntensity: 0.5 } },
    { name: 'Datamosh', p: { blockFrequency: 0.8, blockSize: 12, horizontalDisplacement: 48, distortionStrength: 0.9, noiseAmount: 0.4 } },
    { name: 'VHS Tracking', p: { horizontalDisplacement: 30, verticalDisplacement: 6, scanlineIntensity: 0.8, noiseAmount: 0.5, colorShift: 18 } },
  ],
  'contour': [
    { name: 'Clean Line', p: { algorithm: 'sobel', edgeThreshold: 0.12, edgeThickness: 2, smoothing: 0.1, noiseReduction: 0.55, lineColor: '#0f0f0f' } },
    { name: 'Canny Precise', p: { algorithm: 'canny', edgeThreshold: 0.35, noiseReduction: 0.5, edgeThickness: 1 } },
    { name: 'Sketch Contour', p: { algorithm: 'laplacian', edgeThreshold: 0.1, edgeThickness: 2, smoothing: 0.35, noiseReduction: 0.25, lineColor: '#33415c' } },
  ],
  'posterization': [
    { name: 'Flat 4 Tones', p: { tonalLevels: 4, colorReduction: 0.4, edgePreservation: 0.2 } },
    { name: 'Screen Print', p: { tonalLevels: 3, colorMode: 'mono', contrast: 1.3, ditherIntegration: 0.3 } },
    { name: 'Warm Pop', p: { tonalLevels: 6, colorPalette: 'warm', saturation: 1.4, colorReduction: 0.6 } },
  ],
  'color-halation': [
    { name: 'Cine Red', p: { highlightThreshold: 0.78, glowRadius: 22, halationColor: '#ff5a3c', glowIntensity: 0.7 } },
    { name: 'Dream Bloom', p: { highlightThreshold: 0.6, glowRadius: 40, spreadAmount: 0.8, glowIntensity: 0.9, halationColor: '#ffd9a0' } },
    { name: 'Subtle Film', p: { highlightThreshold: 0.85, glowRadius: 12, glowIntensity: 0.35, blendIntensity: 0.5 } },
  ],
};
