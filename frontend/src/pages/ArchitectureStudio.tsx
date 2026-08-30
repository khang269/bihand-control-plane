import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { Upload, ImageIcon, Sparkles, History, Download, Coins, RefreshCw, Layers, Compass, Grid, ArrowLeft, HelpCircle, X } from 'lucide-react';
import api from '../lib/api';

export const SAMPLES = {
  architecture: [
    { name: "Sketch Outline", thumbnail: "/assets/blueprint_card.jpg", url: "/assets/blueprint_card.jpg" },
    { name: "Modern Villa Base", thumbnail: "/assets/architecture_card.jpg", url: "/assets/architecture_card.jpg" }
  ],
  interior: [
    { name: "Empty Room", thumbnail: "/assets/interior_card.jpg", url: "/assets/interior_card.jpg" }
  ],
  floorplan: [
    { name: "Blueprint Outline", thumbnail: "/assets/blueprint_card.jpg", url: "/assets/blueprint_card.jpg" }
  ]
};

interface RenderRecord {
  _id: string;
  userId: string;
  feature: string;
  spaceType: string;
  style: string;
  aspectRatio: string;
  modelType: string;
  prompt: string;
  sourcePaths?: string[];
  paths?: any[];
  status?: string;
  cost: number;
  createdAt: string;
  failureReason?: string;
  angleId?: string;
  creativeSubMode?: string;
}

// SHAREDProgrammatic Asset Downloader to bypass browser domain navigation limitations
export const triggerDownload = async (url: string, filename: string) => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.error("Failed to download natively, trying direct link in new tab:", error);
    // Safe cross-domain fallback - Open in target tab instead of window navigation
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

