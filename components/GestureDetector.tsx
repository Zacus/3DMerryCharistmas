import React, { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker, DrawingUtils } from '@mediapipe/tasks-vision';
import { useStore } from '../store';
import { AppMode, GestureType } from '../types';

// Simple Linear Interpolation
const lerp = (start: number, end: number, t: number) => start * (1 - t) + end * t;

// Singleton promise to prevent double-initialization in StrictMode
let landmarkerPromise: Promise<HandLandmarker> | null = null;

const initializeHandLandmarker = async () => {
    if (landmarkerPromise) return landmarkerPromise;

    landmarkerPromise = (async () => {
        try {
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.10/wasm"
            );
            return await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numHands: 1,
                minHandDetectionConfidence: 0.6,
                minHandPresenceConfidence: 0.6,
                minTrackingConfidence: 0.6
            });
        } catch (error) {
            // Reset promise on failure so it can be retried
            landmarkerPromise = null;
            throw error;
        }
    })();
    return landmarkerPromise;
};

export const GestureDetector: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [landmarker, setLandmarker] = useState<HandLandmarker | null>(null);
  const updateHandData = useStore(state => state.updateHandData);
  const setMode = useStore(state => state.setMode);

  // Coordinate smoothing refs
  const smoothedX = useRef(0.5);
  const smoothedY = useRef(0.5);
  const gestureHistory = useRef<string[]>([]);
  const lastGestureTime = useRef<number>(0);
  const requestRef = useRef<number>(0);
  const lastVideoTime = useRef<number>(-1);

  // Initialize MediaPipe
  useEffect(() => {
    let mounted = true;
    
    const init = async (attempt = 1) => {
      // Delay helps with StrictMode mounting issues and network racing
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (!mounted) return;

      try {
        const handLandmarker = await initializeHandLandmarker();
        if (mounted) {
            setLandmarker(handLandmarker);
        }
      } catch (error) {
        console.error(`MediaPipe initialization failed (attempt ${attempt}):`, error);
        if (mounted && attempt < 3) {
            console.log(`Retrying MediaPipe initialization in ${attempt}s...`);
            setTimeout(() => init(attempt + 1), attempt * 1000);
        }
      }
    };
    
    init();
    return () => { mounted = false; };
  }, []);

  const predictWebcam = () => {
    if (!landmarker || !videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    
    // Check if video is ready
    if (video.videoWidth === 0 || video.videoHeight === 0) {
        requestRef.current = requestAnimationFrame(predictWebcam);
        return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (video.currentTime !== lastVideoTime.current) {
      lastVideoTime.current = video.currentTime;
      const results = landmarker.detectForVideo(video, performance.now());

      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Visual feedback
        if (results.landmarks && results.landmarks.length > 0) {
          const landmarks = results.landmarks[0];
          const drawingUtils = new DrawingUtils(ctx);
          
          drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: "rgba(255, 215, 0, 0.4)", lineWidth: 2 });
          drawingUtils.drawLandmarks(landmarks, { color: "rgba(255, 255, 255, 0.8)", lineWidth: 1, radius: 2 });

          const indexTip = landmarks[8];
          const thumbTip = landmarks[4];
          
          ctx.beginPath();
          ctx.moveTo(thumbTip.x * canvas.width, thumbTip.y * canvas.height);
          ctx.lineTo(indexTip.x * canvas.width, indexTip.y * canvas.height);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(indexTip.x * canvas.width, indexTip.y * canvas.height, 5, 0, 2 * Math.PI);
          ctx.fillStyle = "#FFD700";
          ctx.fill();

          // Logic
          const wrist = landmarks[0];
          const middleTip = landmarks[12];
          const ringTip = landmarks[16];
          const pinkyTip = landmarks[20];
          
          const middleFingerMCP = landmarks[9];
          const handSize = Math.hypot(middleFingerMCP.x - wrist.x, middleFingerMCP.y - wrist.y);

          const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
          
          const fingers = [indexTip, middleTip, ringTip, pinkyTip];
          const fingerDistances = fingers.map(tip => Math.hypot(tip.x - wrist.x, tip.y - wrist.y));
          
          const OPEN_RATIO = 1.6; 
          const FIST_RATIO = 1.3; 
          const PINCH_RATIO = 0.5;

          const isOpen = fingerDistances.every(d => d > handSize * OPEN_RATIO);
          const isFist = fingerDistances.every(d => d < handSize * FIST_RATIO);
          const isPinch = pinchDist < handSize * PINCH_RATIO;

          // VICTORY Logic: Index & Middle UP, Ring & Pinky DOWN
          const indexUp = fingerDistances[0] > handSize * 1.4;
          const middleUp = fingerDistances[1] > handSize * 1.4;
          const ringDown = fingerDistances[2] < handSize * 1.2;
          const pinkyDown = fingerDistances[3] < handSize * 1.2;
          const isVictory = indexUp && middleUp && ringDown && pinkyDown;

          // LOVE (ILY Sign) Logic: Thumb, Index, Pinky UP. Middle, Ring DOWN.
          const thumbUp = Math.hypot(thumbTip.x - wrist.x, thumbTip.y - wrist.y) > handSize * 0.8; // Thumb usually shorter
          // Re-use indexUp, ringDown, pinkyDown
          const pinkyUp = fingerDistances[3] > handSize * 1.4;
          const middleDown = fingerDistances[1] < handSize * 1.2;
          
          const isLove = thumbUp && indexUp && middleDown && ringDown && pinkyUp;

          let detectedGesture = GestureType.NONE;

          if (isLove) {
            detectedGesture = GestureType.HEART;
          } else if (isVictory) {
            detectedGesture = GestureType.VICTORY;
          } else if (isFist) {
            detectedGesture = GestureType.CLOSED_FIST;
          } else if (isPinch) {
            detectedGesture = GestureType.PINCH;
          } else if (isOpen) {
            detectedGesture = GestureType.OPEN_HAND;
          }

          gestureHistory.current.push(detectedGesture);
          if (gestureHistory.current.length > 8) gestureHistory.current.shift();
          
          const counts = gestureHistory.current.reduce((acc, curr) => {
            acc[curr] = (acc[curr] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          const stableGesture = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b) as GestureType;

          // Access fresh mode from useStore directly to avoid stale closures in the loop
          const currentMode = useStore.getState().mode;
          const now = Date.now();

          if (now - lastGestureTime.current > 600) { 
              if (stableGesture === GestureType.HEART && currentMode !== AppMode.LOVE) {
                  setMode(AppMode.LOVE);
                  lastGestureTime.current = now;
              } else if (stableGesture === GestureType.VICTORY && currentMode !== AppMode.TEXT) {
                  setMode(AppMode.TEXT);
                  lastGestureTime.current = now;
              } else if (stableGesture === GestureType.CLOSED_FIST && currentMode !== AppMode.TREE) {
                  setMode(AppMode.TREE);
                  lastGestureTime.current = now;
              } else if (stableGesture === GestureType.OPEN_HAND && currentMode !== AppMode.SCATTER) {
                  // Allow transition to SCATTER from ANY mode (TEXT, TREE, LOVE) except when already SCATTER
                  setMode(AppMode.SCATTER);
                  lastGestureTime.current = now;
              }
          }

          const rawX = 1 - wrist.x;
          const rawY = wrist.y;

          const distMoved = Math.hypot(rawX - smoothedX.current, rawY - smoothedY.current);
          const lerpFactor = distMoved > 0.05 ? 0.3 : 0.1; 

          smoothedX.current = lerp(smoothedX.current, rawX, lerpFactor);
          smoothedY.current = lerp(smoothedY.current, rawY, lerpFactor);

          updateHandData({ 
              gesture: stableGesture, 
              x: smoothedX.current, 
              y: smoothedY.current 
          });

        } else {
          updateHandData({ gesture: GestureType.NONE });
        }
      }
    }
    requestRef.current = requestAnimationFrame(predictWebcam);
  };

  // Start Camera
  useEffect(() => {
    const enableCam = async () => {
      if (videoRef.current && landmarker) {
        try {
          const constraints = {
             video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: "user" // Prefer front camera on mobile
             }
          };
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          videoRef.current.srcObject = stream;
          
          // Explicit play ensures the video starts
          await videoRef.current.play();
          
          // Start Loop explicitly
          requestRef.current = requestAnimationFrame(predictWebcam);
        } catch (err) {
          console.error("Webcam error:", err);
        }
      }
    };

    if (landmarker) {
      enableCam();
    }

    return () => {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landmarker]);

  return (
    <div className="absolute bottom-4 left-4 z-50 pointer-events-none opacity-90 border border-white/10 rounded-lg overflow-hidden bg-black/40 backdrop-blur-md shadow-[0_0_30px_rgba(0,0,0,0.6)]">
      <div className="relative w-20 h-14 sm:w-48 sm:h-36 transition-all duration-300">
        <video 
            ref={videoRef} 
            className="hidden" 
            autoPlay 
            playsInline 
            muted 
        />
        <canvas 
            ref={canvasRef} 
            className="absolute top-0 left-0 w-full h-full object-cover transform scale-x-[-1]" 
        />
        <div className="absolute top-2 left-2 flex flex-col gap-1">
            <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_10px_red]" />
        </div>
        <div className="absolute bottom-0 w-full text-center text-[8px] sm:text-[10px] text-white/80 bg-black/40 py-0.5 sm:py-1 font-mono tracking-wider">
           GESTURE LINKED
        </div>
      </div>
    </div>
  );
};
