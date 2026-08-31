import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Video, Sparkles, RefreshCw, Upload, Image as ImageIcon, Volume2,
  Download, BookOpen, Plus, Trash2, Play, Pause,
  Tv, Cpu, Coins, AlertTriangle, Music, Film, ArrowLeft, ChevronRight, Edit2
} from 'lucide-react';
import api from '../lib/api';
import { Button, Card, Badge, Modal, Pill, Input, Textarea, Select } from '../components/ui';
import { cn } from '../lib/cn';

interface FilmTaskRecord {
  _id: string;
  userId: string;
  name?: string;
  feature: 'comic' | 'vlog' | 'manim' | 'image' | 'sound';
  prompt: string;
  style: string;
  aspectRatio: string;
  modelType: string;
  voiceName?: string;
  locale?: string;
  sourcePaths?: string[];
  outputUrl?: string;
  outputSignedUrl?: string;
  comicSections?: any[];
  manimScript?: string;
  vlogStoryboard?: any;
  status?: string;
  cost: number;
  createdAt: string;
  failureReason?: string;
  numSections?: number;
}

// Programmatic Asset Downloader to bypass GCS cross-domain constraints
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
    console.error("Native download failed, opening directly:", error);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

const FilmStudio: React.FC = () => {
  const { t, language } = useLanguage();
  const { projectId } = useParams<{ projectId?: string }>();
  const navigate = useNavigate();
  
  // UI screens control: 'dashboard' means Session Manager list, 'workspace' means active timeline workspace editor
  const [currentScreen, setCurrentScreen] = useState<'dashboard' | 'workspace'>('dashboard');
  const [projects, setProjects] = useState<FilmTaskRecord[]>([]); // Static/stateless generative history runs from backend
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  
  // Decoupled Frontend-Only Local Editing Sessions List
  const [localSessions, setLocalSessions] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('film_sessions');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const saveLocalSessions = (sessions: any[]) => {
    setLocalSessions(sessions);
    localStorage.setItem('film_sessions', JSON.stringify(sessions));
  };

  // AI Asset generator panel modal toggler
  const [showAIImportModal, setShowAIImportModal] = useState<boolean>(false);
  const [aiImportTab, setAiImportTab] = useState<'comic' | 'vlog' | 'manim' | 'image' | 'sound'>('comic');
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importingTaskId, setImportingTaskId] = useState<string | null>(null); // Separation of Session ID and task ID

  // Common parameters
  const [credits, setCredits] = useState<number>(0);
  const [prompt, setPrompt] = useState<string>('');
  const [style, setStyle] = useState<string>('none');
  const [aspectRatio, setAspectRatio] = useState<string>('16:9');
  const [modelType] = useState<string>('models/gemini-3.1-flash-image');
  const [voiceName, setVoiceName] = useState<string>('Kore');
  const [locale, setLocale] = useState<string>('vi-VN');
  const [numSections, setNumSections] = useState<number>(1);
  const [sourceImageUrls, setSourceImageUrls] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Timeline-specific block selection (Active Node Editor)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [blockCaption, setBlockCaption] = useState<string>('');
  const [blockPrompt, setBlockPrompt] = useState<string>('');
  const [blockRegenerating, setBlockRegenerating] = useState<Record<string, boolean>>({});

  // Playing audio state
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playNarrationAudio = (url: string, pageId: string) => {
    if (playingAudioId === pageId) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingAudioId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setPlayingAudioId(null);
      };
      setPlayingAudioId(pageId);
      audio.play().catch(err => {
        console.error("Audio play failed:", err);
        setPlayingAudioId(null);
      });
    }
  };

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  // Previewing signed assets inside timeline
  const [previewMediaUrl, setPreviewMediaUrl] = useState<string | null>(null);
  const [previewMediaPaths, setPreviewMediaPaths] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Preview Dialog Overlay State for completed stateless history tasks
  const [previewTask, setPreviewTask] = useState<FilmTaskRecord | null>(null);
  const [previewTaskSignedUrl, setPreviewTaskSignedUrl] = useState<string | null>(null);
  const [previewTaskSignedSections, setPreviewTaskSignedSections] = useState<any[]>([]);

  // Deep linking project navigation support
  useEffect(() => {
    if (projectId) {
      setSelectedProjectId(projectId);
      setCurrentScreen('workspace');
    } else {
      setSelectedProjectId(null);
      setCurrentScreen('dashboard');
    }
  }, [projectId]);

  const fetchCredits = async () => {
    try {
      const res = await api.get('/film-studio/credits');
      setCredits(res.data?.credits || 0);
    } catch (e) {
      console.error("Failed to fetch film studio credits:", e);
    }
  };

  const fetchProjectsList = async () => {
    try {
      const res = await api.get('/film-studio/history?limit=30');
      const items = res.data?.renders || [];
      setProjects(items);
    } catch (e) {
      console.error("Failed to list Film projects:", e);
    }
  };

  useEffect(() => {
    fetchCredits();
    fetchProjectsList();
  }, []);

  // Poll stateless history runs globally on the Dashboard screen if any of them are active (PENDING or PROCESSING)
  useEffect(() => {
    const hasActiveTasks = projects.some(p => p.status === 'PENDING' || p.status === 'PROCESSING');
    if (!hasActiveTasks) return;

    const interval = setInterval(async () => {
      try {
        const res = await api.get('/film-studio/history?limit=30');
        const items = res.data?.renders || [];
        setProjects(items);
        
        // If active tasks transitioned to terminal states, sync credits balance
        const hasActiveNow = items.some((p: any) => p.status === 'PENDING' || p.status === 'PROCESSING');
        if (!hasActiveNow) {
          fetchCredits();
        }
      } catch (e) {
        console.error("Failed to poll history list:", e);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [projects]);

  // Active project session is fully client-side loaded from localSessions list
  const activeProject = localSessions.find(s => s._id === selectedProjectId);

  // Poll background import generation task status
  useEffect(() => {
    if (!selectedProjectId || currentScreen !== 'workspace' || !importingTaskId) return;

    const interval = setInterval(async () => {
      try {
        const pollRes = await api.get(`/film-studio/tasks/${importingTaskId}?t=${Date.now()}`);
        const taskData = pollRes.data;
        
        if (taskData.status === 'COMPLETED') {
          clearInterval(interval);
          setImportingTaskId(null);
          
          const updatedBlocks = taskData.comicSections || [];
          
          const cachedDraft = localStorage.getItem(`film_draft_${selectedProjectId}`);
          let currentSections: any[] = [];
          if (cachedDraft) {
            try {
              currentSections = JSON.parse(cachedDraft).comicSections || [];
            } catch (e) {}
          }
          
          // Check if this is a block regeneration or a new asset import run
          const isRegen = currentSections.some((sec: any) => updatedBlocks.some((u: any) => u.pageId === sec.pageId));
          
          let mergedSections = [];
          if (isRegen) {
            mergedSections = currentSections.map((sec: any) => {
              const match = updatedBlocks.find((u: any) => u.pageId === sec.pageId);
              if (match) {
                return {
                  ...sec,
                  image: match.image || sec.image,
                  audio: match.audio || sec.audio,
                  caption: match.caption || sec.caption,
                  imagePrompt: match.imagePrompt || sec.imagePrompt
                };
              }
              return sec;
            });
          } else {
            // New blocks append run
            const clonedBlocks = updatedBlocks.map((sec: any, idx: number) => ({
              pageId: 'gen_' + Math.random().toString(36).substring(2, 10) + `_${idx}`,
              caption: sec.caption || '',
              imagePrompt: sec.imagePrompt || '',
              image: sec.image,
              audio: sec.audio
            }));
            mergedSections = [...currentSections, ...clonedBlocks];
          }

          // Recalculate ordering
          mergedSections.forEach((sec, idx) => {
            sec.sectionNumber = idx + 1;
          });

          // Save draft back to local cache
          const draftJSON = {
            projectId: selectedProjectId,
            projectName: activeProject?.name || 'My Masterpiece',
            aspectRatio: activeProject?.aspectRatio || '16:9',
            updatedAt: new Date().toISOString(),
            comicSections: mergedSections
          };
          localStorage.setItem(`film_draft_${selectedProjectId}`, JSON.stringify(draftJSON));

          // Update local sessions state
          const updatedSessionsList = localSessions.map(s => s._id === selectedProjectId ? {
            ...s,
            comicSections: mergedSections,
            status: 'IDLE'
          } : s);
          saveLocalSessions(updatedSessionsList);
          fetchCredits();
          fetchProjectsList();
          
        } else if (taskData.status === 'FAILED') {
          clearInterval(interval);
          setImportingTaskId(null);
          setErrorMsg(taskData.failureReason || "AI Generation failed.");
          
          const updatedSessionsList = localSessions.map(s => s._id === selectedProjectId ? {
            ...s,
            status: 'FAILED',
            failureReason: taskData.failureReason
          } : s);
          saveLocalSessions(updatedSessionsList);
          fetchCredits();
          fetchProjectsList();
        } else {
          // Task status can be PROCESSING, let's update local session status to reflect live progress
          const updatedSessionsList = localSessions.map(s => s._id === selectedProjectId ? {
            ...s,
            status: taskData.status
          } : s);
          saveLocalSessions(updatedSessionsList);
        }
      } catch (e) {
        console.error("Error polling import task:", e);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [selectedProjectId, importingTaskId, currentScreen, localSessions, activeProject]);

  // Load and sign assets for selected project (Durable Cache Implementation)
  useEffect(() => {
    let active = true;
    const signProjectAssets = async () => {
      if (!activeProject) {
        setPreviewMediaUrl(null);
        setPreviewMediaPaths([]);
        return;
      }

      // Restore Cached Edit Timeline Schema Draft from LocalStorage if present
      const cachedDraft = localStorage.getItem(`film_draft_${activeProject._id}`);
      let parsedSections = activeProject.comicSections || [];
      if (cachedDraft) {
        try {
          const parsedDraft = JSON.parse(cachedDraft);
          if (parsedDraft.comicSections && parsedDraft.comicSections.length > 0) {
            parsedSections = parsedDraft.comicSections;
          }
        } catch (e) {
          console.error("Failed to parse cached local draft:", e);
        }
      }

      try {
        const tempPaths: any[] = [];
        if (activeProject.outputUrl) {
          const sRes = await api.get(`/film-studio/signed-url?taskId=${activeProject._id}&path=${encodeURIComponent(activeProject.outputUrl)}`);
          if (active) {
            setPreviewMediaUrl(sRes.data.url);
          }
        }

        if (parsedSections && parsedSections.length > 0) {
          for (const section of parsedSections) {
            let imgSigned = null;
            let audioSigned = null;
            
            // Extract the original task ID of the GCS folder structure so the backend can verify ownership correctly
            const getAssetTaskId = (assetPath: string) => {
              if (assetPath && assetPath.startsWith('bihand/')) {
                const parts = assetPath.split('/');
                if (parts.length >= 4) {
                  return parts[2];
                }
              }
              return activeProject._id;
            };

            if (section.image) {
              const iRes = await api.get(`/film-studio/signed-url?taskId=${getAssetTaskId(section.image)}&path=${encodeURIComponent(section.image)}`);
              imgSigned = iRes.data.url;
            }
            if (section.audio) {
              const aRes = await api.get(`/film-studio/signed-url?taskId=${getAssetTaskId(section.audio)}&path=${encodeURIComponent(section.audio)}`);
              audioSigned = aRes.data.url;
            }
            tempPaths.push({
              ...section,
              imageSignedUrl: imgSigned,
              audioSignedUrl: audioSigned
            });
          }
          if (active) {
            setPreviewMediaPaths(tempPaths);
            
            // Default select first block if empty
            if (tempPaths.length > 0 && !selectedBlockId) {
              const first = tempPaths[0];
              setSelectedBlockId(first.pageId);
              setBlockCaption(first.caption || '');
              setBlockPrompt(first.imagePrompt || '');
            }
          }
        } else {
          if (active) {
            setPreviewMediaPaths([]);
          }
        }
      } catch (err) {
        console.error("Failed to sign GCS assets:", err);
      }
    };

    signProjectAssets();
    return () => {
      active = false;
    };
  }, [selectedProjectId, activeProject, importingTaskId, selectedBlockId]);

  // Set default templates on tab switch
  useEffect(() => {
    setSourceImageUrls([]);
    const isEn = language === 'en';
    if (aiImportTab === 'comic') {
      setPrompt(isEn 
        ? 'A gentle, kind orphan named Tam is bullied by her stepmother and stepsister, but with the magical help of Budda, she overcomes obstacles to become the Queen.'
        : 'Tấm mồ côi hiền lành bị Cám hãm hại nhưng nhờ Bụt giúp đỡ, cô vượt qua khó khăn trở thành hoàng hậu.'
      );
      setStyle('watercolor');
    } else if (aiImportTab === 'vlog') {
      setPrompt(isEn
        ? 'Vlog exploring a day in Hanoi Old Quarter, enjoying a piping hot bowl of street-stall Pho in the fresh early morning mist.'
        : 'Vlog một ngày khám phá phố cổ Hà Nội, thưởng thức phở gánh nóng hổi trong làn sương sớm tinh khôi.'
      );
      setStyle('cinematic');
    } else if (aiImportTab === 'manim') {
      setPrompt(isEn
        ? 'Visualize the Pythagorean theorem with intuitive motion geometry: a rotating right-angled triangle matching perfectly inside a large square.'
        : 'Trực quan hóa định lý Pythagoras bằng hình học chuyển động trực quan, tam giác vuông xoay tròn khớp vào ô vuông lớn.'
      );
      setStyle('blueprint');
    } else if (aiImportTab === 'image') {
      setPrompt(isEn
        ? 'A futuristic castle floating high up in the dreamy clouds, receiving a brilliant stream of light from deep outer space.'
        : 'Một tòa lâu đài tương lai lơ lửng trên những đám mây mờ ảo, đón luồng sáng rực rỡ từ vũ trụ.'
      );
      setStyle('cyberpunk');
    } else if (aiImportTab === 'sound') {
      setPrompt(isEn
        ? 'Welcome to SANT Film Studio. A professional filmmaking ecosystem powered by state-of-the-art AI voiceovers.'
        : 'Chào mừng bạn đến với SANT Film Studio. Hệ sinh thái dựng phim chuyên nghiệp hỗ trợ giọng đọc AI tối tân.'
      );
    }
  }, [aiImportTab, language]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    if (sourceImageUrls.length + files.length > 5) {
      setErrorMsg("Tải lên tối đa 5 hình ảnh phác thảo.");
      return;
    }

    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result) {
          setSourceImageUrls(prev => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  // ----------------- PROJECTS ACTIONS -----------------

  const handleQuickVideoGen = async () => {
    setAiImportTab('vlog');
    setShowAIImportModal(true);
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    const sessionId = 'session_' + Math.random().toString(36).substring(2, 15);
    const newSession = {
      _id: sessionId,
      name: newProjectName,
      status: 'IDLE',
      comicSections: [],
      createdAt: new Date().toISOString()
    };
    saveLocalSessions([newSession, ...localSessions]);
    
    // Save draft JSON configuration directly to localStorage under `film_draft_{sessionId}`
    const draftJSON = {
      projectId: sessionId,
      projectName: newProjectName,
      aspectRatio: '16:9',
      updatedAt: new Date().toISOString(),
      comicSections: []
    };
    localStorage.setItem(`film_draft_${sessionId}`, JSON.stringify(draftJSON));

    setNewProjectName('');
    setShowCreateModal(false);
    navigate(`/film-studio/session/${sessionId}`);
  };

  const handleDeleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Bạn có chắc chắn muốn xóa phiên dựng phim này?")) return;
    const updated = localSessions.filter(s => s._id !== id);
    saveLocalSessions(updated);
    localStorage.removeItem(`film_draft_${id}`);
    if (selectedProjectId === id) {
      navigate('/film-studio');
    }
  };

  const handleSelectProjectToEdit = (p: any) => {
    navigate(`/film-studio/session/${p._id}`);
  };

  const handleBackToDashboard = () => {
    navigate('/film-studio');
  };

  // ----------------- AI ASSETS IMPORT DISPATCH -----------------

  const handleImportAIGeneration = async () => {
    setIsImporting(true);
    setErrorMsg(null);

    try {
      const body = {
        feature: aiImportTab,
        prompt: prompt,
        style: style,
        aspectRatio: aspectRatio,
        modelType: modelType,
        voiceName: voiceName,
        locale: locale,
        numSections: numSections,
        sourcePaths: sourceImageUrls.length > 0 ? sourceImageUrls : undefined
      };

      const res = await api.post('/film-studio/generate', body);
      if (res.data.success) {
        setCredits(res.data.newBalance);
        
        // If inside an active editing session, set polling taskId
        if (selectedProjectId) {
          setImportingTaskId(res.data.taskId);
          const updatedSessionsList = localSessions.map(s => s._id === selectedProjectId ? {
            ...s,
            status: 'PENDING'
          } : s);
          saveLocalSessions(updatedSessionsList);
        }

        // Add to projects lists history dynamically
        const tempTask: FilmTaskRecord = {
          _id: res.data.taskId,
          userId: '',
          feature: aiImportTab,
          prompt: prompt,
          style: style,
          aspectRatio: aspectRatio,
          modelType: modelType,
          status: 'PENDING',
          cost: aiImportTab === 'comic' ? (numSections * 14 + Math.floor(numSections * 1.25)) :
                aiImportTab === 'vlog' ? (numSections * 2 * 14) :
                aiImportTab === 'manim' ? 19 : aiImportTab === 'image' ? 14 : 10,
          createdAt: new Date().toISOString()
        };
        setProjects(prev => [tempTask, ...prev]);

        setShowAIImportModal(false);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.response?.data?.detail || err.response?.data?.message || "Nhập bản dựng AI thất bại.");
    } finally {
      setIsImporting(false);
    }
  };

  // Quick select an asset from our generated history bank and import it directly into our timeline
  const handleImportFromHistory = (sourceProj: FilmTaskRecord, block?: any) => {
    if (!selectedProjectId) return;
    
    let clonedBlocks: any[] = [];
    if (block) {
      // Import specifically selected block
      clonedBlocks = [{
        pageId: 'imported_' + Math.random().toString(36).substring(2, 10),
        caption: block.caption || '',
        imagePrompt: block.imagePrompt || '',
        image: block.image,
        audio: block.audio
      }];
    } else {
      // Import the entire storyboard sequence from the completed historical run
      const secs = sourceProj.comicSections || [];
      clonedBlocks = secs.map((sec, idx) => ({
        pageId: 'imported_' + Math.random().toString(36).substring(2, 10) + `_${idx}`,
        caption: sec.caption || '',
        imagePrompt: sec.imagePrompt || '',
        image: sec.image,
        audio: sec.audio
      }));
    }

    const cachedDraft = localStorage.getItem(`film_draft_${selectedProjectId}`);
    let currentSections = [];
    if (cachedDraft) {
      try {
        currentSections = JSON.parse(cachedDraft).comicSections || [];
      } catch (e) {}
    }

    const updatedSections = [...currentSections, ...clonedBlocks];
    
    // Auto-update section index ordering
    updatedSections.forEach((sec, idx) => {
      sec.sectionNumber = idx + 1;
    });

    // Save timeline state draft to browser local cache
    const draftJSON = {
      projectId: selectedProjectId,
      projectName: activeProject?.name || 'My Masterpiece',
      aspectRatio: activeProject?.aspectRatio || '16:9',
      updatedAt: new Date().toISOString(),
      comicSections: updatedSections
    };
    localStorage.setItem(`film_draft_${selectedProjectId}`, JSON.stringify(draftJSON));

    // Update local sessions state
    const updatedSessionsList = localSessions.map(s => s._id === selectedProjectId ? {
      ...s,
      comicSections: updatedSections
    } : s);
    saveLocalSessions(updatedSessionsList);
    
    setShowAIImportModal(false);
  };

  // ----------------- TIMELINE CONTROLS -----------------

  const handleSelectBlock = (block: any) => {
    setSelectedBlockId(block.pageId);
    setBlockCaption(block.caption || '');
    setBlockPrompt(block.imagePrompt || '');
  };

  const handleSaveBlockEdits = () => {
    if (!selectedProjectId || !selectedBlockId) return;
    setErrorMsg(null);

    const updatedSections = previewMediaPaths.map(sec => {
      if (sec.pageId === selectedBlockId) {
        return {
          ...sec,
          caption: blockCaption,
          imagePrompt: blockPrompt
        };
      }
      return sec;
    });

    // Save local timeline workspace draft cache
    const draftJSON = {
      projectId: selectedProjectId,
      projectName: activeProject?.name || 'My Masterpiece',
      aspectRatio: activeProject?.aspectRatio || '16:9',
      updatedAt: new Date().toISOString(),
      comicSections: updatedSections
    };
    localStorage.setItem(`film_draft_${selectedProjectId}`, JSON.stringify(draftJSON));

    // Update local sessions state
    const updatedSessionsList = localSessions.map(s => s._id === selectedProjectId ? {
      ...s,
      comicSections: updatedSections
    } : s);
    saveLocalSessions(updatedSessionsList);
  };

  const handleRegenerateBlock = async (pageId: string) => {
    if (!selectedProjectId) return;
    setBlockRegenerating(prev => ({ ...prev, [pageId]: true }));
    setErrorMsg(null);

    // Find the block in previewMediaPaths
    const targetBlock = previewMediaPaths.find(b => b.pageId === pageId);
    if (!targetBlock) return;

    // Extract the original taskId of the block, or default to the active project id
    const getBlockTaskId = (block: any) => {
      if (block && block.image && block.image.startsWith('bihand/')) {
        const parts = block.image.split('/');
        if (parts.length >= 4) {
          return parts[2];
        }
      }
      return selectedProjectId;
    };

    const blockTaskId = getBlockTaskId(targetBlock);

    try {
      // Send req body containing potentially modified caption and imagePrompt
      const res = await api.post(`/film-studio/tasks/${blockTaskId}/blocks/${pageId}/regenerate`, {
        caption: blockCaption,
        imagePrompt: blockPrompt
      });
      setCredits(res.data?.newBalance || credits);
      setImportingTaskId(blockTaskId); // Set importingTaskId to poll for this block's regeneration progress
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.response?.data?.detail || "Lỗi kết xuất lại phân cảnh.");
    } finally {
      setBlockRegenerating(prev => ({ ...prev, [pageId]: false }));
    }
  };

  const handleInsertBlock = (insertIndex: number) => {
    if (!selectedProjectId) return;
    const randomHex = Math.random().toString(36).substring(2, 10);
    const newBlock = {
      pageId: 'temp_new_' + randomHex,
      sectionNumber: insertIndex + 1,
      caption: 'Nội dung phân cảnh mới chèn vào...',
      imagePrompt: 'A beautiful sequential storyboard illustration...',
      image: null,
      audio: null
    };

    const updatedSections = [...previewMediaPaths];
    updatedSections.splice(insertIndex, 0, newBlock);

    updatedSections.forEach((sec, idx) => {
      sec.sectionNumber = idx + 1;
    });

    // Save local timeline workspace draft cache
    const draftJSON = {
      projectId: selectedProjectId,
      projectName: activeProject?.name || 'My Masterpiece',
      aspectRatio: activeProject?.aspectRatio || '16:9',
      updatedAt: new Date().toISOString(),
      comicSections: updatedSections
    };
    localStorage.setItem(`film_draft_${selectedProjectId}`, JSON.stringify(draftJSON));

    // Update local sessions state
    const updatedSessionsList = localSessions.map(s => s._id === selectedProjectId ? {
      ...s,
      comicSections: updatedSections
    } : s);
    saveLocalSessions(updatedSessionsList);

    setSelectedBlockId(newBlock.pageId);
    setBlockCaption(newBlock.caption);
    setBlockPrompt(newBlock.imagePrompt);
  };

  const handleDeleteBlock = (pageId: string) => {
    if (!selectedProjectId) return;
    const updatedSections = previewMediaPaths.filter(sec => sec.pageId !== pageId);

    updatedSections.forEach((sec, idx) => {
      sec.sectionNumber = idx + 1;
    });

    // Save local timeline workspace draft cache
    const draftJSON = {
      projectId: selectedProjectId,
      projectName: activeProject?.name || 'My Masterpiece',
      aspectRatio: activeProject?.aspectRatio || '16:9',
      updatedAt: new Date().toISOString(),
      comicSections: updatedSections
    };
    localStorage.setItem(`film_draft_${selectedProjectId}`, JSON.stringify(draftJSON));

    // Update local sessions state
    const updatedSessionsList = localSessions.map(s => s._id === selectedProjectId ? {
      ...s,
      comicSections: updatedSections
    } : s);
    saveLocalSessions(updatedSessionsList);

    if (selectedBlockId === pageId) {
      setSelectedBlockId(null);
    }
  };

  const handleShiftBlock = (index: number, direction: 'up' | 'down') => {
    if (!selectedProjectId) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= previewMediaPaths.length) return;

    const updatedSections = [...previewMediaPaths];
    const temp = updatedSections[index];
    updatedSections[index] = updatedSections[targetIndex];
    updatedSections[targetIndex] = temp;

    updatedSections.forEach((sec, idx) => {
      sec.sectionNumber = idx + 1;
    });

    // Save local timeline workspace draft cache
    const draftJSON = {
      projectId: selectedProjectId,
      projectName: activeProject?.name || 'My Masterpiece',
      aspectRatio: activeProject?.aspectRatio || '16:9',
      updatedAt: new Date().toISOString(),
      comicSections: updatedSections
    };
    localStorage.setItem(`film_draft_${selectedProjectId}`, JSON.stringify(draftJSON));

    // Update local sessions state
    const updatedSessionsList = localSessions.map(s => s._id === selectedProjectId ? {
      ...s,
      comicSections: updatedSections
    } : s);
    saveLocalSessions(updatedSessionsList);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-background text-foreground p-6 space-y-6 animate-fade-in">
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" multiple className="hidden" />

      {/* ==================== 1. SESSION MANAGER / DASHBOARD SCREEN ==================== */}
      {currentScreen === 'dashboard' && (
        <div className="space-y-6 max-w-6xl mx-auto">
          {/* Header section */}
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight uppercase flex items-center gap-3">
                <span className="w-3.5 h-3.5 rounded-full bg-pink-500 shadow-[0_0_15px_rgba(244,63,94,0.5)] animate-pulse"></span>
                {t('film.title', 'Phòng Dựng Phim')}
              </h1>
              <p className="text-xs text-muted-foreground mt-1">{t('film.subtitle', 'Hệ sinh thái dựng phim AI, truyện tranh, hoạt hình giáo dục và âm thanh chất lượng phòng thu.')}</p>
            </div>
            <div className="flex items-center gap-3 animate-fade-in">
              <Button
                onClick={handleQuickVideoGen}
                variant="outline"
                size="sm"
                shape="pill"
              >
                <Sparkles size={14} className="animate-pulse text-pink-500" /> {t('film.quick_video_gen', 'Tạo Video AI nhanh')}
              </Button>
              <Button
                onClick={() => setShowCreateModal(true)}
                size="sm"
                shape="pill"
              >
                <Plus size={14} /> {t('film.create_project', 'Tạo dự án mới')}
              </Button>
              <Pill className="shadow-sm">
                <Coins size={14} className="text-emerald-500" />
                <span className="text-sm font-bold text-foreground">{t('film.wallet', 'BYOK — no billing')}</span>
              </Pill>
            </div>
          </div>

          {/* Project Sessions Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
            {localSessions.map((proj) => {
              const length = proj.comicSections?.length || 0;
              return (
                <Card
                  key={proj._id}
                  noPadding
                  onClick={() => handleSelectProjectToEdit(proj)}
                  className="group cursor-pointer hover:border-pink-500 overflow-hidden transition-all hover:scale-[1.02]"
                >
                  <div className="h-40 bg-zinc-950 relative flex items-center justify-center border-b border-border">
                    <Film size={40} className="text-zinc-700 group-hover:text-pink-500/25 transition-colors" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                    <div className="absolute bottom-3 left-4 right-4 flex justify-between items-center">
                      <div className="text-sm font-bold truncate max-w-[180px] text-white">{proj.name || t('film.untitled', 'Dự án không tên')}</div>
                      <Badge variant="neutral" dot={false} className="bg-zinc-800 text-zinc-300 uppercase">{proj.status || 'IDLE'}</Badge>
                    </div>
                  </div>
                  <div className="p-4 flex justify-between items-center">
                    <div className="text-xs text-muted-foreground">{length} {t('film.nodes', 'Phân cảnh')} (Timeline Nodes)</div>
                    <button
                      onClick={(e) => handleDeleteProject(proj._id, e)}
                      className="p-1.5 bg-background hover:bg-destructive/10 border border-border hover:border-destructive/40 rounded-xl text-muted-foreground hover:text-destructive transition-colors"
                      title={t('film.delete_project', 'Xóa dự án')}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </Card>
              );
            })}

            {localSessions.length === 0 && (
              <Card className="col-span-full text-center py-20 space-y-4">
                <Video size={48} className="text-muted-foreground/40 mx-auto" />
                <div className="text-sm font-bold text-muted-foreground">{t('film.empty_project', 'Bạn chưa khởi tạo dự án dựng phim nào')}</div>
                <Button onClick={() => setShowCreateModal(true)} variant="outline" size="sm" shape="pill" className="mx-auto text-pink-500 border-pink-500/30 hover:bg-pink-500/10">
                  {t('film.create_first', 'Tạo dự án đầu tiên')}
                </Button>
              </Card>
            )}
          </div>

          {/* Generated History Section / History Bank */}
          <div className="border-t border-border pt-6 space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-pink-500 flex items-center gap-2">
              <Sparkles size={14} className="text-pink-500 animate-pulse" /> {t('film.history_title', 'Lịch sử kết xuất & Mẫu AI')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {projects.map((proj) => (
                <Card
                  key={'hist_' + proj._id}
                  onClick={() => {
                    if (proj.status === 'COMPLETED') {
                      setPreviewTask(proj);
                      setPreviewTaskSignedUrl(proj.outputSignedUrl || null);
                      setPreviewTaskSignedSections(proj.comicSections || []);
                    }
                  }}
                  className={cn(
                    'flex flex-col justify-between space-y-3',
                    proj.status === 'COMPLETED' ? 'cursor-pointer hover:border-pink-500/50 hover:scale-[1.01] transition-all' : ''
                  )}
                >
                  <div className="flex justify-between items-start gap-4">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="text-xs font-bold text-foreground truncate max-w-[250px]">{t('film.untitled', 'Bản kết xuất AI')}</div>
                      <div className="text-[9px] text-muted-foreground uppercase font-extrabold">{proj.feature} • {proj.style}</div>
                      <p className="text-[10px] text-muted-foreground line-clamp-2 italic">"{proj.prompt}"</p>

                      {/* Failure reason rendering if failed */}
                      {proj.status === 'FAILED' && proj.failureReason && (
                        <div className="text-[9px] text-red-500 bg-red-500/10 border border-red-500/20 p-1.5 rounded-lg mt-1.5 flex items-center gap-1">
                          <AlertTriangle size={10} className="shrink-0" />
                          <span className="truncate">{proj.failureReason}</span>
                        </div>
                      )}

                      {/* Processing/Pending loader state */}
                      {(proj.status === 'PENDING' || proj.status === 'PROCESSING') && (
                        <div className="text-[9px] text-pink-500 bg-pink-500/10 border border-pink-500/20 p-1.5 rounded-lg mt-1.5 flex items-center gap-1.5 animate-pulse">
                          <RefreshCw size={10} className="animate-spin shrink-0" />
                          <span>Đang tạo bản dựng AI... / Processing...</span>
                        </div>
                      )}
                    </div>
                    <Badge
                      variant={proj.status === 'COMPLETED' ? 'success' : proj.status === 'FAILED' ? 'error' : 'info'}
                      className={cn('shrink-0', (proj.status === 'PENDING' || proj.status === 'PROCESSING') && 'animate-pulse')}
                    >
                      {proj.status || 'IDLE'}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-border/60">
                    <div className="text-[10px] text-muted-foreground font-bold">{t('film.cost', 'Chi phí:')} <span className="text-amber-500">{proj.cost} 🪙</span></div>
                    <div className="text-[9px] text-muted-foreground font-medium">Task: #{proj._id}</div>
                  </div>
                </Card>
              ))}
              {projects.length === 0 && (
                <div className="col-span-full text-center py-10 bg-card/50 border border-dashed border-border rounded-xl text-xs text-muted-foreground italic">
                  {t('film.no_history', 'Chưa có lịch sử kết xuất thành công nào. Hãy tạo một dự án mới và chạy AI import!')}
                </div>
              )}
            </div>
          </div>

          {/* Create Project Modal Dialog */}
          <Modal
            open={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            title={t('film.create_project', 'Tạo dự án mới')}
            widthClassName="max-w-md"
          >
            <div className="space-y-4">
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground font-bold block mb-1">{t('film.project_name', 'Project Name')}:</span>
                <Input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="e.g. Quảng cáo cà phê, Kỷ niệm gia đình..."
                />
              </div>
              <Button onClick={handleCreateProject} className="w-full" size="md">
                {t('film.start_film', 'Bắt đầu làm phim')}
              </Button>
            </div>
          </Modal>

          {/* Task Result Lightbox Preview Modal */}
          <Modal
            open={!!previewTask}
            onClose={() => setPreviewTask(null)}
            widthClassName="max-w-2xl"
            title={previewTask ? (
              <div>
                <span className="flex items-center gap-1.5">
                  <Sparkles size={14} className="text-pink-500" /> {t('film.untitled', 'Xem kết quả AI')}
                </span>
                <p className="text-[10px] text-muted-foreground font-normal truncate mt-0.5 normal-case">Task: #{previewTask._id} • {previewTask.feature.toUpperCase()}</p>
              </div>
            ) : undefined}
          >
            {previewTask && (
              <div className="flex flex-col space-y-4">
                {/* Status & Basic Metadata Section */}
                <div className="grid grid-cols-2 gap-4 text-xs bg-muted/50 p-3.5 border border-border rounded-xl">
                  <div>
                    <span className="text-[9px] text-muted-foreground font-bold uppercase block">Trạng thái (Status):</span>
                    <Badge
                      variant={previewTask.status === 'COMPLETED' ? 'success' : previewTask.status === 'FAILED' ? 'error' : 'info'}
                      dot={false}
                      className={cn('mt-0.5', previewTask.status !== 'COMPLETED' && previewTask.status !== 'FAILED' && 'animate-pulse')}
                    >
                      {previewTask.status}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-[9px] text-muted-foreground font-bold uppercase block">Chi phí (Credits Cost):</span>
                    <span className="font-semibold text-foreground mt-1 block">{previewTask.cost || 0} Credits</span>
                  </div>
                </div>

                {/* Input Prompt Section */}
                <div className="bg-muted/50 p-3.5 border border-border rounded-xl space-y-1">
                  <span className="text-[9px] text-muted-foreground font-bold uppercase block">Kịch bản gốc (Original Prompt):</span>
                  <p className="text-[11px] text-foreground italic leading-relaxed">"{previewTask.prompt}"</p>
                </div>

                {/* Output Deliverables Section */}
                <div className="flex flex-col space-y-2 justify-center">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Bản kết xuất chính (Primary Output)</span>

                  {previewTask.status === 'FAILED' ? (
                    <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6 text-center space-y-2">
                      <span className="text-red-500 font-semibold text-xs block">Lỗi kết xuất (Generation Error)</span>
                      <p className="text-[10px] text-muted-foreground max-w-md mx-auto leading-relaxed">
                        {previewTask.failureReason || "Máy ảo AI gặp lỗi không mong muốn hoặc cạn kiệt bộ nhớ trong quá trình kết xuất."}
                      </p>
                    </div>
                  ) : previewTask.feature === 'comic' || (previewTask.comicSections && previewTask.comicSections.length > 0) ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[40vh] overflow-y-auto pr-1">
                      {previewTaskSignedSections.map((sec, sIdx) => (
                        <div key={sec.pageId || sIdx} className="bg-zinc-950 border border-zinc-800 rounded-2xl p-3 space-y-2.5 relative group">
                          <div className="aspect-video w-full rounded-xl border border-zinc-800 overflow-hidden bg-zinc-900 flex items-center justify-center relative">
                            {sec.imageSignedUrl ? (
                              <>
                                <img src={sec.imageSignedUrl} className="w-full h-full object-contain" alt={`Panel ${sec.sectionNumber}`} />
                                <button
                                  onClick={() => triggerDownload(sec.imageSignedUrl, `comic-panel-${previewTask._id}-${sec.sectionNumber}.png`)}
                                  className="absolute bottom-2 right-2 p-1.5 bg-black/80 rounded-lg border border-zinc-700 text-white opacity-0 group-hover:opacity-100 transition-all hover:scale-105"
                                >
                                  <Download size={11} />
                                </button>
                              </>
                            ) : (
                              <ImageIcon size={20} className="text-zinc-700" />
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] bg-pink-500/10 text-pink-400 font-bold px-2 py-0.5 rounded font-mono">Panel {sec.sectionNumber}</span>
                              {sec.audioSignedUrl && (
                                <audio src={sec.audioSignedUrl} controls className="h-6 max-w-[120px] text-[10px]" />
                              )}
                            </div>
                            <p className="text-[11px] text-zinc-300 leading-normal line-clamp-3">
                              {sec.caption}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 aspect-video flex items-center justify-center overflow-hidden relative">
                      {previewTaskSignedUrl ? (
                        <>
                          {previewTaskSignedUrl.includes('.mp4') ? (
                            <video src={previewTaskSignedUrl} controls autoPlay loop className="w-full h-full object-contain" />
                          ) : previewTaskSignedUrl.includes('.mp3') ? (
                            <div className="text-center space-y-3">
                              <Volume2 size={36} className="text-pink-400 mx-auto animate-pulse" />
                              <audio src={previewTaskSignedUrl} controls className="mx-auto" />
                            </div>
                          ) : (
                            <img src={previewTaskSignedUrl} className="w-full h-full object-contain" alt="Preview Output" />
                          )}
                          <button
                            onClick={() => triggerDownload(previewTaskSignedUrl, `deliverable-${previewTask._id}.mp4`)}
                            className="absolute bottom-3 right-3 p-2 bg-black/80 rounded-xl border border-zinc-700 text-white shadow hover:border-pink-500 transition-all hover:scale-105"
                          >
                            <Download size={14} />
                          </button>
                        </>
                      ) : (
                        <div className="text-center space-y-2">
                          <Video size={24} className="text-zinc-700 mx-auto" />
                          <span className="text-xs text-zinc-500 font-bold block">Đang kết xuất hoặc phương tiện trống...</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex border-t border-border pt-3 mt-1">
                  <Button
                    onClick={() => setPreviewTask(null)}
                    variant="secondary"
                    className="w-full"
                  >
                    Đóng cửa sổ
                  </Button>
                </div>
              </div>
            )}
          </Modal>
        </div>
      )}

      {/* ==================== 2. ACTIVE TIMELINE WORKSPACE SCREEN ==================== */}
      {currentScreen === 'workspace' && activeProject && (
        <div className="space-y-4 animate-fade-in">
          {/* Top project navigation bar */}
          <div className="flex items-center justify-between bg-card border border-border p-3 rounded-2xl shadow-sm">
            <div className="flex items-center gap-3">
              <button
                onClick={handleBackToDashboard}
                className="p-1.5 hover:bg-secondary rounded-xl border border-border text-muted-foreground hover:text-foreground transition-colors"
                title="Quay lại danh sách"
              >
                <ArrowLeft size={14} />
              </button>
              <div className="flex items-center gap-2 text-xs font-extrabold text-foreground uppercase tracking-wider">
                <Film size={14} className="text-pink-500 animate-pulse" />
                <span>Project: {activeProject.name}</span>
                <ChevronRight size={12} className="text-muted-foreground" />
                <Badge variant="neutral" dot={false}>{activeProject.status}</Badge>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={() => setShowAIImportModal(true)}
                size="sm"
                shape="pill"
              >
                <Plus size={14} /> Nhập tư liệu (AI Import)
              </Button>
              <Pill>
                <Coins size={12} className="text-emerald-500" />
                <span className="text-xs font-bold text-foreground">BYOK</span>
              </Pill>
            </div>
          </div>

          {/* Split workspace panel */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Left Parameter Panel (Editing or Global Configs) */}
            <Card className="lg:col-span-5 space-y-6 shadow-xl h-[75vh] flex flex-col justify-between">

              {selectedBlockId && previewMediaPaths.length > 0 ? (
                /* STORYBOARD BLOCK TIMELINE EDITOR PANEL (Node Editor) */
                <div className="space-y-4 animate-fade-in flex-1">
                  <div className="flex justify-between items-center border-b border-border pb-2">
                    <span className="text-xs font-bold text-pink-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Edit2 size={12} /> Hiệu chỉnh Node Timeline
                    </span>
                    <button onClick={() => setSelectedBlockId(null)} className="text-[10px] text-muted-foreground hover:text-foreground">✕</button>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <span className="text-[10px] text-muted-foreground font-bold block mb-1">Lời đọc thoại (Caption Narration):</span>
                      <Textarea
                        value={blockCaption}
                        onChange={(e) => setBlockCaption(e.target.value)}
                        className="h-20 resize-none"
                      />
                    </div>

                    <div>
                      <span className="text-[10px] text-muted-foreground font-bold block mb-1">Mô tả hình ảnh (Visual prompt):</span>
                      <Textarea
                        value={blockPrompt}
                        onChange={(e) => setBlockPrompt(e.target.value)}
                        className="h-20 resize-none"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-border/60">
                    <Button
                      onClick={handleSaveBlockEdits}
                      variant="secondary"
                      className="flex-1"
                    >
                      Cập nhật kịch bản
                    </Button>
                    <Button
                      onClick={() => handleRegenerateBlock(selectedBlockId)}
                      disabled={blockRegenerating[selectedBlockId]}
                      className="flex-1 bg-pink-600 text-white hover:bg-pink-500 flex items-center justify-center gap-1.5"
                    >
                      {blockRegenerating[selectedBlockId] ? (
                        <RefreshCw size={12} className="animate-spin" />
                      ) : (
                        <>Regen block | 15 🪙</>
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                /* EMPTY PLACEHOLDER DETAILS */
                <div className="text-center py-20 space-y-3 flex-1 flex flex-col justify-center">
                  <Cpu size={36} className="text-muted-foreground/40 mx-auto" />
                  <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Timeline Editor</div>
                  <p className="text-[10px] text-muted-foreground/80 max-w-xs mx-auto leading-relaxed">Nhấp chọn bất kỳ phân cảnh nào ở dòng Timeline bên phải để bật thanh Node Editor tùy chỉnh kịch bản hoặc tái tạo hình ảnh đơn lẻ.</p>
                </div>
              )}
            </Card>

            {/* Right Playback Canvas & Timeline */}
            <div className="lg:col-span-7 space-y-4">
              {/* Unified Media Player Window */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 shadow-xl h-[42vh] flex flex-col relative justify-center items-center">
                {importingTaskId ? (
                  <div className="px-6 py-3 bg-pink-500/10 border border-pink-500/30 rounded-full shadow-[0_0_25px_rgba(236,72,153,0.2)] flex items-center gap-3 animate-pulse">
                    <RefreshCw className="animate-spin text-pink-400" size={16} />
                    <span className="text-xs font-extrabold tracking-widest text-[#fecdd3] uppercase">Đang đồng bộ kịch bản AI...</span>
                  </div>
                ) : activeProject.status === 'FAILED' ? (
                  <div className="text-center p-6 space-y-3 max-w-sm">
                    <AlertTriangle size={24} className="text-red-400 mx-auto" />
                    <div className="text-xs font-extrabold text-red-400">Kết xuất tư liệu lỗi</div>
                    <p className="text-[10px] text-zinc-400 leading-relaxed">{activeProject.failureReason || "Đã xảy ra lỗi không xác định từ máy chủ."}</p>
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-zinc-950 rounded-xl overflow-hidden relative">
                    {previewMediaUrl ? (
                      <>
                        {previewMediaUrl.includes('.mp4') ? (
                          <video src={previewMediaUrl} controls autoPlay loop className="w-full h-full object-contain" />
                        ) : previewMediaUrl.includes('.mp3') ? (
                          <div className="text-center space-y-3">
                            <Volume2 size={36} className="text-pink-400 mx-auto animate-pulse" />
                            <audio src={previewMediaUrl} controls className="mx-auto" />
                          </div>
                        ) : (
                          <img src={previewMediaUrl} className="w-full h-full object-contain" alt="Film Studio Preview" />
                        )}
                        {/* Download Floating action */}
                        <button
                          onClick={() => triggerDownload(previewMediaUrl, `film-export-${activeProject._id}.mp4`)}
                          className="absolute bottom-3 right-3 p-2 bg-black/85 rounded-xl border border-zinc-800 hover:border-pink-500 text-white shadow transition-all hover:scale-105"
                        >
                          <Download size={14} />
                        </button>
                      </>
                    ) : (
                      <div className="text-center space-y-2">
                        <Video size={36} className="text-zinc-700 mx-auto" />
                        <div className="text-xs text-zinc-500 font-bold">Chưa chọn tư liệu xem thử</div>
                        <p className="text-[10px] text-zinc-600">Nhấp "Đọc truyện" hoặc chọn ảnh lẻ bên dưới để preview</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Chronological Timeline Track (Bottom) */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 shadow-xl h-[31vh] flex flex-col justify-between overflow-hidden">
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex justify-between items-center pb-2 border-b border-zinc-800">
                  <span>Timeline Video Track</span>
                  <span className="text-zinc-600">Drag/reorder and split nodes freely</span>
                </div>

                <div className="flex-1 overflow-x-auto overflow-y-hidden flex items-center py-2 gap-3 pr-4">
                  {previewMediaPaths.map((sec, idx) => {
                    const isBlockSelected = selectedBlockId === sec.pageId;
                    return (
                      <div 
                        key={sec.pageId}
                        onClick={() => handleSelectBlock(sec)}
                        className={`min-w-[150px] max-w-[150px] bg-zinc-950/80 border rounded-xl p-2 relative cursor-pointer flex flex-col justify-between h-[15vh] transition-all select-none ${
                          isBlockSelected ? 'border-pink-500 ring-2 ring-pink-500/20 shadow-[0_0_15px_rgba(236,72,153,0.15)] bg-pink-950/5' : 'border-zinc-800 hover:border-zinc-500'
                        }`}
                      >
                        <div className="h-14 bg-black rounded-lg overflow-hidden relative">
                          {sec.imageSignedUrl ? (
                            <img src={sec.imageSignedUrl} className="w-full h-full object-cover" alt="" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[8px] text-zinc-500">Wait...</div>
                          )}
                          <div className="absolute top-1 left-1 px-1 bg-black/60 rounded text-[7px] text-zinc-400 font-bold">#{idx+1}</div>
                        </div>
                        <p className="text-[9px] text-zinc-400 truncate mt-1">{sec.caption || '(No caption)'}</p>
                        
                        {/* Timeline segment actions */}
                        <div className="flex justify-between items-center pt-1 mt-1 border-t border-zinc-900">
                          <div className="flex gap-0.5">
                            <button onClick={(e) => { e.stopPropagation(); handleShiftBlock(idx, 'up'); }} disabled={idx === 0} className="p-0.5 bg-zinc-900 border border-zinc-800 rounded disabled:opacity-30"><ArrowLeft size={6} /></button>
                            <button onClick={(e) => { e.stopPropagation(); handleShiftBlock(idx, 'down'); }} disabled={idx === previewMediaPaths.length - 1} className="p-0.5 bg-zinc-900 border border-zinc-800 rounded disabled:opacity-30"><ChevronRight size={6} /></button>
                          </div>
                          <div className="flex gap-0.5">
                            <button onClick={(e) => { e.stopPropagation(); handleInsertBlock(idx + 1); }} className="p-0.5 bg-zinc-900 hover:bg-pink-950/50 border border-zinc-800 hover:border-pink-500 rounded text-pink-400"><Plus size={6} /></button>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteBlock(sec.pageId); }} className="p-0.5 bg-zinc-900 hover:bg-red-950/50 border border-zinc-800 hover:border-red-500 rounded text-red-400"><Trash2 size={6} /></button>
                          </div>
                        </div>
                        
                        {/* Audio Narration Trigger */}
                        {sec.audioSignedUrl && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); playNarrationAudio(sec.audioSignedUrl, sec.pageId); }}
                            className={`absolute top-1 right-1 px-1 py-0.5 rounded text-[6px] font-bold flex items-center gap-0.5 border ${
                              playingAudioId === sec.pageId 
                                ? 'bg-pink-600 border-transparent text-white animate-pulse'
                                : 'bg-zinc-950 border-zinc-800 text-pink-400'
                            }`}
                          >
                            {playingAudioId === sec.pageId ? <Pause size={6} /> : <Play size={6} />} Mic
                          </button>
                        )}
                      </div>
                    );
                  })}

                  {previewMediaPaths.length === 0 && (
                    <div className="w-full text-center py-6 text-zinc-600 text-[10px] italic flex items-center justify-center gap-2">
                      Timeline trống. Nhấp vào "+ Nhập tư liệu (AI Import)" để bắt đầu sản xuất phim.
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* AI Import / Generation Presets Modal dialog */}
      <Modal
        open={showAIImportModal}
        onClose={() => setShowAIImportModal(false)}
        widthClassName="max-w-4xl"
        title={
          <span className="flex items-center gap-1.5">
            <Sparkles size={14} className="text-pink-500" /> {t('film.import_title', 'Nhập tư liệu thông minh (AI Import)')}
          </span>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Left: Input parameters */}
            <div className="md:col-span-6 space-y-4 border-r border-border/50 pr-4">
              {/* Sub Tab Categories */}
              <div className="flex bg-secondary border border-border p-1 rounded-xl shadow-inner w-full">
                {[
                  { id: 'comic', label: t('film.tab.comic', 'Truyện Tranh'), icon: <BookOpen size={12} /> },
                  { id: 'vlog', label: t('film.tab.vlog', 'Dựng Phim'), icon: <Tv size={12} /> },
                  { id: 'manim', label: t('film.tab.manim', 'Hoạt Hình'), icon: <Cpu size={12} /> },
                  { id: 'image', label: t('film.tab.image', 'Tạo Ảnh'), icon: <ImageIcon size={12} /> },
                  { id: 'sound', label: t('film.tab.sound', 'Âm Thanh'), icon: <Music size={12} /> }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setAiImportTab(tab.id as any)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1 py-1.5 px-2 text-[10px] font-bold rounded-lg transition-all',
                      aiImportTab === tab.id ? 'bg-pink-600 text-white' : 'text-muted-foreground'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Upload Sketch */}
              <div>
                <span className="text-[10px] text-muted-foreground font-bold block mb-1">{t('film.add_sketch', 'Hình ảnh phác thảo (Tùy chọn):')}</span>
                <div className="flex flex-wrap gap-2 mb-2">
                  {sourceImageUrls.map((url, index) => (
                    <div key={index} className="relative w-12 h-12 rounded-lg border border-border overflow-hidden group">
                      <img src={url} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSourceImageUrls(prev => prev.filter((_, i) => i !== index));
                        }}
                        className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-red-500 font-bold transition-opacity"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-border hover:border-pink-500 rounded-xl p-4 flex flex-col items-center justify-center bg-secondary/50 hover:bg-secondary transition-all cursor-pointer">
                  <Upload size={16} className="text-pink-400 mb-1" />
                  <span className="text-[10px] font-bold">{t('film.add_ref', 'Thêm reference')} ({sourceImageUrls.length}/5)</span>
                </div>
              </div>

              {/* Prompt */}
              <div>
                <span className="text-[10px] text-muted-foreground font-bold block mb-1">{t('film.prompt_label', 'Ý tưởng kịch bản (Prompt):')}</span>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="h-20 resize-none text-xs focus:border-pink-500"
                  placeholder={language === 'en' ? "Describe the idea you want AI to generate..." : "Mô tả ý tưởng muốn AI tạo dựng để chèn thêm..."}
                />
              </div>

              {/* Presets and options */}
              <div className="grid grid-cols-2 gap-3">
                {aiImportTab !== 'sound' && (
                  <>
                    <div>
                      <span className="text-[10px] text-muted-foreground font-bold block mb-1">{t('film.style_label', 'Phong cách (Art Style):')}</span>
                      <Select value={style} onChange={(e) => setStyle(e.target.value)} className="text-xs">
                        <option value="none">None</option>
                        <option value="watercolor">Watercolor</option>
                        <option value="comic_book">Comic Style</option>
                        <option value="cinematic">Cinematic Photo</option>
                        <option value="anime_illustration">Anime</option>
                        <option value="cyberpunk">Cyberpunk</option>
                      </Select>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground font-bold block mb-1">{t('film.aspect_ratio_label', 'Tỷ lệ khung hình:')}</span>
                      <Select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="text-xs">
                        <option value="16:9">{language === 'en' ? 'Landscape (16:9)' : 'Ngang (16:9)'}</option>
                        <option value="9:16">{language === 'en' ? 'Portrait (9:16)' : 'Dọc (9:16)'}</option>
                        <option value="1:1">{language === 'en' ? 'Square (1:1)' : 'Vuông (1:1)'}</option>
                      </Select>
                    </div>
                  </>
                )}

                {(aiImportTab === 'comic' || aiImportTab === 'sound') && (
                  <>
                    <div>
                      <span className="text-[10px] text-muted-foreground font-bold block mb-1">{t('film.voice_label', 'Giọng nói AI Narrator:')}</span>
                      <Select value={voiceName} onChange={(e) => setVoiceName(e.target.value)} className="text-xs">
                        <option value="Kore">{language === 'en' ? 'Kore (Deep Male)' : 'Kore (Nam trầm)'}</option>
                        <option value="Puck">{language === 'en' ? 'Puck (Energetic Male)' : 'Puck (Nam năng động)'}</option>
                        <option value="Aoede">{language === 'en' ? 'Aoede (Sweet Female)' : 'Aoede (Nữ ngọt ngào)'}</option>
                      </Select>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground font-bold block mb-1">{t('film.locale_label', 'Ngôn ngữ đọc:')}</span>
                      <Select value={locale} onChange={(e) => setLocale(e.target.value)} className="text-xs">
                        <option value="vi-VN">{language === 'en' ? 'Vietnamese' : 'Tiếng Việt'}</option>
                        <option value="en-US">English</option>
                      </Select>
                    </div>
                  </>
                )}

                {(aiImportTab === 'comic' || aiImportTab === 'vlog') && (
                  <div className="col-span-2">
                    <span className="text-[10px] text-muted-foreground font-bold block mb-1">{t('film.sections_label', 'Số lượng phân cảnh muốn chèn:')}</span>
                    <Select value={numSections} onChange={(e) => setNumSections(parseInt(e.target.value))} className="text-xs">
                      <option value="1">1 {language === 'en' ? 'Scene' : 'Phân cảnh'}</option>
                      <option value="2">2 {language === 'en' ? 'Scenes' : 'Phân cảnh'}</option>
                      <option value="3">3 {language === 'en' ? 'Scenes' : 'Phân cảnh'}</option>
                      <option value="4">4 {language === 'en' ? 'Scenes' : 'Phân cảnh'}</option>
                      <option value="5">5 {language === 'en' ? 'Scenes' : 'Phân cảnh'}</option>
                      <option value="6">6 {language === 'en' ? 'Scenes' : 'Phân cảnh'}</option>
                      <option value="7">7 {language === 'en' ? 'Scenes' : 'Phân cảnh'}</option>
                      <option value="8">8 {language === 'en' ? 'Scenes' : 'Phân cảnh'}</option>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Generation History Bank (Select from prior runs) */}
            <div className="md:col-span-6 space-y-4 pl-2 flex flex-col h-[52vh] overflow-y-auto">
              <span className="text-[10px] font-bold uppercase tracking-wider block border-b border-border pb-1.5">{t('film.choose_from_history', 'Chọn tư liệu từ lịch sử AI (Lịch sử)')}</span>

              <div className="space-y-3 flex-1 overflow-y-auto pr-1">
                {projects.filter(p => p.status === 'COMPLETED' && p.comicSections && p.comicSections.length > 0).map(proj => (
                  <div key={proj._id} className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-2 relative group hover:border-pink-500/50">
                    <div className="flex justify-between items-center text-[9px] text-zinc-500 font-bold">
                      <span>{t('film.untitled', 'Bản kết xuất AI')} ({proj.comicSections?.length || 0} panels)</span>
                      <button
                        onClick={() => handleImportFromHistory(proj)}
                        className="px-2 py-0.5 bg-pink-950/30 hover:bg-pink-600 border border-pink-500/30 text-pink-400 hover:text-white rounded text-[8px] font-bold"
                      >
                        {t('film.import_all', 'Nhập Tất cả')}
                      </button>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5">
                      {proj.comicSections?.map((sec) => (
                        <div
                          key={sec.pageId}
                          onClick={() => handleImportFromHistory(proj, sec)}
                          className="relative aspect-square rounded-lg border border-zinc-800 hover:border-pink-500 overflow-hidden cursor-pointer group bg-zinc-900"
                        >
                          {sec.image ? (
                            <div className="w-full h-full relative">
                              {/* Real GCS image thumbnail signed dynamic mapper inside modal */}
                              <div className="w-full h-full bg-cover bg-center" style={{ backgroundImage: `url(${sec.imageSignedUrl || ''})` }} />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <Plus size={12} className="text-white" />
                              </div>
                            </div>
                          ) : (
                            <span className="text-[8px] text-zinc-600 flex items-center justify-center h-full">Node</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {projects.filter(p => p.status === 'COMPLETED').length === 0 && (
                  <div className="text-center py-10 text-muted-foreground text-[10px] italic">{t('film.empty_history_desc', 'Lịch sử tư liệu trống. Vui lòng tạo bản dựng AI mới ở thanh bên trái.')}</div>
                )}
              </div>
            </div>
          </div>

          {errorMsg && <div className="p-2 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-[10px]">⚠️ {errorMsg}</div>}

          <div className="flex gap-3 border-t border-border pt-3">
            <Button
              onClick={() => setShowAIImportModal(false)}
              variant="secondary"
              className="flex-1"
            >
              {t('film.cancel', 'Hủy bỏ')}
            </Button>
            <Button
              onClick={handleImportAIGeneration}
              disabled={isImporting}
              className="flex-1 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-lg"
            >
              {isImporting ? (
                <RefreshCw size={12} className="animate-spin" />
              ) : (
                <>{t('film.confirm_import', 'Xác nhận import mới')} | {
                  aiImportTab === 'comic' ? (numSections * 14 + Math.floor(numSections * 1.25)) :
                  aiImportTab === 'vlog' ? (numSections * 2 * 14) :
                  aiImportTab === 'manim' ? 19 : aiImportTab === 'image' ? 14 : 10
                } 🪙</>
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default FilmStudio;