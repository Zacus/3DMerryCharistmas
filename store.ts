import { create } from 'zustand';
import { AppMode, GestureType, PhotoData, HandData } from './types';

interface AppState {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  
  photos: PhotoData[];
  addPhotos: (urls: string[]) => void;
  updatePhotoDescription: (id: string, desc: string) => void;
  
  focusedPhotoId: string | null;
  setFocusedPhotoId: (id: string | null) => void;

  handData: HandData;
  updateHandData: (data: Partial<HandData>) => void;
}

export const useStore = create<AppState>((set) => ({
  mode: AppMode.TREE,
  setMode: (mode) => set({ mode }),

  photos: [],
  addPhotos: (urls) => set((state) => {
    // Generate data for all new photos
    const newPhotos = urls.map(url => {
        // New Tree Geometry: Height 12, Max Radius 4.2 (0.7 Ratio)
        // Top is y=6, Bottom is y=-6
        const theta = Math.random() * Math.PI * 2;
        // Spread photos primarily in middle section, avoiding extreme top/bottom
        const y = (Math.random() * 10) - 5; 
        
        // Radius calc: MaxRadius * (1 - normalizedHeight)
        // h goes from 0 at y=-6 to 1 at y=6
        const h = (y + 6) / 12;
        const radiusAtY = 4.2 * (1 - h);
        
        // Position on surface
        const x = radiusAtY * Math.cos(theta);
        const z = radiusAtY * Math.sin(theta);

        // Calculate scatter position (sphere)
        const r = 10 + Math.random() * 5;
        const phi = Math.acos(2 * Math.random() - 1);
        const scatterX = r * Math.sin(phi) * Math.cos(theta);
        const scatterY = r * Math.sin(phi) * Math.sin(theta);
        const scatterZ = r * Math.cos(phi);

        return {
            id: Math.random().toString(36).substr(2, 9),
            url,
            position: [x, y, z] as [number, number, number],
            scatterPosition: [scatterX, scatterY, scatterZ] as [number, number, number],
        };
    });

    return {
      photos: [
        ...state.photos,
        ...newPhotos
      ],
    };
  }),
  updatePhotoDescription: (id, desc) => set((state) => ({
    photos: state.photos.map(p => p.id === id ? { ...p, description: desc } : p)
  })),

  focusedPhotoId: null,
  setFocusedPhotoId: (id) => set({ focusedPhotoId: id }),

  handData: { gesture: GestureType.NONE, x: 0.5, y: 0.5 },
  updateHandData: (data) => set((state) => ({ handData: { ...state.handData, ...data } })),
}));