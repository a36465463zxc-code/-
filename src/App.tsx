import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, RefreshCcw, Sliders, Sun, Thermometer, Droplet, Contrast, Palette, Image as ImageIcon, SplitSquareHorizontal, Crop as CropIcon, Layers, SunDim, Moon, SaveAll, ChevronDown, ChevronUp, Sparkles, RotateCw, Maximize2, Minimize2, Zap, Wind, Shield, X, Check, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import UTIF from 'utif';
import ReactCrop, { Crop, PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

import { FilmType, Adjustments, defaultAdjustments, ImageItem, LUT3D, HSLColor } from './types';
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
  const [compareMode, setCompareMode] = useState<'none' | 'split'>('none');
  const [splitPosition, setSplitPosition] = useState(50);
  const [isCropping, setIsCropping] = useState(false);
  const [isPresetsOpen, setIsPresetsOpen] = useState(false);
  const [exportConfig, setExportConfig] = useState({
    format: 'image/jpeg' as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/tiff',
    quality: 0.95,
  });
  const [isExportSettingsOpen, setIsExportSettingsOpen] = useState(false);
  const [zoomMode, setZoomMode] = useState<'fit' | 'original'>('fit');
  const [colorBalanceRange, setColorBalanceRange] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');
  const [availableLuts, setAvailableLuts] = useState<LUT3D[]>([]);
  const [mobileView, setMobileView] = useState<'gallery' | 'preview' | 'adjust'>('preview');
  const [sectionsOpen, setSectionsOpen] = useState({
    lut: false,
    basic: false,
    color: false,
    colorMix: false,
    colorBalance: false,
    detail: false,
    halation: false,
  });
  
  const [activeHslColor, setActiveHslColor] = useState<HSLColor>('reds');
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const [originalImageData, setOriginalImageData] = useState<ImageData | null>(null);
  const [levels, setLevels] = useState<any>(null);
  const [histogramData, setHistogramData] = useState<{r: number[], g: number[], b: number[], l: number[]} | null>(null);

  const selectedImage = images.find(img => img.id === selectedId);
  const adjustments = selectedImage?.adjustments || defaultAdjustments;

  const updateAdjustments = (newAdj: Partial<Adjustments>) => {
    if (!selectedId) return;
    setImages(prev => prev.map(img => 
      img.id === selectedId ? { ...img, adjustments: { ...img.adjustments, ...newAdj } } : img
    ));
  };

  const updateColorBalance = (range: 'shadows' | 'midtones' | 'highlights', channel: 'r' | 'g' | 'b', value: number) => {
    if (!selectedId) return;
    const currentCB = adjustments.colorBalance;
    updateAdjustments({
      colorBalance: {
        ...currentCB,
        [range]: {
          ...currentCB[range],
          [channel]: value
        }
      }
    });
  };

  const updateHsl = (color: HSLColor, channel: 'h' | 's' | 'l', value: number) => {
    if (!selectedId) return;
    const currentHsl = adjustments.hsl || defaultAdjustments.hsl!;
    updateAdjustments({
      hsl: {
        ...currentHsl,
        [color]: {
          ...currentHsl[color],
          [channel]: value
        }
      }
    });
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

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setIsUploading(true);
    setUploadProgress(0);

    const newImages: ImageItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const isTiffOrRaw = ['tif', 'tiff', 'dng', 'cr2', 'nef', 'arw', 'fff'].includes(ext);

      let src = '';
      if (isTiffOrRaw) {
        const buff = await file.arrayBuffer();
        try {
          const ifds = UTIF.decode(buff);
          let vsns = ifds, ma = 0, page = vsns[0];
          if (ifds[0].subIFD) vsns = vsns.concat(ifds[0].subIFD as any);
          
          for (let j = 0; j < vsns.length; j++) {
            const img = vsns[j] as any;
            if (img["t258"] == null || img["t258"].length < 3) continue;
            const ar = img["t256"] * img["t257"];
            if (ar > ma) { ma = ar; page = img; }
          }
          
          (UTIF as any).decodeImage(buff, page, ifds);
          const rgba = UTIF.toRGBA8(page);
          const w = (page as any).width;
          const h = (page as any).height;
          
          const cnv = document.createElement("canvas");
          cnv.width = w;
          cnv.height = h;
          const ctx = cnv.getContext("2d");
          if (ctx) {
            const imgd = ctx.createImageData(w, h);
            for (let k = 0; k < rgba.length; k++) imgd.data[k] = rgba[k];
            ctx.putImageData(imgd, 0, 0);
            src = cnv.toDataURL("image/png");
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
      setUploadProgress(Math.round(((i + 1) / files.length) * 100));
    }

    setImages(prev => [...prev, ...newImages]);
    if (!selectedId && newImages.length > 0) {
      setSelectedId(newImages[0].id);
    }
    setIsUploading(false);
    setUploadProgress(0);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    await processFiles(files);
    e.target.value = '';
  };

  const handleLutUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const lut = await parseCubeLUT(file);
      setAvailableLuts(prev => {
        const exists = prev.find(l => l.name === lut.name);
        if (exists) return prev;
        return [...prev, lut];
      });
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
      const MAX_WIDTH = 1920;
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
      
      const isNeg = selectedImage.adjustments.filmType === 'color_neg' || selectedImage.adjustments.filmType === 'bw_neg' || selectedImage.adjustments.filmType === 'log';
      setLevels(calculateLevels(imageData.data, isNeg));
    };
    img.src = selectedImage.src;
  }, [selectedImage?.src]);

  useEffect(() => {
    if (!originalImageData) return;
    const isNeg = adjustments.filmType === 'color_neg' || adjustments.filmType === 'bw_neg' || adjustments.filmType === 'log';
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
    const currentAdjustments = isComparing 
      ? { ...defaultAdjustments, filmType: adjustments.filmType, autoMask: adjustments.autoMask }
      : adjustments;

    const processedData = processImageData(
      originalImageData.data,
      originalImageData.width,
      originalImageData.height,
      currentAdjustments,
      levels
    );

    let originalProcessedData: ImageData | null = null;
    if (compareMode === 'split' && !isComparing) {
      originalProcessedData = processImageData(
        originalImageData.data,
        originalImageData.width,
        originalImageData.height,
        { ...defaultAdjustments, filmType: adjustments.filmType, autoMask: adjustments.autoMask },
        levels
      );
    }

    // 2. Handle Rotation and Cropping
    let finalWidth = originalImageData.width;
    let finalHeight = originalImageData.height;
    if (isRotated90) {
      finalWidth = originalImageData.height;
      finalHeight = originalImageData.width;
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

    const renderToCanvas = (targetCanvas: HTMLCanvasElement, imageData: ImageData) => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = originalImageData.width;
      tempCanvas.height = originalImageData.height;
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return;
      tempCtx.putImageData(imageData, 0, 0);

      const targetCtx = targetCanvas.getContext('2d');
      if (!targetCtx) return;

      if (isCropping || !selectedImage?.crop || selectedImage.crop.width === 0 || selectedImage.crop.height === 0) {
        targetCanvas.width = finalWidth;
        targetCanvas.height = finalHeight;
        drawRotated(targetCtx, tempCanvas, finalWidth, finalHeight, rotation);
      } else {
        const crop = selectedImage.crop;
        const scaleX = finalWidth / 100;
        const scaleY = finalHeight / 100;
        
        const croppedWidth = crop.width * scaleX;
        const croppedHeight = crop.height * scaleY;
        
        targetCanvas.width = croppedWidth;
        targetCanvas.height = croppedHeight;

        const rotatedBuffer = document.createElement('canvas');
        rotatedBuffer.width = finalWidth;
        rotatedBuffer.height = finalHeight;
        const rbCtx = rotatedBuffer.getContext('2d');
        if (rbCtx) {
          drawRotated(rbCtx, tempCanvas, finalWidth, finalHeight, rotation);
          targetCtx.drawImage(
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
    };

    renderToCanvas(canvasRef.current, processedData);
    if (originalProcessedData && originalCanvasRef.current) {
      renderToCanvas(originalCanvasRef.current, originalProcessedData);
    }
    
    // 4. Histogram
    if (!isComparing) {
      const currentData = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
      setHistogramData(calculateHistogram(currentData));
    }
  }, [originalImageData, adjustments, levels, isComparing, compareMode, isCropping, selectedImage?.crop]);

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
    const isNeg = adjustments.filmType === 'color_neg' || adjustments.filmType === 'bw_neg' || adjustments.filmType === 'log';
    const wbOffsets = calculateAutoWhiteBalance(originalImageData.data, isNeg, adjustments.autoMask, levels);
    updateAdjustments({
      rOffset: wbOffsets.rOffset,
      gOffset: wbOffsets.gOffset,
      bOffset: wbOffsets.bOffset,
      temperature: 0,
      tint: 0
    });
  };

  const handleDownload = async () => {
    if (!selectedImage) return;
    
    setIsUploading(true); // Reuse uploading state as a generic loading state
    
    try {
      const finalCanvas = await processImageAtSize(selectedImage);
      if (!finalCanvas) return;
        
      const link = document.createElement('a');
      const extension = exportConfig.format === 'image/tiff' ? 'tiff' : exportConfig.format.split('/')[1];
      link.download = `processed-${selectedImage.name}.${extension}`;
      
      if (exportConfig.format === 'image/tiff') {
        const ctx = finalCanvas.getContext('2d');
        if (ctx) {
          const imgData = ctx.getImageData(0, 0, finalCanvas.width, finalCanvas.height);
          const tiffBuffer = UTIF.encodeImage(new Uint8Array(imgData.data.buffer), finalCanvas.width, finalCanvas.height);
          const blob = new Blob([tiffBuffer], { type: 'image/tiff' });
          link.href = URL.createObjectURL(blob);
          link.click();
          URL.revokeObjectURL(link.href);
        }
      } else {
        link.href = finalCanvas.toDataURL(exportConfig.format, exportConfig.quality);
        link.click();
      }
    } catch (err) {
      console.error("Export failed:", err);
      alert("Export failed. The image might be too large for your browser's memory.");
    } finally {
      setIsUploading(false);
    }
  };

  const processImageAtSize = async (imgItem: ImageItem, targetWidth?: number) => {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = imgItem.src;
    });

    const canvas = document.createElement('canvas');
    let width = img.width;
    let height = img.height;

    const MAX_EXPORT_WIDTH = 6144;
    const effectiveTargetWidth = targetWidth ? Math.min(targetWidth, MAX_EXPORT_WIDTH) : MAX_EXPORT_WIDTH;

    if (width > effectiveTargetWidth) {
      height = Math.round((height * effectiveTargetWidth) / width);
      width = effectiveTargetWidth;
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    const isNeg = imgItem.adjustments.filmType === 'color_neg' || imgItem.adjustments.filmType === 'bw_neg' || imgItem.adjustments.filmType === 'log';
    const imgLevels = calculateLevels(imageData.data, isNeg);

    const processedData = processImageData(
      imageData.data,
      width,
      height,
      imgItem.adjustments,
      imgLevels
    );
    
    const rotation = imgItem.adjustments.rotation;
    const isRotated90 = rotation === 90 || rotation === 270;
    
    let finalWidth = width;
    let finalHeight = height;
    if (isRotated90) {
      finalWidth = height;
      finalHeight = width;
    }
    
    const rotatedCanvas = document.createElement('canvas');
    rotatedCanvas.width = finalWidth;
    rotatedCanvas.height = finalHeight;
    const rCtx = rotatedCanvas.getContext('2d');
    if (!rCtx) return null;
    
    rCtx.save();
    rCtx.translate(finalWidth / 2, finalHeight / 2);
    rCtx.rotate((rotation * Math.PI) / 180);
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    if (tempCtx) {
      tempCtx.putImageData(processedData, 0, 0);
      if (rotation === 90 || rotation === 270) {
        rCtx.drawImage(tempCanvas, -height / 2, -width / 2);
      } else {
        rCtx.drawImage(tempCanvas, -width / 2, -height / 2);
      }
    }
    rCtx.restore();

    if (imgItem.crop && imgItem.crop.width > 0 && imgItem.crop.height > 0) {
      return getCroppedCanvas(rotatedCanvas, imgItem.crop as Crop);
    }
    
    return rotatedCanvas;
  };

  const handleBatchDownload = async () => {
    if (images.length === 0) return;
    setIsUploading(true);
    setUploadProgress(0);
    
    try {
      const zip = new JSZip();
      
      for (let i = 0; i < images.length; i++) {
        const imgItem = images[i];
        const finalCanvas = await processImageAtSize(imgItem);
        if (!finalCanvas) continue;
        
        const extension = exportConfig.format === 'image/tiff' ? 'tiff' : exportConfig.format.split('/')[1];
        
        if (exportConfig.format === 'image/tiff') {
          const finalCtx = finalCanvas.getContext('2d');
          if (finalCtx) {
            const imgData = finalCtx.getImageData(0, 0, finalCanvas.width, finalCanvas.height);
            const tiffBuffer = UTIF.encodeImage(new Uint8Array(imgData.data.buffer), finalCanvas.width, finalCanvas.height);
            const blob = new Blob([tiffBuffer], { type: 'image/tiff' });
            zip.file(`processed-${imgItem.name}.${extension}`, blob);
          }
        } else {
          const blob = await new Promise<Blob | null>(resolve => finalCanvas.toBlob(resolve, exportConfig.format, exportConfig.quality));
          if (blob) {
            zip.file(`processed-${imgItem.name}.${extension}`, blob);
          }
        }
        setUploadProgress(Math.round(((i + 1) / images.length) * 100));
      }
      
      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, 'filmlab-batch.zip');
    } catch (err) {
      console.error("Batch export failed:", err);
      alert("Batch export failed. Some images might be too large.");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
    if (selectedId === id) {
      setSelectedId(images.length > 1 ? images.find(img => img.id !== id)?.id || null : null);
    }
  };

  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files) as File[];
    await processFiles(files);
  };

  const isRotated90 = adjustments.rotation === 90 || adjustments.rotation === 270;
  const displayWidth = isRotated90 ? originalImageData?.height : originalImageData?.width;
  const displayHeight = isRotated90 ? originalImageData?.width : originalImageData?.height;

  return (
    <div 
      className="flex flex-col lg:flex-row h-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Left Sidebar: Image List */}
      <div className={`
        fixed inset-0 z-50 lg:relative lg:z-0 lg:flex lg:w-64 bg-zinc-900 border-r border-zinc-800 flex-col
        ${mobileView === 'gallery' ? 'flex' : 'hidden lg:flex'}
      `}>
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <ImageIcon className="w-5 h-5" />
            FilmLab Web
          </h1>
          <button onClick={() => setMobileView('preview')} className="lg:hidden p-1 text-zinc-400 hover:text-zinc-100">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="p-4 border-b border-zinc-800">
          <label className="flex items-center justify-center gap-2 w-full py-2 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors text-sm font-medium cursor-pointer">
            <Upload className="w-4 h-4" />
            Import Images
            <input type="file" multiple className="hidden" accept="image/*,.tif,.tiff,.dng,.cr2,.nef,.arw,.fff,.bmp" onChange={handleFileUpload} />
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
      <TransformWrapper
        key={`${selectedId}-${adjustments.rotation}`}
        disabled={isCropping}
        minScale={0.1}
        maxScale={10}
        centerOnInit={true}
        limitToBounds={true}
        wheel={{ step: 0.1, smoothStep: 0.005 }}
        panning={{ velocityDisabled: false }}
        doubleClick={{ mode: 'reset' }}
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <div className="flex-1 flex flex-col bg-zinc-950 relative overflow-hidden">
            {/* Toolbar */}
            <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-4 lg:px-6 shrink-0 z-10 bg-zinc-950">
              <div className="flex items-center gap-2">
                <button 
                  className="lg:hidden p-2 -ml-2 text-zinc-400 hover:text-zinc-100"
                  onClick={() => setMobileView('gallery')}
                >
                  <ImageIcon className="w-5 h-5" />
                </button>
                {!isCropping && (
                  <div className="flex items-center gap-1 lg:gap-2">
                    <button
                      onClick={() => setIsCropping(true)}
                      disabled={!selectedImage}
                      className="flex items-center justify-center w-8 h-8 rounded-md transition-colors bg-zinc-900 hover:bg-zinc-800 text-zinc-300 disabled:opacity-50"
                      title="Crop"
                    >
                      <CropIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleRotate}
                      disabled={!selectedImage}
                      className="flex items-center justify-center w-8 h-8 rounded-md transition-colors bg-zinc-900 hover:bg-zinc-800 text-zinc-300 disabled:opacity-50"
                      title="Rotate 90°"
                    >
                      <RotateCw className="w-4 h-4" />
                    </button>
                    <div className="flex items-center bg-zinc-900 rounded-md border border-zinc-800 overflow-hidden h-8">
                      <button
                        onClick={() => zoomOut()}
                        disabled={!selectedImage}
                        className="px-2 hover:bg-zinc-800 text-zinc-300 transition-colors disabled:opacity-50 h-full flex items-center justify-center"
                        title="Zoom Out"
                      >
                        <ZoomOut className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => resetTransform()}
                        disabled={!selectedImage}
                        className="px-2 hover:bg-zinc-800 text-zinc-300 transition-colors border-x border-zinc-800 disabled:opacity-50 h-full flex items-center justify-center"
                        title="Reset Zoom"
                      >
                        <Maximize className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => zoomIn()}
                        disabled={!selectedImage}
                        className="px-2 hover:bg-zinc-800 text-zinc-300 transition-colors disabled:opacity-50 h-full flex items-center justify-center"
                        title="Zoom In"
                      >
                        <ZoomIn className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
                {isCropping && (
                  <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-md border border-zinc-800 h-8">
                    <span className="text-xs text-zinc-500 px-2 font-medium">Aspect:</span>
                    <button onClick={() => updateCropAspect(undefined)} className={`px-2 h-full text-xs font-medium rounded transition-colors ${!selectedImage?.cropAspect ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>Free</button>
                    <button onClick={() => updateCropAspect(1)} className={`px-2 h-full text-xs font-medium rounded transition-colors ${selectedImage?.cropAspect === 1 ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>1:1</button>
                    <button onClick={() => updateCropAspect(4/3)} className={`px-2 h-full text-xs font-medium rounded transition-colors ${selectedImage?.cropAspect === 4/3 ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>4:3</button>
                    <button onClick={() => updateCropAspect(3/2)} className={`px-2 h-full text-xs font-medium rounded transition-colors ${selectedImage?.cropAspect === 3/2 ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>3:2</button>
                    <button onClick={() => updateCropAspect(16/9)} className={`px-2 h-full text-xs font-medium rounded transition-colors ${selectedImage?.cropAspect === 16/9 ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>16:9</button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 lg:gap-2">
                {isCropping ? (
                  <>
                    <button
                      onClick={() => {
                        updateCrop(undefined as any, undefined as any);
                        setIsCropping(false);
                      }}
                      className="flex items-center justify-center w-8 h-8 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md transition-colors border border-zinc-700"
                      title="Cancel Crop"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setIsCropping(false)}
                      className="flex items-center justify-center w-8 h-8 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors"
                      title="Confirm Crop"
                    >
                      <Check className="w-4 h-4" />
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
                      disabled={!selectedImage || compareMode === 'split'}
                      className="flex items-center justify-center w-8 h-8 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-md transition-colors border border-zinc-800 select-none disabled:opacity-50"
                      title="Hold to Compare"
                    >
                      <SplitSquareHorizontal className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setCompareMode(prev => prev === 'split' ? 'none' : 'split')}
                      disabled={!selectedImage}
                      className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors border select-none disabled:opacity-50 ${
                        compareMode === 'split' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-zinc-800'
                      }`}
                      title="Split View"
                    >
                      <Layers className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleDownload}
                      disabled={!selectedImage}
                      className="flex items-center justify-center w-8 h-8 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-md transition-colors"
                      title="Save Current"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button 
                      className="lg:hidden p-2 -mr-1 text-zinc-400 hover:text-zinc-100"
                      onClick={() => setMobileView('adjust')}
                    >
                      <Sliders className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Canvas Container */}
            <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden bg-zinc-950 relative">
              {isDragging && (
                <div className="absolute inset-0 z-50 bg-indigo-500/20 backdrop-blur-sm border-2 border-indigo-500 border-dashed m-4 rounded-xl flex items-center justify-center">
                  <div className="bg-zinc-900 p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4">
                    <Upload className="w-12 h-12 text-indigo-400 animate-bounce" />
                    <p className="text-lg font-medium text-zinc-200">Drop images here to import</p>
                  </div>
                </div>
              )}
              {isUploading && (
                <div className="absolute inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center">
                  <div className="bg-zinc-900 p-8 rounded-2xl shadow-2xl flex flex-col items-center gap-6 w-80">
                    <div className="w-16 h-16 border-4 border-zinc-800 border-t-indigo-500 rounded-full animate-spin"></div>
                    <div className="w-full space-y-2 text-center">
                      <p className="text-lg font-medium text-zinc-200">Importing Images...</p>
                      <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-indigo-500 transition-all duration-300 ease-out"
                          style={{ width: `${uploadProgress}%` }}
                        ></div>
                      </div>
                      <p className="text-sm text-zinc-400">{uploadProgress}%</p>
                    </div>
                  </div>
                </div>
              )}
              <TransformComponent 
                wrapperStyle={{ width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%' }}
                contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0, minWidth: 0 }}
              >
                  {!selectedImage ? (
                    <div className="text-center text-zinc-500">
                      <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-20" />
                      <p>Select or upload an image to start processing</p>
                      <p className="text-sm mt-2 opacity-60">You can also drag and drop images here</p>
                    </div>
                  ) : (
                    <div className="w-full h-full p-4 md:p-8 flex items-center justify-center overflow-hidden">
                      <div 
                        className="relative shadow-2xl rounded-sm"
                        style={{ 
                          width: displayWidth && displayHeight ? (displayWidth > displayHeight ? 'min(100%, 1200px)' : 'auto') : 'auto',
                          height: displayWidth && displayHeight ? (displayHeight >= displayWidth ? 'min(100%, 800px)' : 'auto') : 'auto',
                          aspectRatio: displayWidth && displayHeight ? `${displayWidth}/${displayHeight}` : 'auto',
                          maxWidth: '100%',
                          maxHeight: '100%'
                        }}
                      >
                      {isCropping ? (
                        <ReactCrop 
                          crop={selectedImage.crop} 
                          onChange={(c, pc) => updateCrop(c, pc)}
                          className="w-full h-full"
                          ruleOfThirds={true}
                          aspect={selectedImage.cropAspect}
                        >
                          <canvas
                            ref={canvasRef}
                            className="w-full h-full block"
                          />
                        </ReactCrop>
                      ) : (
                        <>
                          <canvas
                            ref={canvasRef}
                            className="w-full h-full block"
                            style={{ backgroundImage: 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYDCgBDAm9BGDWAAJyEgSRC0AQAK9CGVG3UW0AAAAABJRU5ErkJggg==")' }}
                          />
                          
                          {compareMode === 'split' && (
                            <>
                              <canvas
                                ref={originalCanvasRef}
                                className="absolute inset-0 w-full h-full pointer-events-none block"
                                style={{ 
                                  clipPath: `inset(0 ${100 - splitPosition}% 0 0)`,
                                  backgroundImage: 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYDCgBDAm9BGDWAAJyEgSRC0AQAK9CGVG3UW0AAAAABJRU5ErkJggg==")' 
                                }}
                              />
                              <div 
                                className="absolute top-0 bottom-0 w-1 bg-white cursor-ew-resize shadow-[0_0_4px_rgba(0,0,0,0.5)] z-10 flex items-center justify-center"
                                style={{ left: `${splitPosition}%`, transform: 'translateX(-50%)' }}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const container = e.currentTarget.parentElement;
                                  if (!container) return;
                                  
                                  const handleMouseMove = (moveEvent: MouseEvent) => {
                                    const rect = container.getBoundingClientRect();
                                    const x = Math.max(0, Math.min(moveEvent.clientX - rect.left, rect.width));
                                    setSplitPosition((x / rect.width) * 100);
                                  };
                                  const handleMouseUp = () => {
                                    document.removeEventListener('mousemove', handleMouseMove);
                                    document.removeEventListener('mouseup', handleMouseUp);
                                  };
                                  document.addEventListener('mousemove', handleMouseMove);
                                  document.addEventListener('mouseup', handleMouseUp);
                                }}
                                onTouchStart={(e) => {
                                  e.stopPropagation();
                                  const container = e.currentTarget.parentElement;
                                  if (!container) return;
                                  
                                  const handleTouchMove = (moveEvent: TouchEvent) => {
                                    const rect = container.getBoundingClientRect();
                                    const x = Math.max(0, Math.min(moveEvent.touches[0].clientX - rect.left, rect.width));
                                    setSplitPosition((x / rect.width) * 100);
                                  };
                                  const handleTouchEnd = () => {
                                    document.removeEventListener('touchmove', handleTouchMove);
                                    document.removeEventListener('touchend', handleTouchEnd);
                                  };
                                  document.addEventListener('touchmove', handleTouchMove, { passive: false });
                                  document.addEventListener('touchend', handleTouchEnd);
                                }}
                              >
                                <div className="w-6 h-6 bg-white rounded-full shadow-md flex items-center justify-center pointer-events-none border border-zinc-200">
                                  <div className="w-4 h-4 text-zinc-800">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M8 9l-4 3 4 3M16 9l4 3-4 3" />
                                    </svg>
                                  </div>
                                </div>
                              </div>
                            </>
                          )}
                        </>
                      )}
                      </div>
                    </div>
                  )
                }
              </TransformComponent>
            </div>
          </div>
        )}
      </TransformWrapper>

      {/* Right Sidebar: Adjustments */}
      <div className={`
        fixed inset-0 z-50 lg:relative lg:z-0 lg:flex lg:w-80 bg-zinc-900 border-l border-zinc-800 flex-col
        ${mobileView === 'adjust' ? 'flex' : 'hidden lg:flex'}
      `}>
        <div className="lg:hidden p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900">
          <span className="font-semibold">Adjustments</span>
          <button onClick={() => setMobileView('preview')} className="p-1 text-zinc-400 hover:text-zinc-100">
            <X className="w-6 h-6" />
          </button>
        </div>
        {/* Histogram - Fixed at top */}
        <div className="p-4 border-b border-zinc-800 bg-zinc-900 z-10">
          <Histogram data={histogramData} />
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-8">
            {/* Export Settings Section */}
            <div className="space-y-4">
              <button 
                onClick={() => setIsExportSettingsOpen(!isExportSettingsOpen)}
                className="flex items-center justify-between w-full text-sm font-medium text-zinc-300 hover:text-zinc-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  Export Settings
                </div>
                {isExportSettingsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {isExportSettingsOpen && (
                <div className="space-y-4 p-4 rounded-xl bg-zinc-800/30 border border-zinc-800 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Format</label>
                    <div className="grid grid-cols-2 gap-1 lg:grid-cols-4">
                      {(['image/jpeg', 'image/png', 'image/webp', 'image/tiff'] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => setExportConfig(prev => ({ ...prev, format: f }))}
                          className={`px-2 py-1.5 text-[10px] font-medium rounded-md transition-colors ${
                            exportConfig.format === f
                              ? 'bg-indigo-600 text-white'
                              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                          }`}
                        >
                          {f.split('/')[1].toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  {(exportConfig.format === 'image/jpeg' || exportConfig.format === 'image/webp') && (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Quality</label>
                        <div className="flex items-center">
                          <input
                            type="text"
                            value={Math.round(exportConfig.quality * 100)}
                            onChange={(e) => {
                              if (e.target.value === '') {
                                setExportConfig(prev => ({ ...prev, quality: 0 }));
                                return;
                              }
                              const val = parseInt(e.target.value);
                              if (!isNaN(val)) {
                                setExportConfig(prev => ({ ...prev, quality: val / 100 }));
                              }
                            }}
                            onBlur={() => {
                              setExportConfig(prev => ({ 
                                ...prev, 
                                quality: Math.max(0.1, Math.min(1.0, prev.quality)) 
                              }));
                            }}
                            className="w-8 text-[10px] font-mono text-indigo-400 bg-transparent border-b border-transparent hover:border-zinc-600 focus:border-indigo-500 focus:outline-none text-right transition-colors"
                          />
                          <span className="text-[10px] font-mono text-indigo-400">%</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.01"
                        value={exportConfig.quality}
                        onChange={(e) => setExportConfig(prev => ({ ...prev, quality: parseFloat(e.target.value) }))}
                        className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Film Type & Auto Mask (Always visible) */}
            <div className="space-y-4">
            <div className="space-y-3">
              <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                <Sliders className="w-4 h-4" />
                Film Type
              </label>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {(['color_neg', 'bw_neg', 'log', 'positive'] as FilmType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => updateAdjustments({ filmType: type })}
                    className={`px-2 py-2 text-[10px] lg:text-xs font-medium rounded-lg transition-colors ${
                      adjustments.filmType === type
                        ? 'bg-indigo-600 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    {type === 'color_neg' ? 'Color Neg' : type === 'bw_neg' ? 'B&W Neg' : type === 'log' ? 'Log' : 'Positive'}
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
                      onClick={() => {
                        const newAdj = { ...defaultAdjustments, ...preset.adjustments, rotation: adjustments.rotation };
                        updateAdjustments(newAdj);
                      }}
                      className="text-left p-2 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 transition-all group"
                    >
                      <p className="text-xs font-semibold text-zinc-200 group-hover:text-indigo-400 transition-colors">{preset.name}</p>
                      <p className="text-[10px] text-zinc-500 line-clamp-1">{preset.description}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {adjustments.filmType !== 'positive' && (
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
            )}
          </div>

          <div className="border-t border-zinc-800/50 pt-6 space-y-4">
            {/* LUT Section */}
            <div className="space-y-4">
              <button 
                onClick={() => setSectionsOpen(prev => ({ ...prev, lut: !prev.lut }))}
                className="w-full flex items-center justify-between group"
              >
                <p className="text-xs font-bold text-zinc-500 group-hover:text-zinc-300 uppercase tracking-widest transition-colors">LUT</p>
                {sectionsOpen.lut ? <ChevronUp className="w-3 h-3 text-zinc-600" /> : <ChevronDown className="w-3 h-3 text-zinc-600" />}
              </button>
              
              {sectionsOpen.lut && (
                <div className="space-y-6 animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-zinc-300 flex items-center justify-between">
                      <span>3D LUT (.cube)</span>
                      {adjustments.lut && (
                        <button onClick={() => updateAdjustments({ lut: null })} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                      )}
                    </label>
                    
                    {availableLuts.length > 0 && (
                      <div className="grid grid-cols-1 gap-2 mb-3 max-h-40 overflow-y-auto pr-1">
                        {availableLuts.map((lut, idx) => (
                          <button
                            key={idx}
                            onClick={() => updateAdjustments({ lut })}
                            className={`text-left p-2 rounded-lg border transition-all flex items-center justify-between ${
                              adjustments.lut?.name === lut.name
                                ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                                : 'bg-zinc-800/50 border-zinc-700/50 hover:bg-zinc-800 hover:border-zinc-600 text-zinc-300'
                            }`}
                          >
                            <span className="text-xs font-medium truncate pr-2">{lut.name}</span>
                            <span className="text-[10px] opacity-50 shrink-0">{lut.size}³</span>
                          </button>
                        ))}
                      </div>
                    )}

                    <label className="flex items-center justify-center gap-2 w-full py-3 px-4 border-2 border-dashed border-zinc-700 hover:border-indigo-500 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-300 rounded-lg transition-colors cursor-pointer">
                      <Upload className="w-4 h-4" />
                      <span className="text-xs font-medium">Upload .cube file</span>
                      <input type="file" accept=".cube" className="hidden" onChange={handleLutUpload} />
                    </label>
                  </div>

                  {adjustments.lut && (
                    <SliderControl label="Intensity" icon={<Layers className="w-4 h-4" />} value={adjustments.lutIntensity ?? 100} min={0} max={100} defaultValue={100} onChange={(v) => updateAdjustments({ lutIntensity: v })} />
                  )}
                </div>
              )}
            </div>

            {/* Basic Section */}
            <div className="pt-6 border-t border-zinc-800/50 space-y-4">
              <button 
                onClick={() => setSectionsOpen(prev => ({ ...prev, basic: !prev.basic }))}
                className="w-full flex items-center justify-between group"
              >
                <p className="text-xs font-bold text-zinc-500 group-hover:text-zinc-300 uppercase tracking-widest transition-colors">Basic</p>
                {sectionsOpen.basic ? <ChevronUp className="w-3 h-3 text-zinc-600" /> : <ChevronDown className="w-3 h-3 text-zinc-600" />}
              </button>

              {sectionsOpen.basic && (
                <div className="space-y-6 animate-in fade-in slide-in-from-top-1 duration-200">
                  <SliderControl label="Exposure" icon={<Sun className="w-4 h-4" />} value={adjustments.exposure} min={-100} max={100} onChange={(v) => updateAdjustments({ exposure: v })} />
                  <SliderControl label="Contrast" icon={<Contrast className="w-4 h-4" />} value={adjustments.contrast} min={-100} max={100} onChange={(v) => updateAdjustments({ contrast: v })} />
                  
                  <div className="grid grid-cols-1 gap-6 pt-2">
                    <SliderControl label="Highlights" icon={<SunDim className="w-4 h-4" />} value={adjustments.highlights} min={-100} max={100} onChange={(v) => updateAdjustments({ highlights: v })} />
                    <SliderControl label="Shadows" icon={<Moon className="w-4 h-4" />} value={adjustments.shadows} min={-100} max={100} onChange={(v) => updateAdjustments({ shadows: v })} />
                    <SliderControl label="Whites" icon={<Sun className="w-4 h-4 text-zinc-400" />} value={adjustments.whites} min={-100} max={100} onChange={(v) => updateAdjustments({ whites: v })} />
                    <SliderControl label="Blacks" icon={<Moon className="w-4 h-4 text-zinc-600" />} value={adjustments.blacks} min={-100} max={100} onChange={(v) => updateAdjustments({ blacks: v })} />
                    <SliderControl label="Gamma" icon={<RefreshCcw className="w-4 h-4" />} value={adjustments.gamma} min={10} max={300} defaultValue={100} onChange={(v) => updateAdjustments({ gamma: v })} />
                  </div>

                  <SliderControl label="Saturation" icon={<Palette className="w-4 h-4" />} value={adjustments.saturation} min={-100} max={100} onChange={(v) => updateAdjustments({ saturation: v })} />
                </div>
              )}
            </div>

            {/* Color Section */}
            <div className="pt-6 border-t border-zinc-800/50 space-y-4">
              <button 
                onClick={() => setSectionsOpen(prev => ({ ...prev, color: !prev.color }))}
                className="w-full flex items-center justify-between group"
              >
                <p className="text-xs font-bold text-zinc-500 group-hover:text-zinc-300 uppercase tracking-widest transition-colors">Color</p>
                {sectionsOpen.color ? <ChevronUp className="w-3 h-3 text-zinc-600" /> : <ChevronDown className="w-3 h-3 text-zinc-600" />}
              </button>

              {sectionsOpen.color && (
                <div className="space-y-6 animate-in fade-in slide-in-from-top-1 duration-200">
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

              {/* Color Mix Section */}
              <div className="pt-6 border-t border-zinc-800/50 space-y-4">
                <button 
                  onClick={() => setSectionsOpen(prev => ({ ...prev, colorMix: !prev.colorMix }))}
                  className="w-full flex items-center justify-between group"
                >
                  <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider group-hover:text-indigo-400 transition-colors flex items-center gap-2">
                    <Palette className="w-4 h-4" />
                    Color Mix
                  </h3>
                  {sectionsOpen.colorMix ? <ChevronUp className="w-3 h-3 text-zinc-600" /> : <ChevronDown className="w-3 h-3 text-zinc-600" />}
                </button>

                {sectionsOpen.colorMix && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="grid grid-cols-8 gap-1">
                      {(['reds', 'oranges', 'yellows', 'greens', 'aquas', 'blues', 'purples', 'magentas'] as HSLColor[]).map((c) => {
                        const colors = {
                          reds: 'bg-red-500',
                          oranges: 'bg-orange-500',
                          yellows: 'bg-yellow-500',
                          greens: 'bg-green-500',
                          aquas: 'bg-teal-400',
                          blues: 'bg-blue-500',
                          purples: 'bg-purple-500',
                          magentas: 'bg-pink-500'
                        };
                        return (
                          <button
                            key={c}
                            onClick={() => setActiveHslColor(c)}
                            className={`w-full aspect-square rounded-full transition-all flex items-center justify-center ${
                              activeHslColor === c ? 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-zinc-900 scale-110' : 'hover:scale-110 opacity-70 hover:opacity-100'
                            }`}
                          >
                            <div className={`w-full h-full rounded-full ${colors[c]}`} />
                          </button>
                        );
                      })}
                    </div>

                    <div className="space-y-4 bg-zinc-950/30 p-3 rounded-xl border border-zinc-800/50">
                      <SliderControl 
                        label="Hue" 
                        icon={<div className="w-3 h-3 rounded-full bg-gradient-to-r from-red-500 via-green-500 to-blue-500" />} 
                        value={adjustments.hsl?.[activeHslColor]?.h || 0} 
                        min={-100} max={100} 
                        onChange={(v) => updateHsl(activeHslColor, 'h', v)} 
                      />
                      <SliderControl 
                        label="Saturation" 
                        icon={<Droplet className="w-4 h-4 text-zinc-400" />} 
                        value={adjustments.hsl?.[activeHslColor]?.s || 0} 
                        min={-100} max={100} 
                        onChange={(v) => updateHsl(activeHslColor, 's', v)} 
                      />
                      <SliderControl 
                        label="Luminance" 
                        icon={<Sun className="w-4 h-4 text-zinc-400" />} 
                        value={adjustments.hsl?.[activeHslColor]?.l || 0} 
                        min={-100} max={100} 
                        onChange={(v) => updateHsl(activeHslColor, 'l', v)} 
                      />
                      
                      <div className="pt-2 flex items-center justify-end border-t border-zinc-800/50 mt-2">
                        <button 
                          onClick={() => {
                            const currentHsl = adjustments.hsl || defaultAdjustments.hsl!;
                            updateAdjustments({ 
                              hsl: { ...currentHsl, [activeHslColor]: { h: 0, s: 0, l: 0 } } 
                            });
                          }}
                          className="text-[10px] font-bold text-zinc-600 hover:text-red-400 transition-colors uppercase tracking-tighter"
                        >
                          Reset {activeHslColor}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Color Balance Section */}
              <div className="pt-6 border-t border-zinc-800/50 space-y-4">
                <button 
                  onClick={() => setSectionsOpen(prev => ({ ...prev, colorBalance: !prev.colorBalance }))}
                  className="w-full flex items-center justify-between group"
                >
                  <p className="text-xs font-bold text-zinc-500 group-hover:text-zinc-300 uppercase tracking-widest transition-colors">Color Balance</p>
                  {sectionsOpen.colorBalance ? <ChevronUp className="w-3 h-3 text-zinc-600" /> : <ChevronDown className="w-3 h-3 text-zinc-600" />}
                </button>

                {sectionsOpen.colorBalance && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="flex items-center justify-between">
                      <div className="flex bg-zinc-800 rounded-md p-0.5">
                    {(['shadows', 'midtones', 'highlights'] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setColorBalanceRange(r)}
                        className={`px-3 py-1 text-[10px] font-bold uppercase tracking-tighter rounded transition-colors ${
                          colorBalanceRange === r ? 'bg-zinc-700 text-indigo-400' : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {r === 'shadows' ? 'Shadows' : r === 'midtones' ? 'Midtones' : 'Highlights'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 bg-zinc-950/30 p-3 rounded-xl border border-zinc-800/50">
                  <SliderControl 
                    label="Cyan - Red" 
                    icon={<div className="w-3 h-3 rounded-full bg-red-500" />} 
                    value={adjustments.colorBalance[colorBalanceRange].r} 
                    min={-50} max={50} 
                    onChange={(v) => updateColorBalance(colorBalanceRange, 'r', v)} 
                  />
                  <SliderControl 
                    label="Magenta - Green" 
                    icon={<div className="w-3 h-3 rounded-full bg-green-500" />} 
                    value={adjustments.colorBalance[colorBalanceRange].g} 
                    min={-50} max={50} 
                    onChange={(v) => updateColorBalance(colorBalanceRange, 'g', v)} 
                  />
                  <SliderControl 
                    label="Yellow - Blue" 
                    icon={<div className="w-3 h-3 rounded-full bg-blue-500" />} 
                    value={adjustments.colorBalance[colorBalanceRange].b} 
                    min={-50} max={50} 
                    onChange={(v) => updateColorBalance(colorBalanceRange, 'b', v)} 
                  />
                  
                  <div className="pt-2 flex items-center justify-between border-t border-zinc-800/50 mt-2">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input 
                        type="checkbox" 
                        checked={adjustments.colorBalance.preserveLuminosity}
                        onChange={(e) => updateAdjustments({ 
                          colorBalance: { ...adjustments.colorBalance, preserveLuminosity: e.target.checked } 
                        })}
                        className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-zinc-900"
                      />
                      <span className="text-[10px] font-medium text-zinc-500 group-hover:text-zinc-300 transition-colors">Preserve Luminosity</span>
                    </label>
                    <button 
                      onClick={() => {
                        const currentCB = { ...adjustments.colorBalance };
                        currentCB[colorBalanceRange] = { r: 0, g: 0, b: 0 };
                        updateAdjustments({ colorBalance: currentCB });
                      }}
                      className="text-[10px] font-bold text-zinc-600 hover:text-red-400 transition-colors uppercase tracking-tighter"
                    >
                      Reset {colorBalanceRange[0].toUpperCase() + colorBalanceRange.slice(1)}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>

              {/* Detail Section */}
              <div className="pt-6 border-t border-zinc-800/50 space-y-4">
                <button 
                  onClick={() => setSectionsOpen(prev => ({ ...prev, detail: !prev.detail }))}
                  className="w-full flex items-center justify-between group"
                >
                  <p className="text-xs font-bold text-zinc-500 group-hover:text-zinc-300 uppercase tracking-widest transition-colors">Detail</p>
                  {sectionsOpen.detail ? <ChevronUp className="w-3 h-3 text-zinc-600" /> : <ChevronDown className="w-3 h-3 text-zinc-600" />}
                </button>

                {sectionsOpen.detail && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-top-1 duration-200">
                    <SliderControl 
                      label="Sharpen" 
                      icon={<Zap className="w-4 h-4 text-amber-400" />} 
                      value={adjustments.sharpen} 
                      min={0} max={100} 
                      onChange={(v) => updateAdjustments({ sharpen: v })} 
                    />
                    <SliderControl 
                      label="Clarity" 
                      icon={<Wind className="w-4 h-4 text-sky-400" />} 
                      value={adjustments.clarity} 
                      min={-100} max={100} 
                      onChange={(v) => updateAdjustments({ clarity: v })} 
                    />
                    <SliderControl 
                      label="Luminance NR" 
                      icon={<Droplet className="w-4 h-4 text-zinc-400" />} 
                      value={adjustments.luminanceNoiseReduction} 
                      min={0} max={100} 
                      onChange={(v) => updateAdjustments({ luminanceNoiseReduction: v })} 
                    />
                    <SliderControl 
                      label="Color NR" 
                      icon={<Shield className="w-4 h-4 text-emerald-400" />} 
                      value={adjustments.colorNoiseReduction} 
                      min={0} max={100} 
                      onChange={(v) => updateAdjustments({ colorNoiseReduction: v })} 
                    />
                    <SliderControl 
                      label="Vignette" 
                      icon={<Maximize2 className="w-4 h-4 text-zinc-400" />} 
                      value={adjustments.vignette} 
                      min={-100} max={100} 
                      onChange={(v) => updateAdjustments({ vignette: v })} 
                    />
                  </div>
                )}
              </div>

              {/* Halation Section */}
              <div className="pt-6 border-t border-zinc-800/50 space-y-4">
                <button 
                  onClick={() => setSectionsOpen(prev => ({ ...prev, halation: !prev.halation }))}
                  className="w-full flex items-center justify-between group"
                >
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-zinc-500 group-hover:text-zinc-300 uppercase tracking-widest transition-colors">Halation</p>
                    <Sparkles className="w-3 h-3 text-red-400/50" />
                  </div>
                  {sectionsOpen.halation ? <ChevronUp className="w-3 h-3 text-zinc-600" /> : <ChevronDown className="w-3 h-3 text-zinc-600" />}
                </button>

                {sectionsOpen.halation && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-top-1 duration-200">
                <SliderControl 
                  label="Intensity" 
                  icon={<Sun className="w-4 h-4 text-red-500" />} 
                  value={adjustments.halationIntensity} 
                  min={0} max={100} 
                  onChange={(v) => updateAdjustments({ halationIntensity: v })} 
                />
                <SliderControl 
                  label="Radius" 
                  icon={<Maximize2 className="w-4 h-4 text-zinc-400" />} 
                  value={adjustments.halationRadius} 
                  min={1} max={100} 
                  defaultValue={10}
                  onChange={(v) => updateAdjustments({ halationRadius: v })} 
                />
                <SliderControl 
                  label="Threshold" 
                  icon={<Minimize2 className="w-4 h-4 text-zinc-400" />} 
                  value={adjustments.halationThreshold} 
                  min={0} max={255} 
                  defaultValue={220}
                  onChange={(v) => updateAdjustments({ halationThreshold: v })} 
                />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        
      <div className="p-6 border-t border-zinc-800 space-y-2">
          <button
            onClick={() => {
              if (!selectedImage) return;
              setImages(prev => prev.map(img => ({ ...img, adjustments: { ...selectedImage.adjustments } })));
            }}
            disabled={!selectedImage || images.length <= 1}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 disabled:opacity-50 text-indigo-300 rounded-lg transition-colors text-sm font-medium"
          >
            <Layers className="w-4 h-4" />
            Sync to All Images
          </button>
          <button
            onClick={() => updateAdjustments({ ...defaultAdjustments, rotation: adjustments.rotation })}
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
