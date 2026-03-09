import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, RefreshCcw, Sliders, Sun, Thermometer, Droplet, Contrast, Palette, Image as ImageIcon, SplitSquareHorizontal, Crop as CropIcon, Layers, SunDim, Moon, SaveAll, ChevronDown, ChevronUp, Sparkles, RotateCw, Maximize2, Minimize2 } from 'lucide-react';
import UTIF from 'utif';
import ReactCrop, { Crop, PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

import { FilmType, Adjustments, defaultAdjustments, ImageItem } from './types';
import { calculateLevels, processImageData, calculateAutoWhiteBalance, calculateHistogram } from './utils/imageProcessing';
import { parseCubeLUT } from './utils/lutParser';
import { SliderControl } from './components/SliderControl';
import { ImageItemCard } from './components/ImageItemCard';
import { Histogram } from './components/Histogram';
import { FILM_PRESETS } from './constants/presets';

export default function App() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [isPresetsOpen, setIsPresetsOpen] = useState(false);
  const [zoomMode, setZoomMode] = useState<'fit' | 'original'>('fit');
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [originalImageData, setOriginalImageData] = useState<ImageData | null>(null);
  const [levels, setLevels] = useState<any>(null);
  const [histogramData, setHistogramData] = useState<{r: number[], g: number[], b: number[]} | null>(null);

  const selectedImage = images.find(img => img.id === selectedId);
  const adjustments = selectedImage?.adjustments || defaultAdjustments;

  const updateAdjustments = (newAdj: Partial<Adjustments>) => {
    if (!selectedId) return;
    setImages(prev => prev.map(img => 
      img.id === selectedId ? { ...img, adjustments: { ...img.adjustments, ...newAdj } } : img
    ));
  };

  const updateCrop = (crop: Crop, percentCrop: Crop) => {
    if (!selectedId) return;
    setImages(prev => prev.map(img => 
      img.id === selectedId ? { ...img, crop: percentCrop } : img
    ));
  };

  const updateCropAspect = (aspect: number | undefined) => {
    if (!selectedId) return;
    setImages(prev => prev.map(img => 
      img.id === selectedId ? { ...img, cropAspect: aspect, crop: undefined } : img
    ));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newImages: ImageItem[] = [];

    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const isTiffOrRaw = ['tif', 'tiff', 'dng', 'cr2', 'nef', 'arw'].includes(ext);

      let src = '';
      if (isTiffOrRaw) {
        const buff = await file.arrayBuffer();
        try {
          const ifds = UTIF.decode(buff);
          let vsns = ifds, ma = 0, page = vsns[0];
          if (ifds[0].subIFD) vsns = vsns.concat(ifds[0].subIFD);
          
          for (let i = 0; i < vsns.length; i++) {
            const img = vsns[i];
            if (img["t258"] == null || img["t258"].length < 3) continue;
            const ar = img["t256"] * img["t257"];
            if (ar > ma) { ma = ar; page = img; }
          }
          
          UTIF.decodeImage(buff, page, ifds);
          const rgba = UTIF.toRGBA8(page);
          const w = page.width;
          const h = page.height;
          
          const cnv = document.createElement("canvas");
          cnv.width = w;
          cnv.height = h;
          const ctx = cnv.getContext("2d");
          if (ctx) {
            const imgd = ctx.createImageData(w, h);
            for (let i = 0; i < rgba.length; i++) imgd.data[i] = rgba[i];
            ctx.putImageData(imgd, 0, 0);
            src = cnv.toDataURL("image/jpeg", 0.95);
          }
        } catch (err) {
          console.error("Error decoding TIFF/RAW:", err);
          continue;
        }
      } else {
        src = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.readAsDataURL(file);
        });
      }

      if (src) {
        newImages.push({
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          src,
          adjustments: { ...defaultAdjustments }
        });
      }
    }

    setImages(prev => [...prev, ...newImages]);
    if (!selectedId && newImages.length > 0) {
      setSelectedId(newImages[0].id);
    }
  };

  const handleLutUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const lut = await parseCubeLUT(file);
      updateAdjustments({ lut });
    } catch (err) {
      alert('Failed to parse LUT: ' + (err as Error).message);
    }
    e.target.value = '';
  };

  useEffect(() => {
    if (!selectedImage) {
      setOriginalImageData(null);
      setLevels(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 1600;
      let width = img.width;
      let height = img.height;
      
      if (width > MAX_WIDTH) {
        height = Math.round((height * MAX_WIDTH) / width);
        width = MAX_WIDTH;
      }
      
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      setOriginalImageData(imageData);
      
      const isNeg = selectedImage.adjustments.filmType === 'color_neg' || selectedImage.adjustments.filmType === 'bw_neg';
      setLevels(calculateLevels(imageData.data, isNeg));
    };
    img.src = selectedImage.src;
  }, [selectedImage?.src]);

  useEffect(() => {
    if (!originalImageData) return;
    const isNeg = adjustments.filmType === 'color_neg' || adjustments.filmType === 'bw_neg';
    setLevels(calculateLevels(originalImageData.data, isNeg));
  }, [adjustments.filmType, originalImageData]);

  const handleRotate = () => {
    if (!selectedId) return;
    const newRotation = (adjustments.rotation + 90) % 360;
    setImages(prev => prev.map(img => 
      img.id === selectedId ? { ...img, adjustments: { ...img.adjustments, rotation: newRotation }, crop: undefined } : img
    ));
  };

  useEffect(() => {
    if (!originalImageData || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const rotation = adjustments.rotation;
    const isRotated90 = rotation === 90 || rotation === 270;

    // 1. Process pixels
    const processedData = processImageData(
      originalImageData.data,
      originalImageData.width,
      originalImageData.height,
      adjustments,
      levels
    );

    // 2. Create a temporary canvas for the processed full image
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = originalImageData.width;
    tempCanvas.height = originalImageData.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;
    tempCtx.putImageData(processedData, 0, 0);

    // 3. Handle Rotation and Cropping
    let finalWidth = originalImageData.width;
    let finalHeight = originalImageData.height;
    if (isRotated90) {
      finalWidth = originalImageData.height;
      finalHeight = originalImageData.width;
    }

    // If comparing, show original (unrotated, uncropped)
    if (isComparing) {
      canvasRef.current.width = originalImageData.width;
      canvasRef.current.height = originalImageData.height;
      ctx.putImageData(originalImageData, 0, 0);
      return;
    }

    const drawRotated = (targetCtx: CanvasRenderingContext2D, source: HTMLCanvasElement | HTMLImageElement, w: number, h: number, rot: number) => {
      targetCtx.save();
      targetCtx.translate(w / 2, h / 2);
      targetCtx.rotate((rot * Math.PI) / 180);
      if (rot === 90 || rot === 270) {
        targetCtx.drawImage(source, -h / 2, -w / 2);
      } else {
        targetCtx.drawImage(source, -w / 2, -h / 2);
      }
      targetCtx.restore();
    };

    if (isCropping || !selectedImage?.crop || selectedImage.crop.width === 0 || selectedImage.crop.height === 0) {
      canvasRef.current.width = finalWidth;
      canvasRef.current.height = finalHeight;
      drawRotated(ctx, tempCanvas, finalWidth, finalHeight, rotation);
    } else {
      const crop = selectedImage.crop;
      const scaleX = finalWidth / 100;
      const scaleY = finalHeight / 100;
      
      const croppedWidth = crop.width * scaleX;
      const croppedHeight = crop.height * scaleY;
      
      canvasRef.current.width = croppedWidth;
      canvasRef.current.height = croppedHeight;

      // Draw full rotated image to a buffer first to then crop it
      const rotatedBuffer = document.createElement('canvas');
      rotatedBuffer.width = finalWidth;
      rotatedBuffer.height = finalHeight;
      const rbCtx = rotatedBuffer.getContext('2d');
      if (rbCtx) {
        drawRotated(rbCtx, tempCanvas, finalWidth, finalHeight, rotation);
        ctx.drawImage(
          rotatedBuffer,
          crop.x * scaleX,
          crop.y * scaleY,
          croppedWidth,
          croppedHeight,
          0,
          0,
          croppedWidth,
          croppedHeight
        );
      }
    }
    
    // 4. Histogram
    if (!isComparing) {
      const currentData = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
      setHistogramData(calculateHistogram(currentData));
    }
  }, [originalImageData, adjustments, levels, isComparing, isCropping, selectedImage?.crop]);

  const getCroppedCanvas = (canvas: HTMLCanvasElement, crop: Crop) => {
    if (!crop || crop.width === 0 || crop.height === 0) return canvas;
    const croppedCanvas = document.createElement('canvas');
    
    // crop is in percentages
    const scaleX = canvas.width / 100;
    const scaleY = canvas.height / 100;
    
    croppedCanvas.width = crop.width * scaleX;
    croppedCanvas.height = crop.height * scaleY;
    const ctx = croppedCanvas.getContext('2d');
    if (!ctx) return canvas;
    
    ctx.drawImage(
      canvas,
      crop.x * scaleX,
      crop.y * scaleY,
      crop.width * scaleX,
      crop.height * scaleY,
      0,
      0,
      crop.width * scaleX,
      crop.height * scaleY
    );
    return croppedCanvas;
  };

  const handleAutoWhiteBalance = () => {
    if (!originalImageData || !selectedImage) return;
    const isNeg = adjustments.filmType === 'color_neg' || adjustments.filmType === 'bw_neg';
    const wbOffsets = calculateAutoWhiteBalance(originalImageData.data, isNeg, adjustments.autoMask, levels);
    updateAdjustments({
      rOffset: wbOffsets.rOffset,
      gOffset: wbOffsets.gOffset,
      bOffset: wbOffsets.bOffset,
      temperature: 0,
      tint: 0
    });
  };

  const handleDownload = () => {
    if (!canvasRef.current || !selectedImage) return;
    
    // If we are currently cropping, canvasRef.current is the full image, so we need to crop it.
    // If we are NOT cropping, canvasRef.current is ALREADY cropped by the useEffect.
    const finalCanvas = (isCropping && selectedImage.crop) 
      ? getCroppedCanvas(canvasRef.current, selectedImage.crop as Crop) 
      : canvasRef.current;
      
    const link = document.createElement('a');
    link.download = `processed-${selectedImage.name}.jpg`;
    link.href = finalCanvas.toDataURL('image/jpeg', 0.95);
    link.click();
  };

  const handleBatchDownload = async () => {
    if (images.length === 0) return;
    const zip = new JSZip();
    
    for (const imgItem of images) {
       const img = new Image();
       await new Promise((resolve) => {
         img.onload = resolve;
         img.src = imgItem.src;
       });
       
       const canvas = document.createElement('canvas');
       const MAX_WIDTH = 1600;
       let width = img.width;
       let height = img.height;
       if (width > MAX_WIDTH) {
         height = Math.round((height * MAX_WIDTH) / width);
         width = MAX_WIDTH;
       }
       canvas.width = width;
       canvas.height = height;
       const ctx = canvas.getContext('2d');
       if (!ctx) continue;
       ctx.drawImage(img, 0, 0, width, height);
       const imageData = ctx.getImageData(0, 0, width, height);
       
       const isNeg = imgItem.adjustments.filmType === 'color_neg' || imgItem.adjustments.filmType === 'bw_neg';
       const imgLevels = calculateLevels(imageData.data, isNeg);
       
       const processedData = processImageData(
         imageData.data,
         width,
         height,
         imgItem.adjustments,
         imgLevels
       );
       ctx.putImageData(processedData, 0, 0);
       
       const finalCanvas = imgItem.crop ? getCroppedCanvas(canvas, imgItem.crop as Crop) : canvas;
       
       const blob = await new Promise<Blob | null>(resolve => finalCanvas.toBlob(resolve, 'image/jpeg', 0.95));
       if (blob) {
         zip.file(`processed-${imgItem.name}.jpg`, blob);
       }
    }
    
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'filmlab-batch.zip');
  };

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
    if (selectedId === id) {
      setSelectedId(images.length > 1 ? images.find(img => img.id !== id)?.id || null : null);
    }
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Left Sidebar: Image List */}
      <div className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <ImageIcon className="w-5 h-5" />
            FilmLab Web
          </h1>
        </div>
        
        <div className="p-4 border-b border-zinc-800">
          <label className="flex items-center justify-center gap-2 w-full py-2 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors text-sm font-medium cursor-pointer">
            <Upload className="w-4 h-4" />
            Import Images
            <input type="file" multiple className="hidden" accept="image/*,.tif,.tiff,.dng,.cr2,.nef,.arw,.bmp" onChange={handleFileUpload} />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {images.map(img => (
            <ImageItemCard 
              key={img.id} 
              item={img} 
              isSelected={selectedId === img.id} 
              onSelect={() => setSelectedId(img.id)} 
              onRemove={() => removeImage(img.id)}
            />
          ))}
          {images.length === 0 && (
            <div className="text-center text-zinc-500 text-sm mt-8 px-4">
              No images imported. Click above to add some.
            </div>
          )}
        </div>

        {images.length > 0 && (
          <div className="p-4 border-t border-zinc-800">
            <button
              onClick={handleBatchDownload}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              <SaveAll className="w-4 h-4" />
              Batch Export All
            </button>
          </div>
        )}
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col bg-zinc-950 relative">
        {/* Toolbar */}
        <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-6">
          <div className="flex items-center gap-2">
            {!isCropping && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsCropping(true)}
                  disabled={!selectedImage}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 disabled:opacity-50"
                >
                  <CropIcon className="w-4 h-4" />
                  Crop
                </button>
                <button
                  onClick={handleRotate}
                  disabled={!selectedImage}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 disabled:opacity-50"
                  title="Rotate 90°"
                >
                  <RotateCw className="w-4 h-4" />
                  Rotate
                </button>
                <button
                  onClick={() => setZoomMode(zoomMode === 'fit' ? 'original' : 'fit')}
                  disabled={!selectedImage}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors text-sm font-medium border ${zoomMode === 'original' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'} disabled:opacity-50`}
                  title={zoomMode === 'fit' ? 'Actual Size' : 'Fit to Screen'}
                >
                  {zoomMode === 'fit' ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
                  {zoomMode === 'fit' ? 'Fit' : '1:1'}
                </button>
              </div>
            )}
            {isCropping && (
              <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-md border border-zinc-800">
                <span className="text-xs text-zinc-500 px-2 font-medium">Aspect Ratio:</span>
                <button onClick={() => updateCropAspect(undefined)} className={`px-2 py-1 text-xs font-medium rounded transition-colors ${!selectedImage?.cropAspect ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>Free</button>
                <button onClick={() => updateCropAspect(1)} className={`px-2 py-1 text-xs font-medium rounded transition-colors ${selectedImage?.cropAspect === 1 ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>1:1</button>
                <button onClick={() => updateCropAspect(4/3)} className={`px-2 py-1 text-xs font-medium rounded transition-colors ${selectedImage?.cropAspect === 4/3 ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>4:3</button>
                <button onClick={() => updateCropAspect(3/2)} className={`px-2 py-1 text-xs font-medium rounded transition-colors ${selectedImage?.cropAspect === 3/2 ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>3:2</button>
                <button onClick={() => updateCropAspect(16/9)} className={`px-2 py-1 text-xs font-medium rounded transition-colors ${selectedImage?.cropAspect === 16/9 ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>16:9</button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            {isCropping ? (
              <>
                <button
                  onClick={() => {
                    updateCrop(undefined as any, undefined as any);
                    setIsCropping(false);
                  }}
                  className="flex items-center gap-2 px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md transition-colors text-sm font-medium border border-zinc-700"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setIsCropping(false)}
                  className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors text-sm font-medium"
                >
                  Confirm Crop
                </button>
              </>
            ) : (
              <>
                <button
                  onMouseDown={() => setIsComparing(true)}
                  onMouseUp={() => setIsComparing(false)}
                  onMouseLeave={() => setIsComparing(false)}
                  onTouchStart={() => setIsComparing(true)}
                  onTouchEnd={() => setIsComparing(false)}
                  disabled={!selectedImage}
                  className="flex items-center gap-2 px-4 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-md transition-colors text-sm font-medium border border-zinc-800 select-none disabled:opacity-50"
                >
                  <SplitSquareHorizontal className="w-4 h-4" />
                  Hold to Compare
                </button>
                <button
                  onClick={handleDownload}
                  disabled={!selectedImage}
                  className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-md transition-colors text-sm font-medium"
                >
                  <Download className="w-4 h-4" />
                  Save Current
                </button>
              </>
            )}
          </div>
        </div>

        {/* Canvas Container */}
        <div className={`flex-1 overflow-auto flex items-center justify-center p-8 ${zoomMode === 'original' ? 'cursor-move' : ''}`}>
          {!selectedImage ? (
            <div className="text-center text-zinc-500">
              <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p>Select or upload an image to start processing</p>
            </div>
          ) : (
            <div className={`relative flex items-center justify-center ${zoomMode === 'fit' ? 'max-w-full max-h-full' : ''}`}>
              <ReactCrop 
                crop={selectedImage.crop} 
                onChange={(c, pc) => updateCrop(c, pc)}
                className={zoomMode === 'fit' ? 'max-w-full max-h-full' : ''}
                disabled={!isCropping}
                locked={!isCropping}
                style={{ display: isCropping ? 'block' : 'none' }}
                ruleOfThirds={true}
                aspect={selectedImage.cropAspect}
              >
                <canvas
                  ref={isCropping ? canvasRef : null}
                  className={`${zoomMode === 'fit' ? 'max-w-full max-h-full object-contain' : ''} shadow-2xl rounded-sm`}
                  style={{ backgroundImage: 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYDCgBDAm9BGDWAAJyEgSRC0AQAK9CGVG3UW0AAAAABJRU5ErkJggg==")' }}
                />
              </ReactCrop>
              <canvas
                ref={!isCropping ? canvasRef : null}
                className={`${zoomMode === 'fit' ? 'max-w-full max-h-full object-contain' : ''} shadow-2xl rounded-sm`}
                style={{ display: isCropping ? 'none' : 'block', backgroundImage: 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYDCgBDAm9BGDWAAJyEgSRC0AQAK9CGVG3UW0AAAAABJRU5ErkJggg==")' }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Right Sidebar: Adjustments */}
      <div className="w-80 bg-zinc-900 border-l border-zinc-800 flex flex-col overflow-y-auto">
        {/* Histogram */}
        <div className="p-4 border-b border-zinc-800">
          <Histogram data={histogramData} />
        </div>

        {/* Adjustments Panel */}
        <div className="p-6 space-y-8 flex-1">
          {/* Film Type & Auto Mask (Always visible) */}
          <div className="space-y-4">
            <div className="space-y-3">
              <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                <Sliders className="w-4 h-4" />
                Film Type
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['color_neg', 'bw_neg', 'positive'] as FilmType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => updateAdjustments({ filmType: type })}
                    className={`px-2 py-2 text-xs font-medium rounded-lg transition-colors ${
                      adjustments.filmType === type
                        ? 'bg-indigo-600 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    {type === 'color_neg' ? 'Color Neg' : type === 'bw_neg' ? 'B&W Neg' : 'Positive'}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2">
              <button 
                onClick={() => setIsPresetsOpen(!isPresetsOpen)}
                className="flex items-center justify-between w-full text-sm font-medium text-zinc-300 hover:text-zinc-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  Film Presets
                </div>
                {isPresetsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              
              {isPresetsOpen && (
                <div className="grid grid-cols-1 gap-2 mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
                  {FILM_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      onClick={() => updateAdjustments({ ...defaultAdjustments, ...preset.adjustments })}
                      className="text-left p-2 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 transition-all group"
                    >
                      <p className="text-xs font-semibold text-zinc-200 group-hover:text-indigo-400 transition-colors">{preset.name}</p>
                      <p className="text-[10px] text-zinc-500 line-clamp-1">{preset.description}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-zinc-800/50">
              <label className="text-sm font-medium text-zinc-300">Auto Remove Mask</label>
              <button
                onClick={() => updateAdjustments({ autoMask: !adjustments.autoMask })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  adjustments.autoMask ? 'bg-indigo-600' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    adjustments.autoMask ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="border-t border-zinc-800/50 pt-6 space-y-10">
            {/* LUT Section */}
            <div className="space-y-6">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">LUT</p>
              <div className="space-y-3">
                <label className="text-sm font-medium text-zinc-300 flex items-center justify-between">
                  <span>3D LUT (.cube)</span>
                  {adjustments.lut && (
                    <button onClick={() => updateAdjustments({ lut: null })} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                  )}
                </label>
                
                {!adjustments.lut ? (
                  <label className="flex items-center justify-center gap-2 w-full py-8 px-4 border-2 border-dashed border-zinc-700 hover:border-indigo-500 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-300 rounded-lg transition-colors cursor-pointer">
                    <Upload className="w-5 h-5" />
                    <span className="text-sm font-medium">Upload .cube file</span>
                    <input type="file" accept=".cube" className="hidden" onChange={handleLutUpload} />
                  </label>
                ) : (
                  <div className="p-4 bg-zinc-800 rounded-lg border border-zinc-700 flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-200 truncate pr-4">{adjustments.lut.name}</span>
                    <span className="text-xs text-zinc-500 shrink-0">{adjustments.lut.size}³</span>
                  </div>
                )}
              </div>

              {adjustments.lut && (
                <SliderControl label="Intensity" icon={<Layers className="w-4 h-4" />} value={adjustments.lutIntensity ?? 100} min={0} max={100} onChange={(v) => updateAdjustments({ lutIntensity: v })} />
              )}
            </div>

            {/* Basic Section */}
            <div className="pt-6 border-t border-zinc-800/50 space-y-6">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Basic</p>
              <SliderControl label="Exposure" icon={<Sun className="w-4 h-4" />} value={adjustments.exposure} min={-100} max={100} onChange={(v) => updateAdjustments({ exposure: v })} />
              <SliderControl label="Contrast" icon={<Contrast className="w-4 h-4" />} value={adjustments.contrast} min={-100} max={100} onChange={(v) => updateAdjustments({ contrast: v })} />
              
              <div className="grid grid-cols-1 gap-6 pt-2">
                <SliderControl label="Highlights" icon={<SunDim className="w-4 h-4" />} value={adjustments.highlights} min={-100} max={100} onChange={(v) => updateAdjustments({ highlights: v })} />
                <SliderControl label="Shadows" icon={<Moon className="w-4 h-4" />} value={adjustments.shadows} min={-100} max={100} onChange={(v) => updateAdjustments({ shadows: v })} />
                <SliderControl label="Whites" icon={<Sun className="w-4 h-4 text-zinc-400" />} value={adjustments.whites} min={-100} max={100} onChange={(v) => updateAdjustments({ whites: v })} />
                <SliderControl label="Blacks" icon={<Moon className="w-4 h-4 text-zinc-600" />} value={adjustments.blacks} min={-100} max={100} onChange={(v) => updateAdjustments({ blacks: v })} />
                <SliderControl label="Gamma" icon={<RefreshCcw className="w-4 h-4" />} value={adjustments.gamma} min={10} max={300} onChange={(v) => updateAdjustments({ gamma: v })} />
              </div>

              <SliderControl label="Saturation" icon={<Palette className="w-4 h-4" />} value={adjustments.saturation} min={-100} max={100} onChange={(v) => updateAdjustments({ saturation: v })} />
            </div>

            {/* Color Section */}
            <div className="pt-6 border-t border-zinc-800/50 space-y-6">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Color</p>
              <button
                onClick={handleAutoWhiteBalance}
                disabled={!selectedImage}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 rounded-lg transition-colors text-sm font-medium"
              >
                <RefreshCcw className="w-4 h-4" />
                Auto White Balance
              </button>
              <SliderControl label="Temperature" icon={<Thermometer className="w-4 h-4" />} value={adjustments.temperature} min={-100} max={100} onChange={(v) => updateAdjustments({ temperature: v })} />
              <SliderControl label="Tint" icon={<Droplet className="w-4 h-4" />} value={adjustments.tint} min={-100} max={100} onChange={(v) => updateAdjustments({ tint: v })} />
              
              <div className="pt-4 space-y-6">
                <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">RGB Channels</p>
                <SliderControl label="Red Offset" icon={<Layers className="w-4 h-4 text-red-400" />} value={adjustments.rOffset} min={-100} max={100} onChange={(v) => updateAdjustments({ rOffset: v })} />
                <SliderControl label="Green Offset" icon={<Layers className="w-4 h-4 text-green-400" />} value={adjustments.gOffset} min={-100} max={100} onChange={(v) => updateAdjustments({ gOffset: v })} />
                <SliderControl label="Blue Offset" icon={<Layers className="w-4 h-4 text-blue-400" />} value={adjustments.bOffset} min={-100} max={100} onChange={(v) => updateAdjustments({ bOffset: v })} />
              </div>
            </div>
          </div>
        </div>
        
        <div className="p-6 border-t border-zinc-800">
          <button
            onClick={() => updateAdjustments(defaultAdjustments)}
            disabled={!selectedImage}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 rounded-lg transition-colors text-sm font-medium"
          >
            <RefreshCcw className="w-4 h-4" />
            Reset Adjustments
          </button>
        </div>
      </div>
    </div>
  );
}
