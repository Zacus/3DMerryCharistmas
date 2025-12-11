import React, { useRef } from 'react';
import { Scene } from './components/Scene';
import { GestureDetector } from './components/GestureDetector';
import { useStore } from './store';
import { AppMode, GestureType } from './types';

const App: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addPhotos = useStore(state => state.addPhotos);
  const mode = useStore(state => state.mode);
  const handData = useStore(state => state.handData);
  const focusedPhotoId = useStore(state => state.focusedPhotoId);
  const setMode = useStore(state => state.setMode);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const urls: string[] = [];
      for (let i = 0; i < e.target.files.length; i++) {
        const file = e.target.files[i];
        urls.push(URL.createObjectURL(file));
      }
      addPhotos(urls);
    }
  };

  return (
    <div className="w-full h-screen relative bg-black font-['Inter'] overflow-hidden">
      
      {/* 3D Scene */}
      <div className="absolute inset-0 z-0">
        <Scene />
      </div>

      {/* Hand Tracking Camera Overlay */}
      <GestureDetector />

      {/* UI Overlay */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        
        {/* Title Section: Top Left */}
        <div className="absolute top-4 left-4 md:top-6 md:left-6 max-w-[60%] md:max-w-md">
           <h1 className="text-2xl md:text-6xl text-white font-['Mountains_of_Christmas'] drop-shadow-[0_0_10px_rgba(255,215,0,0.8)] leading-tight">
             Merry Christmas
           </h1>
           
           {/* Desktop Instructions */}
           <p className="text-white/70 text-sm mt-2 space-y-1 hidden md:block">
             <span className="block">Make a <span className="font-bold text-yellow-400">Fist</span> to gather the tree.</span>
             <span className="block"><span className="font-bold text-yellow-400">Victory (Peace)</span> sign for a wish.</span>
             <span className="block"><span className="font-bold text-yellow-400">Open Hand</span> to scatter magic & close photos.</span>
             <span className="block"><span className="font-bold text-yellow-400">Pinch</span> to explore memories.</span>
           </p>

           {/* Mobile Instructions (Condensed) */}
           <div className="text-white/70 text-[9px] mt-1 space-y-1 md:hidden leading-snug">
              <span className="block"><span className="text-yellow-400 font-bold">Fist</span>: Tree &nbsp;|&nbsp; <span className="text-yellow-400 font-bold">Victory</span>: Wish</span>
              <span className="block"><span className="text-yellow-400 font-bold">Open</span>: Scatter &nbsp;|&nbsp; <span className="text-yellow-400 font-bold">Pinch</span>: Select</span>
           </div>
        </div>

        {/* Controls Section: Top Right - Vertical Stack */}
        <div className="absolute top-4 right-4 md:top-6 md:right-6 pointer-events-auto flex flex-col items-end gap-3">
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              className="hidden" 
              accept="image/*"
              multiple
            />
            
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="bg-white/10 hover:bg-white/20 backdrop-blur-md text-white border border-white/30 px-4 py-2 text-xs md:text-sm rounded-full transition-all duration-300 hover:scale-105 active:scale-95 shadow-[0_0_15px_rgba(255,255,255,0.2)] mb-2"
            >
              + Add Memories
            </button>
            
            <button onClick={() => setMode(AppMode.TREE)} className={`min-w-[100px] text-right text-[10px] md:text-xs px-3 py-2 rounded border transition-colors backdrop-blur-sm whitespace-nowrap ${mode === AppMode.TREE ? 'bg-green-800/80 border-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-black/40 border-white/20 hover:bg-white/10'}`}>
               Tree (Fist)
            </button>
            <button onClick={() => setMode(AppMode.TEXT)} className={`min-w-[100px] text-right text-[10px] md:text-xs px-3 py-2 rounded border transition-colors backdrop-blur-sm whitespace-nowrap ${mode === AppMode.TEXT ? 'bg-red-800/80 border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'bg-black/40 border-white/20 hover:bg-white/10'}`}>
               Text (Victory)
            </button>
            <button onClick={() => setMode(AppMode.SCATTER)} className={`min-w-[100px] text-right text-[10px] md:text-xs px-3 py-2 rounded border transition-colors backdrop-blur-sm whitespace-nowrap ${mode === AppMode.SCATTER ? 'bg-blue-800/80 border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'bg-black/40 border-white/20 hover:bg-white/10'}`}>
               Scatter (Open)
            </button>
        </div>
      </div>

      {/* Status Bar */}
      <div className="absolute bottom-6 right-6 z-10 text-right pointer-events-none hidden sm:block">
          <div className="text-white/50 text-xs uppercase tracking-widest mb-1">Current State</div>
          <div className="text-xl font-bold text-white flex items-center justify-end gap-2">
            {mode === AppMode.TREE && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
            {mode === AppMode.TEXT && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
            {mode === AppMode.SCATTER && <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />}
            {mode}
          </div>
          <div className="text-white/50 text-xs mt-2">
            Gesture: <span className="text-yellow-400 font-mono">{handData.gesture}</span>
          </div>
      </div>
      
      {/* Mobile simplified status */}
      <div className="absolute bottom-4 right-4 z-10 text-right pointer-events-none sm:hidden">
          <div className="text-xs font-bold text-white flex items-center justify-end gap-2">
            {mode}
            <span className={`w-2 h-2 rounded-full animate-pulse ${mode === AppMode.TREE ? 'bg-green-500' : mode === AppMode.TEXT ? 'bg-red-500' : 'bg-blue-500'}`} />
          </div>
          <div className="text-white/60 text-[9px]">
            {handData.gesture !== GestureType.NONE ? handData.gesture : 'No Hand'}
          </div>
      </div>

      {/* API Key Modal (Simple Check) */}
      {!process.env.API_KEY && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-red-900/90 p-6 rounded-lg text-white text-center pointer-events-auto border border-red-500 shadow-2xl max-w-[90vw]">
              <p className="font-bold text-lg mb-2">Warning: No API_KEY</p>
              <p className="text-sm">Gemini photo descriptions will be disabled.</p>
          </div>
      )}

    </div>
  );
};

export default App;