const RecentTaskItem: React.FC<{
  task: RenderRecord;
  isSelected?: boolean;
  onClick?: () => void;
  onSelectImage: (taskId: string, url: string) => void;
}> = ({ task, isSelected, onClick, onSelectImage }) => {
  const [signedPaths, setSignedPaths] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchSignedUrls = async () => {
      if (!task.paths || !Array.isArray(task.paths) || task.paths.length === 0) {
        return;
      }
      setLoading(true);
      const tempSigned: any[] = [];
      for (const img of task.paths) {
        if (img.status === 'success' && img.path) {
          try {
            const sRes = await api.get(`/architecture/signed-url?taskId=${task._id}&path=${encodeURIComponent(img.path)}&t=${Date.now()}`);
            if (active) {
              tempSigned.push({ ...img, signedUrl: sRes.data.url });
            }
          } catch (e) {
            console.error("Error signing path inside item list:", e);
            if (active) tempSigned.push(img);
          }
        } else {
          if (active) tempSigned.push(img);
        }
      }
      if (active) {
        setSignedPaths(tempSigned);
        setLoading(false);
      }
    };

    fetchSignedUrls();
    return () => {
      active = false;
    };
  }, [task._id, task.paths]);

  const displayTime = task.createdAt ? new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date(task.createdAt).toLocaleDateString([], { month: '2-digit', day: '2-digit' }) : '';

  return (
    <div
      onClick={onClick}
      className={`p-3 bg-card border rounded-xl space-y-3 shadow-md transition-all cursor-pointer ${
        isSelected ? 'border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.15)]' : 'border-border hover:border-purple-500/40'
      }`}
    >
      <div className="flex justify-between items-center text-[10px] text-muted-foreground font-bold">
        <span className="text-purple-500 uppercase tracking-wider">
          {task.feature === 'image-render' ? 'Dựng ảnh' :
           task.feature === 'floorplan-render' ? 'Mặt bằng' :
           task.feature === 'ai-renovation' ? 'Cải tạo' : 'Đồng bộ'}
          {task.spaceType && ` • ${task.spaceType.toUpperCase()}`}
        </span>
        <span>{displayTime}</span>
      </div>

      <div className="flex justify-between items-start gap-4">
        <p className="text-[11px] text-zinc-300 leading-tight line-clamp-2 flex-1" title={task.prompt}>
          {task.prompt || 'Không có mô tả'}
        </p>
        <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full uppercase tracking-wider shrink-0 ${
          task.status === 'PENDING' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
          task.status === 'PROCESSING' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
          task.status === 'COMPLETED' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
          'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {task.status || 'PENDING'}
        </span>
      </div>

      {task.status === 'FAILED' && (
        <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-2 space-y-1">
          <div className="text-[9px] font-extrabold text-red-400 uppercase tracking-widest leading-none">Error Logged</div>
          <p className="text-[9px] text-muted-foreground leading-tight mt-1">{task.failureReason || "Đã xảy ra lỗi hệ thống khi kết xuất."}</p>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[8px] px-1.5 py-0.5 bg-red-900/30 text-red-300 border border-red-500/20 rounded font-bold uppercase">Refunded {task.cost} 🪙</span>
          </div>
        </div>
      )}

      {task.status === 'COMPLETED' && (
        <div className="space-y-1.5">
          {loading ? (
            <div className="flex items-center gap-1.5 py-1 text-[9px] text-zinc-500">
              <RefreshCw className="animate-spin text-purple-400" size={10} />
              <span>Đang ký đường dẫn...</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2">
                {signedPaths.map((res, index) => {
                  if (res.status === 'success' && res.signedUrl) {
                    return (
                      <div
                        key={index}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectImage(task._id, res.signedUrl);
                        }}
                        className="relative aspect-square rounded-lg border border-border hover:border-purple-500 overflow-hidden cursor-pointer bg-secondary transition-all group"
                      >
                        <img src={res.path && res.path.endsWith('.mp4') ? '/assets/video_thumbnail_placeholder.jpg' : res.signedUrl} className="w-full h-full object-cover" alt={`Render ${index + 1}`} />
                        <div className="absolute top-1 left-1 px-1 py-0.5 bg-green-950/85 border border-green-500/30 rounded text-[7px] font-bold text-green-400 uppercase">
                          #{index + 1}
                        </div>
                        {/* Download Single Image */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const ext = res.path && res.path.endsWith('.mp4') ? 'mp4' : 'jpg';
                            triggerDownload(res.signedUrl, `render-${task._id}-${index + 1}.${ext}`);
                          }}
                          className="absolute bottom-1 right-1 p-1 bg-black/80 rounded border border-border/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Tải ảnh này"
                        >
                          <Download size={8} />
                        </button>
                      </div>
                    );
                  } else {
                    return (
                      <div
                        key={index}
                        className="relative aspect-square rounded-lg border border-red-500/30 bg-red-950/10 flex flex-col items-center justify-center p-1 text-center select-none"
                        title={res.error || "Failed generation"}
                      >
                        <X size={12} className="text-red-400 mb-0.5" />
                        <span className="text-[7px] font-extrabold text-red-400 uppercase tracking-widest leading-none">#{index + 1} Failed</span>
                        <p className="text-[5px] text-zinc-500 leading-tight line-clamp-2 mt-0.5">{res.error || "Gen error"}</p>
                        <span className="absolute bottom-1 px-1 py-0.5 bg-red-900/30 border border-red-500/20 text-[5px] text-red-300 rounded font-bold uppercase scale-90">Refunded 🪙</span>
                      </div>
                    );
                  }
                })}
              </div>
              
              {signedPaths.filter(p => p.status === 'success').length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    signedPaths.forEach((p, idx) => {
                      if (p.status === 'success' && p.signedUrl) {
                        const ext = p.path && p.path.endsWith('.mp4') ? 'mp4' : 'jpg';
                        triggerDownload(p.signedUrl, `render-${task._id}-${idx + 1}.${ext}`);
                      }
                    });
                  }}
                  className="mt-2 w-full py-1.5 bg-secondary hover:bg-secondary text-purple-500 border border-purple-500/20 hover:border-purple-500/40 rounded-lg text-[9px] font-extrabold uppercase tracking-wider transition-all flex items-center justify-center gap-1"
                >
                  <Download size={10} /> Tải Trọn Bộ ({signedPaths.filter(p => p.status === 'success').length} ảnh)
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const ArchitectureStudio: React.FC = () => {
  const { t } = useLanguage();
  // Main Category Tabs
  const [activeTab, setActiveCategory] = useState<'image_render' | 'floorplan_render' | 'ai_renovation' | 'view_sync'>('image_render');
  
  // Sub-tab selectors (null means showing the gorgeous mode card selector dashboard!)
  const [imageSubTab, setImageSubTab] = useState<'architecture' | 'interior' | 'planning' | 'landscape' | null>(null);
  const [floorPlanSubTab, setFloorPlanSubTab] = useState<'architecture' | 'interior' | 'urban' | 'landscape' | null>(null);
  const [renovationSubTab, setRenovationSubTab] = useState<'interior' | 'exterior' | 'landscape' | 'spatial_function' | null>(null);
  const [viewSyncSubTab, setViewSyncSubTab] = useState<'single' | 'batch' | 'creative' | null>(null);

  // Universal options
  const [style, setStyle] = useState<string>('modern');
  const [aspectRatio, setAspectRatio] = useState<string>('16:9');
  const [modelType, setModelType] = useState<string>('models/gemini-3.1-flash-image');
  const [prompt, setPrompt] = useState('');
  const [sourceImageUrls, setSourceImageUrls] = useState<string[]>([]);
  const sourceImage = sourceImageUrls[0] || '';
  const setSourceImage = (val: string) => {
    if (!val) {
      setSourceImageUrls([]);
    } else {
      setSourceImageUrls([val]);
    }
  };
  const [renderedImage, setRenderedImage] = useState<string | null>(null);

  // Sub-tab specific configuration fields (100% DISTINCT parameters!)
  const [cameraAngle, setCameraAngle] = useState<string>('default');
  const [weatherEffect, setWeatherEffect] = useState<string>('default');
  const [buildingType, setBuildingType] = useState<string>('default');
  const [viewType, setViewType] = useState<string>('default');
  const [environmentContext, setEnvironmentContext] = useState<string>('default');
  
  const [roomType, setRoomType] = useState<string>('default');
  const [colorPalette, setColorPalette] = useState<string>('default');
  const [urbanDensity, setUrbanDensity] = useState<string>('default');
  const [gardenTheme, setGardenTheme] = useState<string>('default');

  // Floor plan specific fields
  const [wallStyle, setWallStyle] = useState<string>('default');
  const [zoningPalette, setZoningPalette] = useState<string>('default');
  const [walkwayStyle, setWalkwayStyle] = useState<string>('default');
  const [wallHeight, setWallHeight] = useState<string>('3.2');
  const [measurementUnit, setMeasurementUnit] = useState<string>('default');
  const [flooringMaterial, setFlooringMaterial] = useState<string>('default');
  const [furnishingDensity, setFurnishingDensity] = useState<string>('default');
  const [legendType, setLegendType] = useState<string>('default');
  const [vegetationOverlay, setVegetationOverlay] = useState<string>('default');

  // AI Renovation fields
  const [renovationSubMode, setRenovationSubMode] = useState<'empty_room' | 'redesign'>('redesign');
  const [colorPalettePreset, setColorPalettePreset] = useState<string>('default');
  const [renovationStyle, setRenovationStyle] = useState<string>('default');
  const [additionElement, setAdditionElement] = useState<string>('default');
  const [dividerType, setDividerType] = useState<string>('default');
  const [primaryCladding, setPrimaryCladding] = useState<string>('default');
  const [windowSystem, setWindowSystem] = useState<string>('default');

  // View Sync fields
  const [batchCount, setBatchCount] = useState<string>('default');
  const [lightingContinuity, setLightingContinuity] = useState<string>('default');
  const [cameraPath, setCameraPath] = useState<string>('default');
  const [videoDuration, setVideoDuration] = useState<string>('default');

  // Opzen AI cloned features
  const [negativePrompt, setNegativePrompt] = useState<string>('');
  const [lightingPreset, setLightingPreset] = useState<string>('default');
  const [imageCount, setImageCount] = useState<number>(1);

  // View Sync Customize View
  const [syncCustomizeView, setSyncCustomizeView] = useState<'exterior' | 'interior'>('exterior');
  const [viewSyncAngle, setViewSyncAngle] = useState<string>('default');
  const [viewSyncFraming, setViewSyncFraming] = useState<string>('default');
  const [viewSyncAtmosphere, setViewSyncAtmosphere] = useState<string>('default');

  // Wallet and render status
  const [credits, setCredits] = useState<number>(0);
  const [history, setHistory] = useState<RenderRecord[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const prevSelectedTaskIdRef = useRef<string | null>(null);
  const [canvasSignedPaths, setCanvasSignedPaths] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Guide and Pro Tips Modal state
  const [showGuideModal, setShowGuideModal] = useState<boolean>(false);
  const [guideActiveTab, setGuideActiveTab] = useState<'tips' | 'video'>('tips');

  // 9-Angle Creative Panel
  const [creativeSubMode, setCreativeSubMode] = useState<'interior' | 'exterior'>('interior');
  const [creativeResults, setCreativeResults] = useState<Record<string, string>>({});
  const [creativeLoading, setCreativeLoading] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  const INTERIOR_ROOMS = [
    { id: "living_room", label: "Phòng khách" },
    { id: "bedroom", label: "Phòng ngủ" },
    { id: "kitchen", label: "Phòng bếp" },
    { id: "dining_room", label: "Phòng ăn" },
    { id: "reading_room", label: "Phòng đọc" },
    { id: "bathroom", label: "Phòng tắm" },
    { id: "corridor", label: "Hành lang" },
    { id: "detail", label: "Góc cận cảnh" },
    { id: "balcony", label: "Ban công" }
  ];

  const EXTERIOR_VIEWS = [
    { id: "dawn", label: "Toàn cảnh (Bình minh)" },
    { id: "sunset", label: "Toàn cảnh (Hoàng hôn)" },
    { id: "bird_eye", label: "Góc chim bay" },
    { id: "surface", label: "Cận cảnh vật liệu" },
    { id: "details", label: "Chi tiết cấu tạo" },
    { id: "entrance", label: "Lối vào & sảnh" },
    { id: "arch_corner", label: "Góc kiến trúc" },
    { id: "bokeh", label: "Nghệ thuật xóa phông" },
    { id: "night", label: "Phối cảnh đêm" }
  ];

  const fetchCredits = async () => {
    try {
      const res = await api.get('/architecture/credits');
      setCredits(res.data?.credits || 0);
    } catch (e) {
      console.error(e);
      setCredits(0);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await api.get('/architecture/history?limit=5&skip=0');
      const items = res.data?.renders || [];
      setHistory(items);
      if (items.length > 0 && !selectedTaskId) {
        setSelectedTaskId(items[0]._id);
      }
    } catch (e) {
      console.error(e);
      setHistory([]);
    }
  };

  const loadMoreHistory = async () => {
    try {
      const currentSkip = history.length;
      const res = await api.get(`/architecture/history?limit=5&skip=${currentSkip}`);
      const newItems = res.data?.renders || [];
      if (newItems.length > 0) {
        setHistory(prev => [...prev, ...newItems]);
      }
    } catch (e) {
      console.error("Failed to load more history:", e);
    }
  };

  useEffect(() => {
    fetchCredits();
    fetchHistory();
  }, []);

  const selectedTask = history.find(t => t._id === selectedTaskId) || history[0];

  const handleSelectTaskAndImage = (taskId: string, imageUrl: string) => {
    prevSelectedTaskIdRef.current = taskId;
    setSelectedTaskId(taskId);
    setRenderedImage(imageUrl);
  };

  useEffect(() => {
    let active = true;
    const fetchSignedUrls = async () => {
      if (!selectedTask || !selectedTask.paths || !Array.isArray(selectedTask.paths) || selectedTask.paths.length === 0) {
        setCanvasSignedPaths([]);
        return;
      }
      const tempSigned: any[] = [];
      for (const img of selectedTask.paths) {
        if (img.status === 'success' && img.path) {
          try {
            const sRes = await api.get(`/architecture/signed-url?taskId=${selectedTask._id}&path=${encodeURIComponent(img.path)}&t=${Date.now()}`);
            if (active) {
              tempSigned.push({ ...img, signedUrl: sRes.data.url });
            }
          } catch (e) {
            console.error("Error signing path inside canvas:", e);
            if (active) tempSigned.push(img);
          }
        } else {
          if (active) tempSigned.push(img);
        }
      }
      if (active) {
        setCanvasSignedPaths(tempSigned);
        
        // Only override renderedImage with first success if selected task actually changed or renderedImage is empty
        if (selectedTask._id !== prevSelectedTaskIdRef.current || !renderedImage) {
          const firstSuccess = tempSigned.find(p => p.status === 'success');
          if (firstSuccess && firstSuccess.signedUrl) {
            setRenderedImage(firstSuccess.signedUrl);
          } else {
            setRenderedImage(null);
          }
          prevSelectedTaskIdRef.current = selectedTask._id;
        }
      }
    };

    fetchSignedUrls();
    return () => {
      active = false;
    };
  }, [selectedTask?._id, JSON.stringify(selectedTask?.paths)]);

  // Global background poller for active (PENDING/PROCESSING) tasks in parallel
  const activeTaskIdsAndStatuses = history
    .filter(t => t.status === 'PENDING' || t.status === 'PROCESSING')
    .map(t => `${t._id}:${t.status}`)
    .join(',');

  useEffect(() => {
    const activeTasks = history.filter(t => t.status === 'PENDING' || t.status === 'PROCESSING');
    if (activeTasks.length === 0) return;

    const interval = setInterval(async () => {
      for (const task of activeTasks) {
        try {
          const pollRes = await api.get(`/architecture/tasks/${task._id}?t=${Date.now()}`);
          const taskData = pollRes.data;
          
          if (taskData.status !== task.status || JSON.stringify(taskData.paths) !== JSON.stringify(task.paths)) {
            setHistory(prev => prev.map(t => t._id === task._id ? {
              ...t,
              status: taskData.status,
              paths: taskData.paths || [],
              failureReason: taskData.failureReason
            } : t));

            if (taskData.status === 'COMPLETED' || taskData.status === 'FAILED') {
              fetchCredits();
            }
          }
        } catch (e) {
          console.error(`Error polling background task ${task._id}:`, e);
        }
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [activeTaskIdsAndStatuses]);

  // Scan history and populate creativeResults for completed creative tasks of the active sub-mode
  useEffect(() => {
    let active = true;
    const loadCreativeResultsFromHistory = async () => {
      // Find completed tasks of feature "view-sync" and spaceType "creative" matching current sub-mode
      const creativeTasks = history.filter(t => 
        t.feature === 'view-sync' && 
        t.spaceType === 'creative' && 
        t.status === 'COMPLETED' && 
        t.creativeSubMode === creativeSubMode &&
        t.angleId &&
        t.paths &&
        t.paths.some(p => p.status === 'success' && p.path)
      );

      if (creativeTasks.length === 0) return;

      const resultsMap: Record<string, string> = {};
      for (const t of creativeTasks) {
        if (!t.angleId) continue;
        const firstSuccess = t.paths?.find(p => p.status === 'success' && p.path);
        if (firstSuccess && firstSuccess.path) {
          try {
            const sRes = await api.get(`/architecture/signed-url?taskId=${t._id}&path=${encodeURIComponent(firstSuccess.path)}&t=${Date.now()}`);
            if (active && sRes.data?.url) {
              resultsMap[t.angleId] = sRes.data.url;
            }
          } catch (e) {
            console.error(`Error signing path for creative task ${t._id}:`, e);
          }
        }
      }

      if (active && Object.keys(resultsMap).length > 0) {
        setCreativeResults(prev => {
          // Only update if there is a real difference to prevent state-updates cascading renders
          const updated = { ...prev, ...resultsMap };
          if (JSON.stringify(prev) === JSON.stringify(updated)) return prev;
          return updated;
        });
      }
    };

    loadCreativeResultsFromHistory();
    return () => {
      active = false;
    };
  }, [history, creativeSubMode]);

  // Update default prompts and sample images automatically for each of the 15 configurations
  useEffect(() => {
    setRenderedImage(null);
    setCreativeResults({});
    
    if (activeTab === 'image_render') {
      if (imageSubTab === 'architecture') {
        setPrompt('Kết xuất biệt thự hiện đại rực rỡ nắng chiều, ốp mảng gỗ ấm, bể bơi tràn vô cực');
        setSourceImage('');
      } else if (imageSubTab === 'interior') {
        setPrompt('Kết xuất phòng khách Scandinavian tối giản thanh lịch, sofa kem, thảm dệt dầy');
        setSourceImage('');
      } else if (imageSubTab === 'planning') {
        setPrompt('Quy hoạch khu đô thị thông minh hiện đại bên sông rộng lớn, góc nhìn chim bay');
        setSourceImage('');
      } else if (imageSubTab === 'landscape') {
        setPrompt('Cảnh quan sân vườn biệt thự Nhật Bản, hồ cá Koi yên bình, lối đi lát đá tự nhiên');
        setSourceImage('');
      }
    } else if (activeTab === 'floorplan_render') {
      setSourceImage('');
      if (floorPlanSubTab === 'architecture') {
        setPrompt('Kết xuất mặt bằng kiến trúc thô phân tách tường vách sạch sẽ rành mạch');
      } else if (floorPlanSubTab === 'interior') {
        setPrompt('Mặt bằng căn hộ 2 ngủ phối màu, lát sàn gỗ sồi ấm áp, bố trí sofa kem và thảm');
      } else if (floorPlanSubTab === 'urban') {
        setPrompt('Sơ đồ quy hoạch phân vùng 2D rõ nét, phân lô đất đai, tô màu xanh công viên');
      } else if (floorPlanSubTab === 'landscape') {
        setPrompt('Mặt bằng quy hoạch cảnh quan ngoài trời biệt thự, chỉ ra mảng cỏ và lối đi lát đá');
      }
    } else if (activeTab === 'ai_renovation') {
      setSourceImage('');
      if (renovationSubTab === 'interior') {
        setPrompt('Cải tạo phòng khách cũ nát: Sơn tường xi măng mài nghệ thuật, thay bộ sofa da màu kem');
      } else if (renovationSubTab === 'exterior') {
        setPrompt('Cải tạo mặt tiền: Thay thế lớp sơn cũ bằng vách gỗ tự nhiên dọc và cửa kính lớn');
      } else if (renovationSubTab === 'landscape') {
        setPrompt('Cải tạo sân vườn: Loại bỏ cỏ dại khô héo, thay thế bằng thảm cỏ xanh mướt và lối đi rải đá dăm');
      } else if (renovationSubTab === 'spatial_function') {
        setPrompt('Zoning lại mặt bằng: Thiết kế vách ngăn CNC tối giản phân biệt phòng khách và bàn ăn');
      }
    } else if (activeTab === 'view_sync') {
      setSourceImage('');
      if (viewSyncSubTab === 'single') {
        setPrompt('Xuất video lia camera panning mượt mà quanh biệt thự hiện đại đón ánh nắng sớm');
      } else if (viewSyncSubTab === 'batch') {
        setPrompt('Dựng đồng bộ 4 góc máy camera khác nhau của tòa nhà trong ánh chiều hoàng hôn');
      } else if (viewSyncSubTab === 'creative') {
        setPrompt('Kết xuất 9 góc nhìn đồng bộ ngôn ngữ thiết kế sang trọng tối giản');
      }
    }
  }, [activeTab, imageSubTab, floorPlanSubTab, renovationSubTab, viewSyncSubTab]);

  // Dedicated helper to compile highly tailored, creative prompts for each of the 15 distinct sub-tab scenarios
  const compileDetailedPrompt = (customPrompt: string, overrideTab?: string, overrideSubTab?: string, angleLabel?: string) => {
    const activeT = overrideTab || activeTab;
    const activeSubT = overrideSubTab || activeSubTab;

    const hasReferences = sourceImageUrls.length > 0;
    const priorityClause = hasReferences
      ? `CRITICAL PRIORITY: The attached reference/source image(s) MUST serve as the absolute foundation for this render. Do NOT invent new architectural structures. Maintain the exact spatial layouts, structural outlines, perspective angles, and architectural footprints present in the reference images, using the instructions below solely to enhance, style, and detail the scene.`
      : ``;

    if (activeT === 'image_render') {
      if (activeSubT === 'architecture') {
        const parts = [
          `[Exterior Architecture Render Mode]`,
          priorityClause,
          customPrompt ? `User Design Instructions (Highest Priority): ${customPrompt}` : '',
          `Task: Generate a premium, highly detailed exterior architectural rendering.`,
          `Building Classification: ${buildingType === 'default' ? 'luxury modern building structure' : buildingType}.`,
          `Design Style: ${style === 'default' ? 'contemporary modernist' : style} architectural design language.`,
          `Camera Viewpoint & Composition: ${viewType === 'default' ? 'scenic perspective' : viewType}.`,
          `Surrounding Context Environment: ${environmentContext === 'default' ? 'carefully detailed surroundings with vegetation' : environmentContext}.`,
          `Atmospheric Illumination Preset: ${lightingPreset === 'default' ? 'natural ambient' : lightingPreset} daylight.`,
          `Weather Condition: ${weatherEffect === 'default' ? 'clear sky' : weatherEffect}.`,
          `Focus: Capture crisp shadows, physical material textures, and glass reflections.`
        ];
        return parts.filter(Boolean).join('\n');
      } else if (activeSubT === 'interior') {
        const parts = [
          `[Interior Design photoshoot Mode]`,
          priorityClause,
          customPrompt ? `User Interior Staging Elements (Highest Priority): ${customPrompt}` : '',
          `Task: Synthesize a high-fidelity interior design mockup with professional staging.`,
          `Space Classification: ${roomType === 'default' ? 'modern designed room' : roomType}.`,
          `Aesthetic Theme: ${style === 'default' ? 'minimalist staging' : style} interior style.`,
          `Illumination Preset: ${lightingPreset === 'default' ? 'studio ambient' : lightingPreset} lighting setup.`,
          `Color Palette Scheme: ${colorPalette === 'default' ? 'neutral sophisticated colors' : colorPalette}.`,
          `Focus: Ensure soft diffuse shadow transitions, volumetric depth, premium fabric textures, and wooden/stone finishes.`
        ];
        return parts.filter(Boolean).join('\n');
      } else if (activeSubT === 'planning') {
        const parts = [
          `[Urban & District Masterplan Mode]`,
          priorityClause,
          customPrompt ? `User Planning Specifications (Highest Priority): ${customPrompt}` : '',
          `Task: Create a high-resolution wide-angle aerial bird's-eye architectural rendering depicting a masterplan subdivision layout.`,
          `Planning Grid Model: Futuristic ${style === 'default' ? 'smart green eco-district' : style} pattern.`,
          `Density Level & Zoning Footprint: ${urbanDensity === 'default' ? 'medium density development' : urbanDensity}.`,
          `Graphic Illustration Style: ${cameraAngle === 'default' ? 'satellite physical photo' : cameraAngle} rendering.`,
          `Focus: Emphasize organized road networks, transit routing pathways, landscaping boundaries, and building block layouts.`
        ];
        return parts.filter(Boolean).join('\n');
      } else if (activeSubT === 'landscape') {
        const parts = [
          `[Landscape Architecture Design Mode]`,
          priorityClause,
          customPrompt ? `User Landscape Design Guidelines (Highest Priority): ${customPrompt}` : '',
          `Task: Produce an exquisite professional outdoor landscape and garden architecture design rendering.`,
          `Aesthetic Botanical Theme: Exquisite ${gardenTheme === 'default' ? 'botanical zen' : gardenTheme} theme garden environment.`,
          `Core Landscaping Feature: Elegant, bespoke ${additionElement === 'default' ? 'focal water courtyard' : additionElement} placement.`,
          `Focus: Highlight lush floral placements, soft grassy overlays, water reflections, stone-paved walkways, and high-end outdoor furniture.`
        ];
        return parts.filter(Boolean).join('\n');
      }
    } else if (activeT === 'floorplan_render') {
      if (activeSubT === 'architecture') {
        const parts = [
          `[Technical CAD Floor Plan Drafting Mode]`,
          priorityClause,
          customPrompt ? `User Technical Floor Plan Parameters (Highest Priority): ${customPrompt}` : '',
          `Task: Render a precise, clean architectural schematic layout and blueprint.`,
          `Structural Height Context: Walls projected at ${wallHeight || '3.2'} ${measurementUnit === 'default' ? 'meters' : measurementUnit}.`,
          `CAD Line Weight & Hatch Style: ${wallStyle === 'default' ? 'clean solid double-line structural CAD' : wallStyle}.`,
          `Focus: Pristine geometric accuracy, black structural boundaries, technical lines, and clear partition pathways.`
        ];
        return parts.filter(Boolean).join('\n');
      } else if (activeSubT === 'interior') {
        const parts = [
          `[Colored Furnished Layout Blueprint Mode]`,
          priorityClause,
          customPrompt ? `User Staging & Furnishing Specs (Highest Priority): ${customPrompt}` : '',
          `Task: Generate a fully colored, premium top-down furnished interior architectural floor plan.`,
          `Flooring Material texture: ${flooringMaterial === 'default' ? 'polished oak timber wood parquet' : flooringMaterial}.`,
          `Staging Furnishing Density: ${furnishingDensity === 'default' ? 'standard spacious layout' : furnishingDensity}.`,
          `Graphic Output Format: ${style === 'default' ? 'high-fidelity 3D floor plan layout' : style}.`,
          `Focus: Showcase logical room zoning, high-resolution texture map alignment, and top-down styled furniture silhouettes.`
        ];
        return parts.filter(Boolean).join('\n');
      } else if (activeSubT === 'urban') {
        const parts = [
          `[Municipal Partition Zoning Map Mode]`,
          priorityClause,
          customPrompt ? `User Urban Mapping Details (Highest Priority): ${customPrompt}` : '',
          `Task: Draft a comprehensive municipal subdivision zoning layout map blueprint.`,
          `Regional Plots Categorization: High-contrast ${zoningPalette === 'default' ? 'technical pastel land-use' : zoningPalette} zoning color system.`,
          `Output Legends & Annotation Standard: ${legendType === 'default' ? 'detailed ISO standard labeling annotations' : legendType}.`,
          `Focus: High-contrast parcel boundaries, color-coded functional sectors, clear legend scale markers.`
        ];
        return parts.filter(Boolean).join('\n');
      } else if (activeSubT === 'landscape') {
        const parts = [
          `[Outdoor Site & Garden Master Plan Mode]`,
          priorityClause,
          customPrompt ? `User Landscape Plan Details (Highest Priority): ${customPrompt}` : '',
          `Task: Generate an outdoor site master plan and landscape architectural blueprint.`,
          `Paving Material & Walkway Style: ${walkwayStyle === 'default' ? 'fine granite aggregated stones and paved path' : walkwayStyle} pathway design.`,
          `Vegetation Overlays: ${vegetationOverlay === 'default' ? 'lush forest canopy and manicured grass lawns' : vegetationOverlay}.`,
          `Focus: Clean garden zoning boundaries, organic walkway paths, canopy overlays, and outdoor deck borders.`
        ];
        return parts.filter(Boolean).join('\n');
      }
    } else if (activeT === 'ai_renovation') {
      if (activeSubT === 'interior') {
        const parts = [
          `[Smart Interior Spatial Renovation Mode]`,
          priorityClause,
          customPrompt ? `User Makeover Requirements (Highest Priority): ${customPrompt}` : '',
          `Task: Execute a premium virtual staging and interior spatial renovation makeover.`,
          `Staging Mode: Advanced ${renovationSubMode} processing.`,
          `Target Aesthetic Style: Upscale, luxurious ${renovationStyle === 'default' ? 'Japandi modern minimalist' : renovationStyle} room design.`,
          `Target Color Scheme: Highly sophisticated, organic ${colorPalettePreset === 'default' ? 'warm wood earth tones' : colorPalettePreset} color system.`,
          `Focus: Transform existing indoor assets, upgrade finishes, modernize structural elements, and ensure realistic shadow casting.`
        ];
        return parts.filter(Boolean).join('\n');
      } else if (activeSubT === 'exterior') {
        const parts = [
          `[Architectural Facade Envelope Renovation Mode]`,
          priorityClause,
          customPrompt ? `User Facade Renovation Elements (Highest Priority): ${customPrompt}` : '',
          `Task: Deliver a stunning facade exterior architectural facelift and massing makeover.`,
          `Primary Facade Cladding Upgrade: ${primaryCladding === 'default' ? 'floor-to-ceiling glass and horizontal timber panels' : primaryCladding}.`,
          `Window Structural Profiles: Sleek, architectural ${windowSystem === 'default' ? 'aluminum structural frame window system' : windowSystem}.`,
          `Focus: Refresh physical envelopes, insert modern windows, update cladding lines while keeping the exact existing perspective lines.`
        ];
        return parts.filter(Boolean).join('\n');
      } else if (activeSubT === 'landscape') {
        const parts = [
          `[Backyard Garden Landscape Remodeling Mode]`,
          priorityClause,
          customPrompt ? `User Backyard Makeover Guidelines (Highest Priority): ${customPrompt}` : '',
          `Task: Perform a luxury residential backyard garden landscape renovation and terrace remodel.`,
          `Core Remodeled Landscape Feature: Premium ${additionElement === 'default' ? 'glowing infinity swimming pool deck and patio' : additionElement}.`,
          `Greenery Density Layout: Gorgeous ${vegetationOverlay === 'default' ? 'carefully manicured topiary garden' : vegetationOverlay}.`,
          `Focus: Remove weeds/decay, overlay luxury grass/foliage, and arrange beautiful outdoor relaxation amenities.`
        ];
        return parts.filter(Boolean).join('\n');
      } else if (activeSubT === 'spatial_function') {
        const parts = [
          `[Spatial Partitioning & Open Floor Zoning Mode]`,
          priorityClause,
          customPrompt ? `User Spatial Restructuring Specs (Highest Priority): ${customPrompt}` : '',
          `Task: Reconstruct open layouts using beautiful architectural partition mechanisms.`,
          `Zoning Divider System: Premium ${dividerType === 'default' ? 'sliding frameless structural glass partition' : dividerType}.`,
          `Focus: Segment open interior layouts into clean, highly functional living spaces while maintaining ambient lighting flow.`
        ];
        return parts.filter(Boolean).join('\n');
      }
    } else if (activeT === 'view_sync') {
      if (activeSubT === 'single') {
        const parts = [
          `[Cinematic Camera Walkthrough Showcase Mode]`,
          priorityClause,
          customPrompt ? `User Video Rendering Instructions (Highest Priority): ${customPrompt}` : '',
          `Task: Produce a beautiful high-resolution cinematic architectural walkthrough.`,
          `Staging Environment Type: Synced ${syncCustomizeView || 'exterior'} layout.`,
          `Camera Specific Viewpoint: ${viewSyncAngle === 'default' ? 'main focal perspective' : viewSyncAngle}.`,
          `Camera Framing Action: ${viewSyncFraming === 'default' ? 'cinematic dolly' : viewSyncFraming} movement.`,
          `Camera Tracking Path: ${cameraPath === 'default' ? 'smooth horizontal pan' : cameraPath}.`,
          `Walkthrough Video Duration: ${videoDuration === 'default' ? '5 seconds' : videoDuration}.`,
          `Atmosphere & Time Preset: Gorgeous, photorealistic ${viewSyncAtmosphere === 'default' ? 'golden hour twilight' : viewSyncAtmosphere}.`,
          `Focus: Clean camera momentum, parallax depth effects, and consistent environmental reflection streams.`
        ];
        return parts.filter(Boolean).join('\n');
      } else if (activeSubT === 'batch') {
        const parts = [
          `[Multi-Angle Coordinated Rendering Mode]`,
          priorityClause,
          customPrompt ? `User Batch Configuration Specs (Highest Priority): ${customPrompt}` : '',
          `Task: Process a technical multi-angle architectural rendering composition package.`,
          `Target Multi-Camera Set: Coordinated series of ${batchCount === 'default' ? '3 distinct camera positions' : batchCount}.`,
          `Lighting & Material Continuity: Symmetrical, unified ${lightingContinuity === 'default' ? 'consistent environment light source' : lightingContinuity} rules across all output angles.`,
          `Focus: Maintain identical textures, absolute structural scale geometry, and synchronized lighting angles.`
        ];
        return parts.filter(Boolean).join('\n');
      } else if (activeSubT === 'creative') {
        const parts = [
          `[Synchronized Conceptual Design Series - ${angleLabel || 'Symmetrical View'}]`,
          priorityClause,
          customPrompt ? `User Design Instructions (Highest Priority): ${customPrompt}` : '',
          `Task: Render a single, high-fidelity perspective view of a ${angleLabel || 'specified design angle'} that represents the ${creativeSubMode === 'interior' ? 'interior' : 'exterior'} design of the project.`,
          `Conceptual Design Language Rules: Ensure absolute aesthetic style, lighting, material texture, and geometric color continuity to align seamlessly with the other angles in the project series.`,
          `Focus: Capture a single photorealistic frame, avoiding any multi-grid, multi-view, or 3x3 split layouts. Deliver a clean, unified architectural photograph.`
        ];
        return parts.filter(Boolean).join('\n');
      }
    }
    return customPrompt;
  };

  const handleStartRender = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);
    setRenderedImage(null); // Clear previous results immediately to prevent stale states on fails!
    
    let attempt = 0;
    const maxAttempts = 2; // Auto-retry once on network/keep-alive handshake failures
    
    while (attempt < maxAttempts) {
      try {
        let endpoint = '/architecture/image-render';
        const body: Record<string, any> = {
          style,
          aspectRatio,
          modelType,
          sourcePath: sourceImage || undefined, // Strip empty strings to prevent payload validation issues on backend!
          sourcePaths: sourceImageUrls.length > 0 ? sourceImageUrls : undefined,
          imageCount
        };

        if (activeTab === 'image_render') {
          endpoint = '/architecture/image-render';
          body["spaceType"] = imageSubTab;
          let compiled = compileDetailedPrompt(prompt);
          if (negativePrompt) {
            compiled += ` | Tránh: ${negativePrompt}`;
          }
          body["prompt"] = compiled;
        } else if (activeTab === 'floorplan_render') {
          endpoint = '/architecture/floorplan-render';
          body["spaceType"] = floorPlanSubTab;
          let compiled = compileDetailedPrompt(prompt);
          if (negativePrompt) {
            compiled += ` | Tránh: ${negativePrompt}`;
          }
          body["prompt"] = compiled;
        } else if (activeTab === 'ai_renovation') {
          endpoint = '/architecture/ai-renovation';
          body["renovationType"] = renovationSubTab;
          let compiled = compileDetailedPrompt(prompt);
          if (negativePrompt) {
            compiled += ` | Tránh: ${negativePrompt}`;
          }
          body["prompt"] = compiled;
        } else if (activeTab === 'view_sync') {
          endpoint = '/architecture/view-sync';
          body["syncMode"] = viewSyncSubTab;
          let compiled = compileDetailedPrompt(prompt);
          if (negativePrompt) {
            compiled += ` | Tránh: ${negativePrompt}`;
          }
          body["prompt"] = compiled;
        }

        const cacheBustingEndpoint = `${endpoint}?t=${Date.now()}`;
        const res = await api.post(cacheBustingEndpoint, body, {
          headers: {
            'Connection': 'close'
          }
        });
        
        if (res.data.success && res.data.taskId) {
          const taskId = res.data.taskId;
          
          let mockCost = 14;
          if (modelType === 'models/gemini-3.1-flash-lite-image') {
            mockCost = 7;
          } else if (modelType === 'models/gemini-3.1-flash-image') {
            mockCost = 14;
          } else if (modelType === 'models/gemini-3-pro-image') {
            mockCost = 20;
          } else if (modelType === 'models/gemini-2.5-flash-image') {
            mockCost = 48;
          }
          const totalMockCost = mockCost * imageCount;

          const mockTask: RenderRecord = {
            _id: taskId,
            userId: '',
            feature: activeTab === 'image_render' ? 'image-render' :
                     activeTab === 'floorplan_render' ? 'floorplan-render' :
                     activeTab === 'ai_renovation' ? 'ai-renovation' : 'view-sync',
            spaceType: activeTab === 'image_render' ? (imageSubTab || '') :
                       activeTab === 'floorplan_render' ? (floorPlanSubTab || '') :
                       activeTab === 'ai_renovation' ? (renovationSubTab || '') : (viewSyncSubTab || ''),
            style,
            aspectRatio,
            modelType,
            prompt: body["prompt"] || prompt || 'Đang tạo mẫu thiết kế...',
            sourcePaths: sourceImageUrls.length > 0 ? sourceImageUrls : undefined,
            paths: [],
            status: 'PENDING',
            cost: totalMockCost,
            createdAt: new Date().toISOString()
          };

          // Prepend to history feed list immediately
          setHistory(prev => [mockTask, ...prev]);
          setSelectedTaskId(taskId);

          if (res.data.newBalance !== undefined) {
            setCredits(res.data.newBalance);
          } else {
            fetchCredits();
          }
          
          break; // Succeeded in starting task! Break the retry loop.
        } else {
          throw new Error(res.data.message || "Quá trình bắt đầu kết xuất không thành công.");
        }
      } catch (err: any) {
        console.error(`Rendering error (Attempt ${attempt + 1}/${maxAttempts}):`, err);
        
        // If it's a real HTTP error from the server (e.g., status code returned), do not retry (like Insufficient Credits 402)
        if (err.response) {
          let serverMsg = err.response?.data?.detail || err.response?.data?.message || err.response?.data?.error;
          if (typeof serverMsg === 'object') {
            try {
              if (Array.isArray(serverMsg)) {
                serverMsg = serverMsg.map((d: any) => d.msg || JSON.stringify(d)).join(', ');
              } else {
                serverMsg = JSON.stringify(serverMsg);
              }
            } catch (e) {
              serverMsg = "Lỗi dữ liệu từ máy chủ.";
            }
          }
          setErrorMsg(serverMsg || `Quá trình kết xuất thất bại (HTTP ${err.response?.status || 500}).`);
          break;
        }
        
        // If it's a silent network connection reset / keep-alive timeout error, increment attempt and retry
        attempt++;
        if (attempt >= maxAttempts) {
          setErrorMsg("Mất kết nối tới máy chủ (Network Error / Timeout). Vui lòng kiểm tra lại đường truyền ngrok hoặc VPN.");
        } else {
          // Pause briefly for 300ms to allow the browser to fully cycle its TCP socket pools before the automatic retry
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    }
    
    setIsSubmitting(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    if (sourceImageUrls.length + files.length > 5) {
      setErrorMsg("Tải lên tối đa 5 hình ảnh phác thảo.");
      return;
    }

    // Size limit check: make sure each image does not exceed 10MB (10 * 1024 * 1024 bytes)
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        setErrorMsg("Mỗi hình ảnh phác thảo tải lên không được vượt quá 10MB.");
        return;
      }
    }

    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result) {
          setSourceImageUrls(prev => {
            if (prev.length >= 5) return prev;
            return [...prev, reader.result as string];
          });
          setRenderedImage(null);
          setCreativeResults({});
        }
      };
      reader.readAsDataURL(file);
    });

    e.target.value = "";
  };

  const handleCreateCreativeAngle = async (angleId: string, angleLabel: string) => {
    setCreativeLoading(prev => ({ ...prev, [angleId]: true }));
    setErrorMsg(null);
    try {
      const detailedCompiledPrompt = compileDetailedPrompt(prompt, 'view_sync', 'creative', angleLabel);
      const body = {
        syncMode: 'creative',
        creativeSubMode: creativeSubMode,
        angleId: angleId,
        angleLabel: angleLabel,
        style: style,
        aspectRatio: aspectRatio,
        modelType: modelType,
        prompt: detailedCompiledPrompt,
        sourcePaths: sourceImageUrls.length > 0 ? sourceImageUrls : undefined
      };
      const cacheBust = `/architecture/view-sync?t=${Date.now()}`;
      const res = await api.post(cacheBust, body, {
        headers: { 'Connection': 'close' }
      });
      if (res.data.success) {
        // Output image URL is not returned synchronously since tasks run asynchronously via Celery.
        // We set a temporary flag indicating the view sync generation task was created successfully.
        // The background poller will automatically query and display completed images in the history backlog!
        const outUrl = res.data.render?.outputImageUrl || null;
        if (outUrl) {
          setCreativeResults(prev => ({ ...prev, [angleId]: outUrl }));
        }
        setCredits(res.data.newBalance);
        fetchHistory();
      } else {
        throw new Error(res.data.message || "Góc kết xuất không thành công.");
      }
    } catch (err: any) {
      console.error(`Failed to generate creative angle ${angleId}:`, err);
      let serverMsg = err.response?.data?.detail || err.response?.data?.message || err.response?.data?.error || "Góc kết xuất thất bại.";
      if (typeof serverMsg === 'object') {
        try {
          if (Array.isArray(serverMsg)) {
            serverMsg = serverMsg.map((d: any) => d.msg || JSON.stringify(d)).join(', ');
          } else {
            serverMsg = JSON.stringify(serverMsg);
          }
        } catch (e) {
          serverMsg = "Lỗi dữ liệu từ máy chủ.";
        }
      }
      setErrorMsg(`[Góc ${angleLabel}] ${serverMsg}`);
    } finally {
      setCreativeLoading(prev => ({ ...prev, [angleId]: false }));
    }
  };

  const handleCreateAllCreative = async () => {
    setErrorMsg(null);
    const list = creativeSubMode === 'interior' ? INTERIOR_ROOMS : EXTERIOR_VIEWS;
    // Execute sequentially to prevent rate limits or connection overflows
    for (const r of list) {
      if (!creativeResults[r.id]) {
        await handleCreateCreativeAngle(r.id, r.label);
      }
    }
  };

  const getRenderCostAndName = () => {
    switch (modelType) {
      case 'models/gemini-3.1-flash-lite-image': return { cost: 7, label: 'Standard Fast' };
      case 'models/gemini-3.1-flash-image': return { cost: 14, label: 'Detail 1K' };
      case 'models/gemini-3-pro-image': return { cost: 20, label: 'Sharp 2K' };
      case 'models/gemini-2.5-flash-image': return { cost: 48, label: '4K UHD Realistic' };
      default: return { cost: 14, label: 'Detail 1K' };
    }
  };

  const renderCost = getRenderCostAndName().cost;

  // Active sub-tab checker for each main category
  const activeSubTab = 
    activeTab === 'image_render' ? imageSubTab :
    activeTab === 'floorplan_render' ? floorPlanSubTab :
    activeTab === 'ai_renovation' ? renovationSubTab :
    viewSyncSubTab;

  const handleBackToDashboard = () => {
    if (activeTab === 'image_render') setImageSubTab(null);
    else if (activeTab === 'floorplan_render') setFloorPlanSubTab(null);
    else if (activeTab === 'ai_renovation') setRenovationSubTab(null);
    else setViewSyncSubTab(null);
    setRenderedImage(null);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-background text-foreground p-6 space-y-6 animate-fade-in">
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" multiple className="hidden" />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent uppercase flex items-center gap-3">
            <span className="w-3.5 h-3.5 rounded-full bg-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.75)] animate-pulse"></span>
            {t('arch.title', 'SANT Arch Studio')}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">{t('arch.subtitle', 'Hệ sinh thái dựng hình AI, cải tạo nội thất và quy phim kiến trúc tối tân hàng đầu.')}</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary border border-border rounded-xl shadow-lg">
          <Coins size={14} className="text-amber-500" />
          <span className="text-sm font-bold">{t('arch.balance', 'Ví Bihand')}: <span className="text-amber-500">{credits}</span> 🪙</span>
        </div>
      </div>

      {/* BIG TAB: 4 Main Architectural Categories */}
      <div className="flex bg-secondary border border-border p-1 rounded-xl max-w-2xl shadow-inner">
        <button
          onClick={() => { setActiveCategory('image_render'); handleBackToDashboard(); }}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg transition-all ${activeTab === 'image_render' ? 'bg-purple-600 text-white shadow' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <ImageIcon size={14} /> {t('arch.tab.render_img', 'Render Ảnh')}
        </button>
        <button
          onClick={() => { setActiveCategory('floorplan_render'); handleBackToDashboard(); }}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg transition-all ${activeTab === 'floorplan_render' ? 'bg-purple-600 text-white shadow' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Grid size={14} /> {t('arch.tab.render_plan', 'Render Mặt Bằng')}
        </button>
        <button
          onClick={() => { setActiveCategory('ai_renovation'); handleBackToDashboard(); }}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg transition-all ${activeTab === 'ai_renovation' ? 'bg-purple-600 text-white shadow' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Layers size={14} /> {t('arch.tab.renovate', 'Cải Tạo AI')}
        </button>
        <button
          onClick={() => { setActiveCategory('view_sync'); handleBackToDashboard(); }}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg transition-all ${activeTab === 'view_sync' ? 'bg-purple-600 text-white shadow' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Compass size={14} /> {t('arch.tab.view_sync', 'Đồng Bộ View')}
        </button>
      </div>

      {/* ==================== LANDING MODE SELECTOR PANEL ==================== */}
      {!activeSubTab ? (
        <div className="text-center py-10 space-y-12 animate-fade-in max-w-6xl mx-auto">
          <div className="space-y-3">
            <h2 className="text-4xl font-extrabold tracking-tight bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-transparent">
              {activeTab === 'image_render' && "What space do you want to Render?"}
              {activeTab === 'floorplan_render' && "Which Floor Plan do you want to Render?"}
              {activeTab === 'ai_renovation' && "What space do you want to Renovate?"}
              {activeTab === 'view_sync' && "What views do you want to Sync?"}
            </h2>
            <p className="text-muted-foreground text-sm">Select a mode for AI to optimize your render quality.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {activeTab === 'image_render' && [
              { id: 'architecture', name: 'Architecture', desc: 'Build realistic 3D perspectives from 2D drawings or rough sketches.', img: '/assets/architecture_card.jpg' },
              { id: 'interior', name: 'Interior', desc: 'Automatically suggest styles, materials, and layout for living spaces.', img: '/assets/interior_card.jpg' },
              { id: 'planning', name: 'Planning', desc: 'Analyze and render urban planning layouts with custom density specs.', img: '/assets/planning_card.jpg' },
              { id: 'landscape', name: 'Landscape', desc: 'Design garden landscapes and green spaces in harmony with nature.', img: '/assets/landscape_card.jpg' }
            ].map(card => (
              <div key={card.id} onClick={() => setImageSubTab(card.id as any)} className="group cursor-pointer bg-secondary border border-border hover:border-purple-500 rounded-2xl overflow-hidden shadow-xl transition-all hover:scale-[1.02]">
                <div className="h-44 overflow-hidden relative">
                  <img src={card.img} className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-300" alt={card.name} />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                  <div className="absolute bottom-4 left-4 font-extrabold text-lg text-white">{card.name}</div>
                </div>
                <div className="p-5 text-left space-y-4">
                  <p className="text-xs text-muted-foreground min-h-[48px] leading-relaxed">{card.desc}</p>
                  <div className="text-xs font-bold text-purple-400 group-hover:text-purple-300 flex items-center gap-1">Start now &rarr;</div>
                </div>
              </div>
            ))}

            {activeTab === 'floorplan_render' && [
              { id: 'architecture', name: 'Architecture', desc: 'Convert technical plans into 3D exterior perspectives.', img: '/assets/blueprint_card.jpg' },
              { id: 'interior', name: 'Interior', desc: 'Colorize and furnish interiors from 2D drawings.', img: '/assets/interior_card.jpg' },
              { id: 'urban', name: 'Urban Render', desc: 'Master planning from subdivision maps.', img: '/assets/planning_card.jpg' },
              { id: 'landscape', name: 'Landscape Render', desc: 'Landscape garden design from site plans.', img: '/assets/landscape_card.jpg' }
            ].map(card => (
              <div key={card.id} onClick={() => setFloorPlanSubTab(card.id as any)} className="group cursor-pointer bg-secondary border border-border hover:border-purple-500 rounded-2xl overflow-hidden shadow-xl transition-all hover:scale-[1.02]">
                <div className="h-44 overflow-hidden relative">
                  <img src={card.img} className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-300" alt={card.name} />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                  <div className="absolute bottom-4 left-4 font-extrabold text-lg text-white">{card.name}</div>
                </div>
                <div className="p-5 text-left space-y-4">
                  <p className="text-xs text-muted-foreground min-h-[48px] leading-relaxed">{card.desc}</p>
                  <div className="text-xs font-bold text-purple-400 group-hover:text-purple-300 flex items-center gap-1">Start now &rarr;</div>
                </div>
              </div>
            ))}

            {activeTab === 'ai_renovation' && [
              { id: 'interior', name: 'Interior Renovation', desc: 'Upgrade, change style and materials for indoor spaces.', img: '/assets/interior_card.jpg' },
              { id: 'exterior', name: 'Exterior Renovation', desc: 'Refresh facade, change architecture massing and...', img: '/assets/architecture_card.jpg' },
              { id: 'landscape', name: 'Landscape Renovation', desc: 'Replan landscape, add greenery and outdoor features.', img: '/assets/landscape_card.jpg' },
              { id: 'spatial_function', name: 'Spatial Function Design', desc: 'Rearrange spatial functions and layout based on current photo.', img: '/assets/interior_card.jpg' }
            ].map(card => (
              <div key={card.id} onClick={() => setRenovationSubTab(card.id as any)} className="group cursor-pointer bg-secondary border border-border hover:border-purple-500 rounded-2xl overflow-hidden shadow-xl transition-all hover:scale-[1.02]">
                <div className="h-44 overflow-hidden relative">
                  <img src={card.img} className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-300" alt={card.name} />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                  <div className="absolute bottom-4 left-4 font-extrabold text-lg text-white">{card.name}</div>
                </div>
                <div className="p-5 text-left space-y-4">
                  <p className="text-xs text-muted-foreground min-h-[48px] leading-relaxed">{card.desc}</p>
                  <div className="text-xs font-bold text-purple-400 group-hover:text-purple-300 flex items-center gap-1">Start now &rarr;</div>
                </div>
              </div>
            ))}

            {activeTab === 'view_sync' && [
              { id: 'single', name: 'Single View', desc: 'Generate single synchronized view from specified keyframes.', img: '/assets/architecture_card.jpg' },
              { id: 'batch', name: 'Batch View', desc: 'Render multiple synchronous coordinate angles in parallel batches.', img: '/assets/planning_card.jpg' },
              { id: 'creative', name: 'Creative View', desc: 'Create a complete synchronous matrix grid design layout.', img: '/assets/interior_card.jpg' }
            ].map(card => (
              <div key={card.id} onClick={() => setViewSyncSubTab(card.id as any)} className="group cursor-pointer bg-secondary border border-border hover:border-purple-500 rounded-2xl overflow-hidden shadow-xl transition-all hover:scale-[1.02]">
                <div className="h-44 overflow-hidden relative">
                  <img src={card.img} className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-300" alt={card.name} />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                  <div className="absolute bottom-4 left-4 font-extrabold text-lg text-white">{card.name}</div>
                </div>
                <div className="p-5 text-left space-y-4">
                  <p className="text-xs text-muted-foreground min-h-[48px] leading-relaxed">{card.desc}</p>
                  <div className="text-xs font-bold text-purple-400 group-hover:text-purple-300 flex items-center gap-1">Start now &rarr;</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ==================== ACTIVE PARAM CONTROL WORKSPACE ==================== */
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <button onClick={handleBackToDashboard} className="flex items-center gap-2 px-3 py-1.5 bg-secondary border border-border hover:border-border text-xs font-bold rounded-lg text-purple-400 transition-colors">
              <ArrowLeft size={14} /> {t('arch.back', 'Back')}
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary border border-border rounded-lg">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse" />
                Mode: <span className="text-foreground">{activeSubTab.toUpperCase()}</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Parameter Side Panel */}
            <div className="lg:col-span-5 bg-secondary border border-border rounded-2xl p-5 space-y-6 shadow-xl">
              
              {/* ==================== 1. IMAGE RENDER CUSTOM FORMS ==================== */}
              {activeTab === 'image_render' && (
                <div className="space-y-6 animate-fade-in">
                  <div>
                    <label className="block text-xs font-bold text-foreground uppercase tracking-wider mb-2">1. Upload Sketch / Image <HelpCircle size={12} className="inline text-muted-foreground ml-1" /></label>
                    <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-border hover:border-purple-500 rounded-xl p-6 flex flex-col items-center justify-center bg-card hover:bg-secondary transition-all cursor-pointer">
                      <Upload size={20} className="text-purple-400 mb-2" />
                      <span className="text-xs text-foreground font-bold">{t('arch.add_sketch', 'Add Sketch Image')} ({sourceImageUrls.length}/5)</span>
                      <span className="text-[10px] text-muted-foreground mt-1">{t('arch.sketch_desc', 'Supports PNG, JPG, JPEG')}</span>
                    </div>

                    {/* Display Uploaded Thumbnails Directly Under Upload Box */}
                    {sourceImageUrls.length > 0 && (
                      <div className="mt-3 grid grid-cols-5 gap-2 border border-border bg-card p-2 rounded-xl">
                        {sourceImageUrls.map((url, idx) => (
                          <div key={idx} className="relative aspect-square rounded-lg border border-border overflow-hidden group bg-secondary">
                            <img src={url} className="w-full h-full object-cover" alt={`Sketch ${idx + 1}`} />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSourceImageUrls(prev => prev.filter((_, i) => i !== idx));
                              }}
                              className="absolute top-1 right-1 p-0.5 bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors z-10"
                            >
                              <X size={8} />
                            </button>
                            <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-center text-muted-foreground font-medium py-0.5">
                              #{idx + 1}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <span className="text-xs font-bold text-foreground block mb-2 uppercase tracking-wider">{t('arch.prompt', 'Describe Idea (Prompt):')}</span>
                    <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="w-full h-24 bg-card border border-border rounded-xl p-2.5 text-xs text-foreground resize-none focus:border-purple-500" placeholder={t('arch.prompt_placeholder', 'Type what you want to generate...')} />
                  </div>

                  {/* Mode-Specific Parameter Sets */}
                  {imageSubTab === 'architecture' && (
                    <div className="space-y-4">
                      <span className="block text-xs font-bold text-purple-400 uppercase tracking-wider border-b border-border pb-1">{t('arch.details', '3. Detailed Options')}</span>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Building Type:</span>
                          <select value={buildingType} onChange={(e) => setBuildingType(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="villa">Residential Villa</option>
                            <option value="highrise">High-Rise Apartment</option>
                            <option value="commercial">Commercial Office</option>
                            <option value="resort">Resort & Spa</option>
                            <option value="townhouse">Modern Townhouse</option>
                            <option value="hospital">Hospital/Clinic</option>
                            <option value="school">School/Campus</option>
                            <option value="museum">Museum/Exhibition Hall</option>
                            <option value="factory">Industrial Factory</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Architecture style:</span>
                          <select value={style} onChange={(e) => setStyle(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="modern">Modern Minimalist</option>
                            <option value="brutalist">Brutalist Concrete</option>
                            <option value="scandinavian">Scandinavian</option>
                            <option value="indochine">Indochine Chic</option>
                            <option value="classic">Classical Mansion</option>
                            <option value="neoclassical">Neoclassical Elegance</option>
                            <option value="artdeco">Art Deco Glamour</option>
                            <option value="hightech">High-Tech Futuristic</option>
                            <option value="traditional">Traditional Vietnamese</option>
                            <option value="organic">Organic Architecture</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">View Type:</span>
                          <select value={viewType} onChange={(e) => setViewType(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="facade">Front Facade</option>
                            <option value="perspective">3/4 Perspective</option>
                            <option value="bird_eye">Bird's Eye View</option>
                            <option value="closeup">Extreme Close-Up</option>
                            <option value="street_level">Street Level Eye-Line</option>
                            <option value="interior_ext">Interior-to-Exterior</option>
                            <option value="orthographic">Top-Down Orthographic</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Environment context:</span>
                          <select value={environmentContext} onChange={(e) => setEnvironmentContext(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="forest">Lush Forest</option>
                            <option value="urban">Urban Street</option>
                            <option value="waterfront">Waterfront River</option>
                            <option value="mountain">Snow Mountain</option>
                            <option value="desert">Sandy Desert Oasis</option>
                            <option value="beach">Tropical Beachfront</option>
                            <option value="farm">Countryside Farm</option>
                            <option value="cliffside">Cliffside/Coastal</option>
                            <option value="suburban">Suburban Neighborhood</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Lighting:</span>
                          <select value={lightingPreset} onChange={(e) => setLightingPreset(e.target.value as any)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="day">Sunny Noon</option>
                            <option value="golden_hour">Natural Sunset</option>
                            <option value="night">Twilight Magic</option>
                            <option value="overcast">Overcast Day</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Weather:</span>
                          <select value={weatherEffect} onChange={(e) => setWeatherEffect(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="sunny">Golden Sunshine</option>
                            <option value="mist">Heavy Mist</option>
                            <option value="rain">Soft Rain</option>
                            <option value="snow">Light Snow</option>
                            <option value="cloudy">Overcast Cloudy</option>
                            <option value="thunderstorm">Dramatic Thunderstorm</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {imageSubTab === 'interior' && (
                    <div className="space-y-4">
                      <span className="block text-xs font-bold text-purple-400 uppercase tracking-wider border-b border-border pb-1">3. Detailed Options</span>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Room Type:</span>
                          <select value={roomType} onChange={(e) => setRoomType(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="living_room">Living Room</option>
                            <option value="bedroom">Bedroom</option>
                            <option value="kitchen">Kitchen & Dining</option>
                            <option value="office">Home Office</option>
                            <option value="bathroom">Luxury Bathroom</option>
                            <option value="closet">Walk-in Closet</option>
                            <option value="wine_cellar">Wine Cellar</option>
                            <option value="kids_room">Kids Room</option>
                            <option value="reception">Lobby/Reception</option>
                            <option value="restaurant">Cafe/Restaurant</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Architecture style:</span>
                          <select value={style} onChange={(e) => setStyle(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="minimalist">Japandi Minimalist</option>
                            <option value="classic">Mid-Century Modern</option>
                            <option value="industrial">Industrial Loft</option>
                            <option value="modern">Bohemian Chic</option>
                            <option value="scandinavian">Scandinavian Comfort</option>
                            <option value="indochine_classic">Indochine Classic</option>
                            <option value="neoclassical_luxury">Neoclassical Luxury</option>
                            <option value="art_deco_interior">Art Deco Luxury</option>
                            <option value="rustic_cabin">Rustic Log Cabin</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Lighting:</span>
                          <select value={lightingPreset} onChange={(e) => setLightingPreset(e.target.value as any)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="day">Soft Warm Ambient</option>
                            <option value="golden_hour">Natural Studio Light</option>
                            <option value="night">Moody Twilight</option>
                            <option value="overcast">Dramatic Spotlights</option>
                            <option value="candlelight">Cozy Candlelight</option>
                            <option value="neon">Neon Glow</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Color Palette:</span>
                          <select value={colorPalette} onChange={(e) => setColorPalette(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="muted_pastels">Muted Earth Tones</option>
                            <option value="dark_moody">Monochrome B&W</option>
                            <option value="warm_terracotta">Creamy Off-Whites</option>
                            <option value="sage_green_wood">Sage Green & Oak</option>
                            <option value="terracotta_brass">Terracotta & Brass</option>
                            <option value="royal_blue_gold">Royal Blue & Gold</option>
                            <option value="emerald_walnut">Emerald & Walnut</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {imageSubTab === 'planning' && (
                    <div className="space-y-4">
                      <span className="block text-xs font-bold text-purple-400 uppercase tracking-wider border-b border-border pb-1">3. Detailed Options</span>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Planning Mode:</span>
                          <select value={style} onChange={(e) => setStyle(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="eco">Eco-District</option>
                            <option value="industrial">Industrial Park</option>
                            <option value="waterfront">Marina Waterfront</option>
                            <option value="commercial">High-Density Central Hub</option>
                            <option value="suburban">Suburban Subdivision</option>
                            <option value="smartcity">Smart City Tech Center</option>
                            <option value="campus">University/College Campus</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Density Level:</span>
                          <select value={urbanDensity} onChange={(e) => setUrbanDensity(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="thấp">Low-Density Green Town</option>
                            <option value="trung bình">Medium-Density Satellite</option>
                            <option value="cao">Ultra-High Mega Metropolis</option>
                            <option value="coastal">Low-Density Coastal Village</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Graphic Style:</span>
                          <select value={cameraAngle} onChange={(e) => setCameraAngle(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="photo">Satellite Photography</option>
                            <option value="massing">3D Architectural Massing</option>
                            <option value="sketch">Technical Sketch Illustration</option>
                            <option value="watercolor">Watercolor Masterplan</option>
                            <option value="blueprint">Technical CAD Draft Blueprint</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {imageSubTab === 'landscape' && (
                    <div className="space-y-4">
                      <span className="block text-xs font-bold text-purple-400 uppercase tracking-wider border-b border-border pb-1">3. Detailed Options</span>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Garden Style:</span>
                          <select value={gardenTheme} onChange={(e) => setGardenTheme(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="zen_nhật">Zen Japanese</option>
                            <option value="châu_âu">Royal French Formal</option>
                            <option value="nhiệt_đới">Wild Tropical Jungle</option>
                            <option value="sa_mạc">Modern Desert Xeriscape</option>
                            <option value="cottage">English Cottage Garden</option>
                            <option value="mediterranean">Mediterranean Oasis</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Core Element:</span>
                          <select value={additionElement} onChange={(e) => setAdditionElement(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="hồ_koi">Ornamental Koi Pond</option>
                            <option value="pathway">Stone Paved Path</option>
                            <option value="decking">Wooden Deck & Seating</option>
                            <option value="rocks">Mossy Waterfall Rocks</option>
                            <option value="pool">Infinity Swimming Pool</option>
                            <option value="gazebo">Wooden Pergola/Gazebo</option>
                            <option value="outdoor_kitchen">Gourmet Outdoor Kitchen</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ==================== 2. FLOOR PLAN CUSTOM FORMS ==================== */}
              {activeTab === 'floorplan_render' && (
                <div className="space-y-6 animate-fade-in">
                  <div>
                    <label className="block text-xs font-bold text-foreground uppercase tracking-wider mb-2">1. Upload 2D Layout Sketch <HelpCircle size={12} className="inline text-muted-foreground ml-1" /></label>
                    <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-border hover:border-purple-500 rounded-xl p-6 flex flex-col items-center justify-center bg-card hover:bg-secondary transition-all cursor-pointer">
                      <Upload size={20} className="text-purple-400 mb-2" />
                      <span className="text-xs text-foreground font-bold">Add Blueprint File ({sourceImageUrls.length}/5)</span>
                      <span className="text-[10px] text-muted-foreground mt-1">Supports PNG, JPG, JPEG, DXF</span>
                    </div>

                    {/* Display Uploaded Thumbnails Directly Under Upload Box */}
                    {sourceImageUrls.length > 0 && (
                      <div className="mt-3 grid grid-cols-5 gap-2 border border-border bg-card p-2 rounded-xl">
                        {sourceImageUrls.map((url, idx) => (
                          <div key={idx} className="relative aspect-square rounded-lg border border-border overflow-hidden group bg-secondary">
                            <img src={url} className="w-full h-full object-cover" alt={`Sketch ${idx + 1}`} />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSourceImageUrls(prev => prev.filter((_, i) => i !== idx));
                              }}
                              className="absolute top-1 right-1 p-0.5 bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors z-10"
                            >
                              <X size={8} />
                            </button>
                            <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-center text-muted-foreground font-medium py-0.5">
                              #{idx + 1}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <span className="text-xs font-bold text-foreground block mb-2 uppercase tracking-wider">Describe Floor Plan Specs:</span>
                    <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="w-full h-24 bg-card border border-border rounded-xl p-2.5 text-xs text-foreground resize-none focus:border-purple-500" placeholder="Type floor plan parameters..." />
                  </div>

                  {floorPlanSubTab === 'architecture' && (
                    <div className="space-y-4">
                      <span className="block text-xs font-bold text-purple-400 uppercase tracking-wider border-b border-border pb-1">3. Detailed Options</span>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Wall Height:</span>
                          <input type="number" step="0.1" value={wallHeight} onChange={(e) => setWallHeight(e.target.value)} className="w-full bg-card border border-border text-xs p-2 rounded-lg text-foreground" />
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Unit System:</span>
                          <select value={measurementUnit} onChange={(e) => setMeasurementUnit(e.target.value as any)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="m">Metric (m)</option>
                            <option value="ft">Imperial (ft)</option>
                            <option value="mm">Metric (mm)</option>
                          </select>
                        </div>
                        <div className="col-span-2">
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Wall Line Style:</span>
                          <select value={wallStyle} onChange={(e) => setWallStyle(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="đen_đặc">Solid Black CAD</option>
                            <option value="xám_mỏng">Tech Thin Grey</option>
                            <option value="nét_sketch">Artistic Pencil Sketch</option>
                            <option value="hatch">Double-Line Hatch</option>
                            <option value="red_blueprint">Red Blueprint Style</option>
                            <option value="blue_draft">Blue Draft Sketch</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {floorPlanSubTab === 'interior' && (
                    <div className="space-y-4">
                      <span className="block text-xs font-bold text-purple-400 uppercase tracking-wider border-b border-border pb-1">3. Detailed Options</span>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Flooring Material:</span>
                          <select value={flooringMaterial} onChange={(e) => setFlooringMaterial(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="oak">Light European Oak</option>
                            <option value="walnut">Dark Walnut Timber</option>
                            <option value="marble">Polished Carrara Marble</option>
                            <option value="terrazzo">Cast Terrazzo</option>
                            <option value="parquet">Chevron Parquet Wood</option>
                            <option value="polished_concrete">Polished Industrial Concrete</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Furnishing Density:</span>
                          <select value={furnishingDensity} onChange={(e) => setFurnishingDensity(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="compact">Compact Micro-Apartment</option>
                            <option value="standard">Standard Spacious Layout</option>
                            <option value="open">Open-Plan Loft Staging</option>
                            <option value="minimalist_bare">Minimalist Bare Bones</option>
                            <option value="luxury_suite">Executive Luxury Suite</option>
                          </select>
                        </div>
                        <div className="col-span-2">
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Rendering Quality Style:</span>
                          <select value={style} onChange={(e) => setStyle(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="render3d">High-Fidelity 3D Plan</option>
                            <option value="layout2d">Styled 2D Layout</option>
                            <option value="watercolor_floor">Hand-painted Watercolor</option>
                            <option value="isometric_stage">3D Isometric Staging</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {floorPlanSubTab === 'urban' && (
                    <div className="space-y-4">
                      <span className="block text-xs font-bold text-purple-400 uppercase tracking-wider border-b border-border pb-1">3. Detailed Options</span>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Color Palette:</span>
                          <select value={zoningPalette} onChange={(e) => setZoningPalette(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="pastel">Classic Zoning Pastel</option>
                            <option value="contrast">High-Contrast Masterplan</option>
                            <option value="grey">Technical Monochromatic</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Legend Type:</span>
                          <select value={legendType} onChange={(e) => setLegendType(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="iso">Detailed ISO Standard</option>
                            <option value="basic">Basic Functional Labels</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {floorPlanSubTab === 'landscape' && (
                    <div className="space-y-4">
                      <span className="block text-xs font-bold text-purple-400 uppercase tracking-wider border-b border-border pb-1">3. Detailed Options</span>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Paving Material:</span>
                          <select value={walkwayStyle} onChange={(e) => setWalkwayStyle(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="aggregate">Exposed Aggregate Concrete</option>
                            <option value="decking">Recycled Outdoor Decking</option>
                            <option value="granite">Fine Granite Setts</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Vegetation Overlay:</span>
                          <select value={vegetationOverlay} onChange={(e) => setVegetationOverlay(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="forest">Dense Forest Shrubbery</option>
                            <option value="lawn">Clean Manicured Lawns</option>
                            <option value="flowerbed">Ornamental Flowerbeds</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ==================== 3. AI RENOVATION CUSTOM FORMS ==================== */}
              {activeTab === 'ai_renovation' && (
                <div className="space-y-6 animate-fade-in">
                  <div>
                    <label className="block text-xs font-bold text-foreground uppercase tracking-wider mb-2">1. Upload Image to Renovate <HelpCircle size={12} className="inline text-muted-foreground ml-1" /></label>
                    <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-border hover:border-purple-500 rounded-xl p-6 flex flex-col items-center justify-center bg-card hover:bg-secondary transition-all cursor-pointer">
                      <Upload size={20} className="text-purple-400 mb-2" />
                      <span className="text-xs text-foreground font-bold">Add Space Image ({sourceImageUrls.length}/5)</span>
                      <span className="text-[10px] text-muted-foreground mt-1">Select current physical photos</span>
                    </div>

                    {/* Display Uploaded Thumbnails Directly Under Upload Box */}
                    {sourceImageUrls.length > 0 && (
                      <div className="mt-3 grid grid-cols-5 gap-2 border border-border bg-card p-2 rounded-xl">
                        {sourceImageUrls.map((url, idx) => (
                          <div key={idx} className="relative aspect-square rounded-lg border border-border overflow-hidden group bg-secondary">
                            <img src={url} className="w-full h-full object-cover" alt={`Sketch ${idx + 1}`} />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSourceImageUrls(prev => prev.filter((_, i) => i !== idx));
                              }}
                              className="absolute top-1 right-1 p-0.5 bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors z-10"
                            >
                              <X size={8} />
                            </button>
                            <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-center text-muted-foreground font-medium py-0.5">
                              #{idx + 1}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <span className="text-xs font-bold text-foreground block mb-2 uppercase tracking-wider">Describe Renovation Style:</span>
                    <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="w-full h-24 bg-card border border-border rounded-xl p-2.5 text-xs text-foreground resize-none focus:border-purple-500" placeholder="Type design edit requirements..." />
                  </div>

                  {renovationSubTab === 'interior' && (
                    <div className="space-y-4">
                      <span className="block text-xs font-bold text-purple-400 uppercase tracking-wider border-b border-border pb-1">3. Detailed Options</span>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Renovation Mode:</span>
                          <div className="flex gap-2 bg-card p-1 rounded-lg border border-border">
                            <button type="button" onClick={() => setRenovationSubMode('empty_room')} className={`flex-1 py-1 text-[10px] font-bold rounded transition-all ${renovationSubMode === 'empty_room' ? 'bg-purple-600 text-white' : 'text-muted-foreground'}`}>Virtual Staging</button>
                            <button type="button" onClick={() => setRenovationSubMode('redesign')} className={`flex-1 py-1 text-[10px] font-bold rounded transition-all ${renovationSubMode === 'redesign' ? 'bg-purple-600 text-white' : 'text-muted-foreground'}`}>Redesign Room</button>
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Staging Style:</span>
                          <select value={renovationStyle} onChange={(e) => setRenovationStyle(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="luxury">Luxury High-End</option>
                            <option value="japandi">Japandi Minimalist</option>
                            <option value="rustic">Rustic Farmhouse</option>
                            <option value="loft">Industrial Loft</option>
                            <option value="modern_classic">Modern Classic</option>
                            <option value="wabi_sabi">Wabi-Sabi Zen</option>
                            <option value="art_deco_renovation">Art Deco Staging</option>
                            <option value="boho_eclectic">Eclectic Bohemian</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Color Scheme:</span>
                          <select value={colorPalettePreset} onChange={(e) => setColorPalettePreset(e.target.value as any)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="earth_tones">Earthy Terracottas</option>
                            <option value="monochrome">Monochrome Neutrals</option>
                            <option value="pastel">Soft Pastel Hues</option>
                            <option value="warm_wood">Rich Forest Greens</option>
                            <option value="coastal_blue">Coastal Blue & Sandy Beige</option>
                            <option value="brass_charcoal">Brass & Charcoal Slate</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {renovationSubTab === 'exterior' && (
                    <div className="space-y-4">
                      <span className="block text-xs font-bold text-purple-400 uppercase tracking-wider border-b border-border pb-1">3. Detailed Options</span>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Primary Cladding:</span>
                          <select value={primaryCladding} onChange={(e) => setPrimaryCladding(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="glass">Floor-to-Ceiling Glass</option>
                            <option value="timber">Vertical Timber Battens</option>
                            <option value="concrete">Board-Formed Concrete</option>
                            <option value="stone">Natural Stone Veneer</option>
                            <option value="terracotta_tiles">Terracotta Facade Tiles</option>
                            <option value="metal_panels">Corrugated Metal Panels</option>
                            <option value="classic_stucco">Traditional White Stucco</option>
                            <option value="exposed_brick">Exposed Red Brick</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Window System:</span>
                          <select value={windowSystem} onChange={(e) => setWindowSystem(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="aluminum">Slim Aluminum</option>
                            <option value="timber">Solid Timber Frame</option>
                            <option value="steel">Industrial Black Steel</option>
                            <option value="frameless">Frameless Structural Glass</option>
                            <option value="arched_classic">Arched Classic Frames</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {renovationSubTab === 'landscape' && (
                    <div className="space-y-4">
                      <span className="block text-xs font-bold text-purple-400 uppercase tracking-wider border-b border-border pb-1">3. Detailed Options</span>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Landscape Feature:</span>
                          <select value={additionElement} onChange={(e) => setAdditionElement(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="pool">Infinite Glass Pool</option>
                            <option value="pond">Tranquil Koi Pond Cascade</option>
                            <option value="gazebo">Gazebo Timber Pavillion</option>
                            <option value="deck">Lounge Decking Patio</option>
                            <option value="firepit_circle">Firepit Social Circle</option>
                            <option value="zen_courtyard">Zen Sand Courtyard</option>
                            <option value="bbq_bar">Outdoor BBQ Bar</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Foliage Density:</span>
                          <select value={vegetationOverlay} onChange={(e) => setVegetationOverlay(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="sparse">Sparse Minimalist</option>
                            <option value="lush">Layered Lush Shrubbery</option>
                            <option value="jungle">Wild Jungle Canopy</option>
                            <option value="topiary">Manicured Topiary Garden</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {renovationSubTab === 'spatial_function' && (
                    <div className="space-y-4">
                      <span className="block text-xs font-bold text-purple-400 uppercase tracking-wider border-b border-border pb-1">3. Detailed Options</span>
                      <div>
                        <span className="text-[10px] text-muted-foreground font-bold block mb-1">Divider Mechanism:</span>
                        <select value={dividerType} onChange={(e) => setDividerType(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                          <option value="default">Default</option>
                          <option value="wood">Minimalist CNC Timber Screen</option>
                          <option value="glass">Frameless Slim Sliding Glass</option>
                          <option value="bookcase">Floating Dual-Sided Bookcase</option>
                          <option value="drape">Soft Linen Drapes</option>
                          <option value="green_wall">Living Green Moss Wall</option>
                          <option value="fireplace">Double-sided Stone Fireplace</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ==================== 4. VIEW SYNC CUSTOM FORMS ==================== */}
              {activeTab === 'view_sync' && (
                <div className="space-y-6 animate-fade-in">
                  <div>
                    <label className="block text-xs font-bold text-foreground uppercase tracking-wider mb-2">1. Upload Source Image <HelpCircle size={12} className="inline text-muted-foreground ml-1" /></label>
                    <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-border hover:border-purple-500 rounded-xl p-6 flex flex-col items-center justify-center bg-card hover:bg-secondary transition-all cursor-pointer">
                      <Upload size={20} className="text-purple-400 mb-2" />
                      <span className="text-xs text-foreground font-bold">Add Source Image ({sourceImageUrls.length}/5)</span>
                      <span className="text-[10px] text-muted-foreground mt-1">Supports PNG, JPG, JPEG</span>
                    </div>

                    {/* Display Uploaded Thumbnails Directly Under Upload Box */}
                    {sourceImageUrls.length > 0 && (
                      <div className="mt-3 grid grid-cols-5 gap-2 border border-border bg-card p-2 rounded-xl">
                        {sourceImageUrls.map((url, idx) => (
                          <div key={idx} className="relative aspect-square rounded-lg border border-border overflow-hidden group bg-secondary">
                            <img src={url} className="w-full h-full object-cover" alt={`Sketch ${idx + 1}`} />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSourceImageUrls(prev => prev.filter((_, i) => i !== idx));
                              }}
                              className="absolute top-1 right-1 p-0.5 bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors z-10"
                            >
                              <X size={8} />
                            </button>
                            <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-center text-muted-foreground font-medium py-0.5">
                              #{idx + 1}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {viewSyncSubTab === 'single' && (
                    <div className="space-y-4">
                      <span className="block text-xs font-bold text-purple-400 uppercase tracking-wider border-b border-border pb-1">2. Customize view</span>
                      
                      {/* Customize View Mode Toggle */}
                      <div className="flex gap-2 bg-card p-1 rounded-lg border border-border">
                        <button type="button" onClick={() => setSyncCustomizeView('exterior')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${syncCustomizeView === 'exterior' ? 'bg-purple-600 text-white' : 'text-muted-foreground'}`}>Exterior</button>
                        <button type="button" onClick={() => setSyncCustomizeView('interior')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${syncCustomizeView === 'interior' ? 'bg-purple-600 text-white' : 'text-muted-foreground'}`}>Interior</button>
                      </div>

                      {/* Customize View Options */}
                      <div className="space-y-3 bg-card p-3.5 border border-border rounded-xl">
                        <div>
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Select {syncCustomizeView === 'exterior' ? 'Exterior Angle' : 'Interior Room'}:</span>
                          <select value={viewSyncAngle} onChange={(e) => setViewSyncAngle(e.target.value)} className="w-full bg-secondary border border-border text-xs p-2 rounded-lg text-foreground">
                            {syncCustomizeView === 'exterior' ? (
                              <>
                                <option value="default">Default</option>
                                <option value="facade">Facade view</option>
                                <option value="bird_eye">Bird eye view</option>
                                <option value="closeup">Close up view</option>
                              </>
                            ) : (
                              <>
                                <option value="default">Default</option>
                                <option value="living_room">Living Room</option>
                                <option value="bedroom">Bedroom</option>
                                <option value="kitchen">Kitchen</option>
                                <option value="office">Office</option>
                              </>
                            )}
                          </select>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-[10px] text-muted-foreground font-bold block mb-1">Framing effect:</span>
                            <select value={viewSyncFraming} onChange={(e) => setViewSyncFraming(e.target.value)} className="w-full bg-secondary border border-border text-xs p-2 rounded-lg text-foreground">
                              <option value="default">Default</option>
                              <option value="none">None</option>
                              <option value="panning">Panning Left/Right</option>
                              <option value="zoom">Slow Zoom In</option>
                              <option value="orbit">Orbit 360°</option>
                              <option value="crane">Crane Up/Down</option>
                              <option value="cinematic">Cinematic Dolly Motion</option>
                            </select>
                          </div>

                          <div>
                            <span className="text-[10px] text-muted-foreground font-bold block mb-1">Time / Atmosphere:</span>
                            <select value={viewSyncAtmosphere} onChange={(e) => setViewSyncAtmosphere(e.target.value)} className="w-full bg-secondary border border-border text-xs p-2 rounded-lg text-foreground">
                              <option value="default">Default</option>
                              <option value="day">Daylight</option>
                              <option value="night">Nightlight</option>
                              <option value="sunset">Sunset Glow</option>
                              <option value="misty">Dawn / Misty Morning</option>
                              <option value="stormy">Stormy Twilight</option>
                              <option value="cyberpunk">Cyberpunk Neon</option>
                            </select>
                          </div>

                          <div>
                            <span className="text-[10px] text-muted-foreground font-bold block mb-1">Camera Path / Motion:</span>
                            <select value={cameraPath} onChange={(e) => setCameraPath(e.target.value)} className="w-full bg-secondary border border-border text-xs p-2 rounded-lg text-foreground">
                              <option value="default">Default</option>
                              <option value="lia_ngang">Horizontal Pan (Lia ngang)</option>
                              <option value="tien_lung">Push Forward (Tiến lùi)</option>
                              <option value="goc_cao">High Angle Pan (Góc cao)</option>
                              <option value="goc_thap">Low Angle Up (Góc thấp)</option>
                              <option value="diagonal">Diagonal Tracking</option>
                              <option value="tilt">Tilt Up/Down</option>
                            </select>
                          </div>

                          <div>
                            <span className="text-[10px] text-muted-foreground font-bold block mb-1">Video Duration:</span>
                            <select value={videoDuration} onChange={(e) => setVideoDuration(e.target.value)} className="w-full bg-secondary border border-border text-xs p-2 rounded-lg text-foreground">
                              <option value="default">Default</option>
                              <option value="5s">5 Seconds</option>
                              <option value="10s">10 Seconds</option>
                              <option value="15s">15 Seconds</option>
                              <option value="30s">30 Seconds</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div>
                        <span className="text-xs font-bold text-foreground block mb-2 uppercase tracking-wider">Describe View Idea (Prompt):</span>
                        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="w-full h-20 bg-card border border-border rounded-xl p-2.5 text-xs text-foreground resize-none focus:border-purple-500" placeholder="Type custom view enhancements..." />
                      </div>
                    </div>
                  )}

                  {viewSyncSubTab === 'batch' && (
                    <div className="space-y-4">
                      <span className="block text-xs font-bold text-purple-400 uppercase tracking-wider border-b border-border pb-1">3. Detailed Options</span>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Camera Setup Angles:</span>
                          <select value={batchCount} onChange={(e) => setBatchCount(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="3_góc">3 Angles (Front, 45°, Close-Up)</option>
                            <option value="5_góc">5 Tech Structural Angles</option>
                            <option value="8_góc">8 Full Submission Profiles</option>
                          </select>
                        </div>
                        <div className="col-span-2">
                          <span className="text-[10px] text-muted-foreground font-bold block mb-1">Lighting Continuity:</span>
                          <select value={lightingContinuity} onChange={(e) => setLightingContinuity(e.target.value)} className="w-full bg-card border border-border text-xs p-2.5 rounded-lg text-foreground">
                            <option value="default">Default</option>
                            <option value="match">Match Keyframe Environment</option>
                            <option value="sync">Sync Symmetrical Twilight</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Universal Brand & Model Selection Selection */}
              <div className="border-t border-border/50 pt-4 space-y-4">
                {/* Quality & Resolution Matrix */}
                <div>
                  <label className="block text-xs font-bold text-foreground uppercase tracking-wider mb-2">
                    Quality & Resolution
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      {
                        id: 'models/gemini-3.1-flash-lite-image',
                        label: 'Standard',
                        desc: 'Standard Fast',
                        cost: 7,
                        badge: 'Fast'
                      },
                      {
                        id: 'models/gemini-3.1-flash-image',
                        label: 'HD (1K)',
                        desc: 'Detail 1K',
                        cost: 14,
                        badge: 'Detailed'
                      },
                      {
                        id: 'models/gemini-3-pro-image',
                        label: '2K QHD',
                        desc: 'Sharp 2K',
                        cost: 20,
                        badge: 'Sharp'
                      },
                      {
                        id: 'models/gemini-2.5-flash-image',
                        label: '4K UHD',
                        desc: '4K UHD Realistic',
                        cost: 48,
                        badge: 'Realistic'
                      }
                    ].map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => setModelType(q.id)}
                        className={`relative p-3 rounded-xl border text-left transition-all ${
                          modelType === q.id
                            ? 'bg-purple-950/20 border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.15)]'
                            : 'bg-card border-border hover:border-border'
                        }`}
                      >
                        <span className="absolute top-2 right-2 px-1.5 py-0.5 bg-secondary border border-border text-[8px] font-bold text-muted-foreground rounded-md uppercase tracking-wider">
                          {q.badge}
                        </span>
                        <div className="text-xs font-extrabold text-foreground">{q.label}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{q.desc}</div>
                        <div className="flex items-center gap-1 mt-2.5 text-xs font-extrabold text-purple-400">
                          <span>{q.cost} 🪙</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Number of Images to Render */}
                <div>
                  <label className="block text-xs font-bold text-foreground uppercase tracking-wider mb-2">
                    Number of Images
                  </label>
                  <div className="flex gap-2 bg-card p-1 rounded-xl border border-border">
                    {[1, 2, 3, 4].map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => setImageCount(count)}
                        className={`flex-1 py-1.5 text-xs font-extrabold rounded-lg transition-all ${
                          imageCount === count
                            ? 'bg-purple-600 text-white shadow'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Universal Aspect Ratio Selection */}
              <div>
                <label className="block text-xs font-bold text-foreground uppercase tracking-wider mb-2">{t('arch.aspect_ratio', 'Aspect Ratio')}</label>
                <div className="flex gap-2">
                  {['1:1', '4:3', '3:4', '16:9'].map(ratio => (
                    <button key={ratio} type="button" onClick={() => setAspectRatio(ratio)} className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border text-center transition-all ${aspectRatio === ratio ? 'bg-purple-500 text-white border-transparent' : 'border-border text-muted-foreground'}`}>
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>

              {/* Universal Negative Prompt Exclusions */}
              <div>
                <label className="block text-xs font-bold text-foreground uppercase tracking-wider mb-2">{t('arch.negative_prompt', 'Negative Prompt')}</label>
                <textarea value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} className="w-full h-16 bg-card border border-border rounded-xl p-2.5 text-xs text-foreground resize-none focus:border-purple-500" placeholder="e.g. no people, low quality, bad materials" />
              </div>

              {/* Render Error & Trigger */}
              {errorMsg && <div className="p-2.5 bg-red-900/15 border border-red-500/20 text-red-400 rounded-lg text-xs">⚠️ {errorMsg}</div>}

              {!(activeTab === 'view_sync' && viewSyncSubTab === 'creative') && (
                <button onClick={handleStartRender} disabled={isSubmitting} className="w-full flex items-center justify-center gap-2 py-2.5 px-4 font-bold text-xs text-white rounded-xl bg-[#7c3aed] hover:bg-[#6d28d9] transition-all hover:scale-[1.01] shadow-[0_0_15px_rgba(124,58,237,0.3)]">
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <RefreshCw size={14} className="animate-spin" /> {t('arch.submitting', 'Submitting request...')}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Sparkles size={14} /> {t('arch.start_render', 'Start Render')} | {renderCost * imageCount} 🪙
                    </span>
                  )}
                </button>
              )}
            </div>

            {/* Right Interactive Work Canvas */}
            <div className="lg:col-span-7">
              {/* Unified Preview Workspace Canvas Container */}
              <div className="bg-secondary border border-border rounded-2xl p-4 shadow-xl h-[85vh] flex flex-col animate-fade-in relative">
                
                {/* Symmetrical Canvas Segment Switcher Header */}
                <div className="flex items-center justify-between border-b border-border/80 pb-3 mb-4 shrink-0">
                  {activeTab === 'view_sync' && viewSyncSubTab === 'creative' ? (
                    <>
                      <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                        Creative Staging (9-Angle)
                      </span>
                      <div className="flex gap-2">
                        <button onClick={() => { setCreativeSubMode('interior'); setCreativeResults({}); }} className={`text-[10px] font-bold px-2.5 py-1 border rounded-lg ${creativeSubMode === 'interior' ? 'bg-purple-600/10 border-purple-500 text-purple-400' : 'border-border text-muted-foreground'}`}>Nội Thất</button>
                        <button onClick={() => { setCreativeSubMode('exterior'); setCreativeResults({}); }} className={`text-[10px] font-bold px-2.5 py-1 border rounded-lg ${creativeSubMode === 'exterior' ? 'bg-purple-600/10 border-purple-500 text-purple-400' : 'border-border text-muted-foreground'}`}>Ngoại Thất</button>
                        <button onClick={handleCreateAllCreative} className="px-2.5 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] font-bold rounded-lg shadow transition-all hover:opacity-90">Tạo Bộ | {renderCost * 9} 🪙</button>
                      </div>
                    </>
                  ) : (
                    <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                      {t('arch.rendered_image', 'Workspace Canvas Preview')}
                    </span>
                  )}
                </div>

                {/* Main Large-Format Rendering Canvas Screen (Hidden in Creative View Staging) */}
                {!(activeTab === 'view_sync' && viewSyncSubTab === 'creative') && (
                  <div className="bg-card border border-border rounded-xl overflow-hidden relative flex items-center justify-center min-h-[380px] shrink-0">
                    
                    {/* Centered Processing Capsule Overlay */}
                    {selectedTask && (selectedTask.status === 'PENDING' || selectedTask.status === 'PROCESSING') ? (
                      <div className="absolute inset-0 bg-card/80 backdrop-blur-sm flex items-center justify-center z-40">
                        <div className="px-6 py-3 bg-[#7c3aed]/10 border border-[#7c3aed]/30 rounded-full shadow-[0_0_25px_rgba(124,58,237,0.3)] flex items-center gap-3 animate-pulse">
                          <RefreshCw className="animate-spin text-purple-500" size={16} />
                          <span className="text-xs font-extrabold tracking-widest text-[#ddd6fe] uppercase">
                            {selectedTask.status === 'PENDING' ? 'PENDING...' : 'PROCESSING...'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      /* Rendering Screen Displays */
                      <div className="w-full h-full absolute inset-0 flex items-center justify-center bg-zinc-950">
                        {selectedTask && selectedTask.status === 'FAILED' ? (
                          /* If process fails, display the message directly on the right result canvas screen! */
                          <div className="text-center p-6 space-y-3 max-w-sm animate-fade-in">
                            <div className="w-12 h-12 bg-red-900/20 border border-red-500/30 text-red-400 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-red-900/10">
                              <span className="text-lg font-bold">!</span>
                            </div>
                            <div className="text-sm font-extrabold text-red-400">Kết xuất thất bại</div>
                            <p className="text-xs text-muted-foreground leading-relaxed">{selectedTask.failureReason || errorMsg || "Đã xảy ra lỗi khi kết xuất."}</p>
                            <button
                              onClick={handleStartRender}
                              className="mt-2 px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-[10px] font-bold border border-border transition-all"
                            >
                              Thử lại 🪙
                            </button>
                          </div>
                        ) : renderedImage ? (
                          <>
                            {renderedImage.endsWith('.mp4') ? (
                              <video src={renderedImage} controls autoPlay loop className="w-full h-full object-contain" />
                            ) : (
                              <img src={renderedImage} className="w-full h-full object-contain" alt="AI Generated Output" />
                            )}
                            {/* Download Action Float bar */}
                            <button
                              type="button"
                              onClick={() => {
                                const ext = renderedImage.endsWith('.mp4') ? 'mp4' : 'jpg';
                                triggerDownload(renderedImage, `render-${selectedTask?._id || 'image'}.${ext}`);
                              }}
                              className="absolute bottom-3 right-3 p-2 bg-black/85 rounded-xl border border-border hover:border-purple-500 text-white shadow transition-all hover:scale-105 z-10"
                            >
                              <Download size={14} />
                            </button>
                          </>
                        ) : (
                          /* Let it be completely empty if the user hasn't uploaded or generated anything yet */
                          <div className="text-center space-y-2">
                            <ImageIcon size={32} className="text-muted-foreground mx-auto" />
                            <div className="text-xs text-muted-foreground font-medium">{t('arch.rendering_ready', 'Sẵn sàng dựng hình AI')}</div>
                            <div className="text-[10px] text-zinc-500">{t('arch.rendering_ready_desc', 'Tải lên hình ảnh hoặc chọn mẫu để bắt đầu')}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Scrollable Bottom section for Batch results, Creative staging grid, History, and Guides */}
                <div className="flex-1 overflow-y-auto min-h-0 mt-4 pr-1 space-y-4">

                  {/* 9-Angle Staging Panel Body inside creative tab */}
                  {activeTab === 'view_sync' && viewSyncSubTab === 'creative' && (
                    <div className="space-y-4 animate-fade-in">
                      <div className="grid grid-cols-3 gap-3">
                        {(creativeSubMode === 'interior' ? INTERIOR_ROOMS : EXTERIOR_VIEWS).map((r) => (
                          <div key={r.id} className="relative aspect-video rounded-xl bg-card border border-border overflow-hidden flex flex-col justify-center items-center p-2 text-center hover:border-purple-500/50 transition-colors">
                            {creativeLoading[r.id] ? (
                              <RefreshCw size={16} className="animate-spin text-purple-500" />
                            ) : creativeResults[r.id] ? (
                              <>
                                <img src={creativeResults[r.id]} alt={r.label} className="w-full h-full object-cover absolute inset-0" />
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    triggerDownload(creativeResults[r.id], `creative-${creativeSubMode}-${r.id}.jpg`);
                                  }}
                                  className="absolute bottom-1 right-1 p-1 bg-black/80 rounded border border-border text-white z-10"
                                >
                                  <Download size={10} />
                                </button>
                              </>
                            ) : (
                              <div className="space-y-1">
                                <span className="text-[9px] font-bold block text-foreground">{r.label}</span>
                                <button
                                  type="button"
                                  onClick={() => handleCreateCreativeAngle(r.id, r.label)}
                                  className="px-2 py-0.5 bg-secondary border border-border text-[8px] font-bold rounded hover:border-border text-muted-foreground"
                                >
                                  Tạo View | {renderCost} 🪙
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {Object.keys(creativeResults).length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            Object.entries(creativeResults).forEach(([id, url]) => {
                              if (url) {
                                triggerDownload(url, `creative-${creativeSubMode}-${id}.jpg`);
                              }
                            });
                          }}
                          className="w-full py-2 bg-secondary hover:bg-border text-purple-500 border border-purple-500/20 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all"
                        >
                          <Download size={12} /> Tải Trọn Bộ ({Object.keys(creativeResults).length} ảnh)
                        </button>
                      )}
                    </div>
                  )}

                  {/* Batch Generation Results Grid */}
                  {!(activeTab === 'view_sync' && viewSyncSubTab === 'creative') && selectedTask && selectedTask.status === 'COMPLETED' && canvasSignedPaths.length > 1 && (
                    <div className="border border-border/80 bg-card p-3 rounded-xl space-y-2">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex justify-between items-center">
                        <span>Batch Outputs ({canvasSignedPaths.filter(r => r.status === 'success').length}/{canvasSignedPaths.length} Succeeded)</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              canvasSignedPaths.forEach((img, idx) => {
                                if (img.status === 'success' && img.signedUrl) {
                                  const ext = img.path && img.path.endsWith('.mp4') ? 'mp4' : 'jpg';
                                  triggerDownload(img.signedUrl, `render-${selectedTask._id}-${idx + 1}.${ext}`);
                                }
                              });
                            }}
                            className="flex items-center gap-1 px-2 py-0.5 bg-purple-950/40 hover:bg-purple-900/50 border border-purple-500/20 text-purple-300 rounded text-[8px] font-extrabold uppercase tracking-wider transition-all"
                          >
                            <Download size={10} /> Download All
                          </button>
                          <span className="text-purple-500">Click to select preview</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {canvasSignedPaths.map((res, index) => {
                          if (res.status === 'success' && res.signedUrl) {
                            const isSelected = renderedImage === res.signedUrl;
                            return (
                              <div
                                key={index}
                                onClick={() => setRenderedImage(res.signedUrl)}
                                className={`relative aspect-square rounded-lg border-2 overflow-hidden cursor-pointer group bg-secondary transition-all ${
                                  isSelected ? 'border-purple-500 scale-105 shadow-[0_0_10px_rgba(168,85,247,0.3)]' : 'border-border hover:border-zinc-500'
                                }`}
                              >
                                <img src={res.path && res.path.endsWith('.mp4') ? '/assets/video_thumbnail_placeholder.jpg' : res.signedUrl} className="w-full h-full object-cover" alt={`Render ${index + 1}`} />
                                <div className="absolute top-1 left-1 px-1 py-0.5 bg-green-950/85 border border-green-500/30 rounded text-[7px] font-bold text-green-400 uppercase">
                                  #{index + 1}
                                </div>
                                {/* Individual Image Download Icon */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const ext = res.path && res.path.endsWith('.mp4') ? 'mp4' : 'jpg';
                                    triggerDownload(res.signedUrl, `render-${selectedTask._id}-${index + 1}.${ext}`);
                                  }}
                                  className="absolute bottom-1 right-1 p-1 bg-black/80 rounded border border-border/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Tải ảnh này"
                                >
                                  <Download size={8} />
                                </button>
                              </div>
                            );
                          } else {
                            return (
                              <div
                                key={index}
                                className="relative aspect-square rounded-lg border border-red-500/30 bg-red-950/10 flex flex-col items-center justify-center p-1 text-center select-none"
                                title={res.error || "Failed generation"}
                              >
                                <X size={12} className="text-red-400 mb-0.5" />
                                <span className="text-[7px] font-extrabold text-red-400 uppercase tracking-widest leading-none">#{index + 1} Failed</span>
                                <p className="text-[5px] text-zinc-500 leading-tight line-clamp-2 mt-0.5">{res.error || "Gen error"}</p>
                                <span className="absolute bottom-1 px-1 py-0.5 bg-red-900/30 border border-red-500/20 text-[5px] text-red-300 rounded font-bold uppercase scale-90">Refunded 🪙</span>
                              </div>
                            );
                          }
                        })}
                      </div>
                    </div>
                  )}

                  {/* 5 Most Recent Generation Tasks Container (Opzen AI cloned!) */}
                  <div className="border-t border-border/80 pt-4 space-y-3">
                    <span className="text-[10px] font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5 mb-1">
                      <History size={12} className="text-purple-400" />
                      Lịch sử kết xuất gần đây
                    </span>
                    <div className="space-y-3 pr-1">
                      {history.map((taskItem) => (
                        <RecentTaskItem
                          key={taskItem._id}
                          task={taskItem}
                          isSelected={selectedTaskId === taskItem._id}
                          onClick={() => setSelectedTaskId(taskItem._id)}
                          onSelectImage={handleSelectTaskAndImage}
                        />
                      ))}
                      {history.length === 0 && (
                        <div className="text-center py-6 text-zinc-600 text-[10px]">Chưa có lịch sử kết xuất nào.</div>
                      )}
                      {history.length >= 5 && (
                        <button
                          type="button"
                          onClick={loadMoreHistory}
                          className="w-full py-2 bg-secondary/50 hover:bg-border/50 text-muted-foreground hover:text-foreground border border-border rounded-xl text-[10px] font-extrabold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5"
                        >
                          <RefreshCw size={10} className="animate-pulse" /> Xem thêm lịch sử kết xuất
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Guides, Pro Tips & Help Floating Trigger system */}
                  <div className="flex items-center justify-between gap-4 pt-2">
                    <button
                      onClick={() => { setShowGuideModal(true); setGuideActiveTab('tips'); }}
                      className="flex-1 p-2.5 bg-zinc-900/50 hover:bg-zinc-800/50 border border-border rounded-xl flex items-center justify-center gap-1.5 text-xs text-foreground font-bold transition-all"
                    >
                      💡 Pro Tips
                    </button>
                    <button
                      onClick={() => { setShowGuideModal(true); setGuideActiveTab('video'); }}
                      className="flex-1 p-2.5 bg-zinc-900/50 hover:bg-zinc-800/50 border border-border rounded-xl flex items-center justify-center gap-1.5 text-xs text-foreground font-bold transition-all"
                    >
                      🎥 Video Guide
                    </button>
                  </div>

                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Guides & Pro Tips Modal Overlay (Exactly Cloned from Opzen AI!) */}
      {showGuideModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-card border border-border rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            
            {/* Modal Navigation Header */}
            <div className="flex items-center justify-between border-b border-border p-4 bg-secondary">
              <div className="flex gap-2 bg-card p-1 rounded-xl border border-border">
                <button
                  onClick={() => setGuideActiveTab('tips')}
                  className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                    guideActiveTab === 'tips'
                      ? 'bg-purple-600 text-white shadow'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <HelpCircle size={14} /> Guides & Pro Tips
                </button>
                <button
                  onClick={() => setGuideActiveTab('video')}
                  className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                    guideActiveTab === 'video'
                      ? 'bg-purple-600 text-white shadow'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Compass size={14} /> Video Tutorial
                </button>
              </div>
              <button
                onClick={() => setShowGuideModal(false)}
                className="p-1.5 hover:bg-secondary rounded-lg text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body Container */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {guideActiveTab === 'tips' ? (
                <div className="space-y-6 animate-fade-in">
                  
                  {/* Two-Column Structured Staging and Prompt Rules */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* Left Panel: Smart Rendering Workflow */}
                    <div className="bg-secondary border border-border rounded-xl p-5 space-y-4">
                      <h4 className="text-sm font-extrabold uppercase tracking-wide text-foreground flex items-center gap-2">
                        <span className="w-1.5 h-3 bg-[#8b5cf6] rounded-full" />
                        Smart Rendering Workflow
                      </h4>
                      <ol className="space-y-2 text-xs text-muted-foreground list-decimal list-inside leading-relaxed">
                        <li><span className="text-foreground font-semibold">Upload</span> a sketch, photo, or 3D model screenshot.</li>
                        <li><span className="text-foreground font-semibold">Describe</span> your design idea using a detailed positive Prompt.</li>
                        <li><span className="text-foreground font-semibold">Choose quality</span> (HD/4K) and trigger "Start Render".</li>
                      </ol>

                      {/* Before / After Sketch and Render Side-by-Side */}
                      <div className="grid grid-cols-11 gap-2 items-center pt-2">
                        <div className="col-span-5 bg-card border border-border rounded-lg p-1.5 relative overflow-hidden aspect-square flex flex-col justify-between">
                          <span className="absolute top-1 left-1 text-[8px] bg-black/60 px-1 py-0.5 rounded text-muted-foreground font-bold z-10">INPUT PHOTO</span>
                          <img
                            src="/assets/blueprint_card.jpg"
                            className="w-full h-full object-cover rounded"
                            alt="Input Sketch"
                          />
                        </div>
                        <div className="col-span-1 text-center font-bold text-purple-400 text-sm">&rarr;</div>
                        <div className="col-span-5 bg-card border border-border rounded-lg p-1.5 relative overflow-hidden aspect-square flex flex-col justify-between">
                          <span className="absolute top-1 left-1 text-[8px] bg-black/60 px-1 py-0.5 rounded text-purple-400 font-bold z-10">AI RENDER</span>
                          <img
                            src="/assets/architecture_card.jpg"
                            className="w-full h-full object-cover rounded"
                            alt="Render Output"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Right Panel: Prompt Syntax Structure */}
                    <div className="bg-secondary border border-border rounded-xl p-5 space-y-4">
                      <h4 className="text-sm font-extrabold uppercase tracking-wide text-foreground flex items-center gap-2">
                        <span className="w-1.5 h-3 bg-[#8b5cf6] rounded-full" />
                        Architectural Plan Prompt Structure
                      </h4>
                      
                      {/* Structure Card */}
                      <div className="bg-card border border-border p-3 rounded-lg space-y-1">
                        <span className="text-[10px] font-bold text-purple-400 uppercase tracking-widest block">Standard Structure</span>
                        <p className="text-xs text-foreground leading-relaxed font-mono">
                          3D Architectural plan render + [Style] + [Materials: concrete, stone, wood] + [Landscape details] + realistic shadows + daylight
                        </p>
                      </div>

                      {/* Example Card */}
                      <div className="bg-purple-950/10 border border-purple-500/20 p-3 rounded-lg space-y-1">
                        <span className="text-[10px] font-bold text-purple-300 uppercase tracking-widest block">Illustrative Example</span>
                        <p className="text-xs text-muted-foreground leading-relaxed italic">
                          Example: 3D architectural plan render of a modern townhouse, concrete roof, granite stone front yard, small swimming pool, decorative plants, realistic daylight with sharp shadows.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Bottom: Pro Tips Box */}
                  <div className="bg-purple-900/10 border border-purple-500/20 rounded-xl p-4 flex gap-4 items-start">
                    <div className="p-2 bg-[#7c3aed]/10 text-purple-500 rounded-lg border border-[#7c3aed]/20">
                      <Sparkles size={20} />
                    </div>
                    <div className="space-y-1">
                      <h5 className="text-xs font-bold text-foreground uppercase tracking-wider">Expert Pro Tip</h5>
                      <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1 leading-relaxed">
                        <li>Match the aspect ratio to your source image for best output alignment.</li>
                        <li>Select the model type based on your desired resolution and conceptual style.</li>
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                /* Video Tutorial Tab Content */
                <div className="space-y-4 animate-fade-in flex flex-col items-center">
                  <div className="w-full max-w-2xl bg-card border border-border rounded-xl overflow-hidden shadow-lg aspect-video">
                    <iframe
                      className="w-full h-full"
                      src="https://www.youtube.com/embed/S2Cbe6Z_e8Q"
                      title="HOW TO USE BIHAND ARCH STUDIO | AI NANO BANANA PLATFORM"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    ></iframe>
                  </div>
                  <span className="text-xs text-muted-foreground">Xem video hướng dẫn chi tiết cách dựng hình, tối ưu hóa prompt và đồng bộ góc nhìn.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArchitectureStudio;
