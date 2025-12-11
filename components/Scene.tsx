import React, { useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Stars, Sparkles } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { ChristmasTree } from './ChristmasTree';
import { PhotoCloud } from './PhotoCloud';
import { Snowfall } from './Snowfall';
import { useStore } from '../store';
import { AppMode, GestureType } from '../types';
import * as THREE from 'three';

const PulsingLights: React.FC = () => {
    const redLight = useRef<THREE.PointLight>(null);
    const greenLight = useRef<THREE.PointLight>(null);

    useFrame(({ clock }) => {
        const t = clock.elapsedTime;
        // Subtle, slow breathing pulse for a magical effect
        if (redLight.current) {
            redLight.current.intensity = 1.2 + Math.sin(t * 1.2) * 0.6;
        }
        if (greenLight.current) {
            // Offset phase for variety
            greenLight.current.intensity = 1.2 + Math.sin(t * 0.9 + 2) * 0.6;
        }
    });

    return (
        <>
            {/* Lower ambient light to increase contrast and mood */}
            <ambientLight intensity={0.15} />
            
            {/* Pulsing colored lights */}
            <pointLight 
                ref={redLight} 
                position={[10, 10, 10]} 
                color="#ff0000" 
                distance={50} 
                decay={2} 
            />
            <pointLight 
                ref={greenLight} 
                position={[-10, -5, -10]} 
                color="#00ff00" 
                distance={50} 
                decay={2} 
            />
            
            {/* Top Spotlight for main illumination */}
            <spotLight 
                position={[0, 15, 0]} 
                angle={0.5} 
                penumbra={1} 
                intensity={2.0} 
                color="#fff" 
            />
        </>
    );
};

const CameraController: React.FC = () => {
    const { camera, size, gl } = useThree();
    const mode = useStore(state => state.mode);
    const handData = useStore(state => state.handData);
    const focusedPhotoId = useStore(state => state.focusedPhotoId);
    
    // Auto-Animation Refs
    const autoAngle = useRef(0);
    
    // Manual Control Refs (Target Values)
    const targetZoom = useRef(1.0);
    const targetOrbit = useRef({ x: 0, y: 0 }); // x: theta (azimuth), y: height offset
    const targetPan = useRef(new THREE.Vector3(0, 0, 0));

    // Current Smoothed Values
    const currentZoom = useRef(1.0);
    const currentOrbit = useRef({ x: 0, y: 0 });
    const currentPan = useRef(new THREE.Vector3(0, 0, 0));

    // Determine orientation
    const isPortrait = size.width < size.height;
    
    const baseZ = isPortrait ? 17.5 : 14;
    const scatterRadius = isPortrait ? 28 : 22;

    // --- Input Handling ---
    useEffect(() => {
        const canvas = gl.domElement;
        
        const handleWheel = (e: WheelEvent) => {
            if (focusedPhotoId) return; // Disable zoom in focus mode to prevent glitches
            e.preventDefault();
            // Zoom: Modify scale factor. Scroll Up (neg) -> Zoom In (decrease factor? no, usually zoom in means closer)
            // Let's say zoom factor < 1 is closer, > 1 is further. 
            // Or better: zoom factor multiplier.
            const sensitivity = 0.001;
            const delta = e.deltaY * sensitivity;
            targetZoom.current = THREE.MathUtils.clamp(targetZoom.current + delta, 0.4, 2.5);
        };

        let isDragging = false;
        let lastX = 0;
        let lastY = 0;

        const handlePointerDown = (e: PointerEvent) => {
            if (focusedPhotoId) return;
            isDragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            canvas.setPointerCapture(e.pointerId);
        };

        const handlePointerMove = (e: PointerEvent) => {
            if (!isDragging) return;
            
            const dx = e.clientX - lastX;
            const dy = e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;

            // Left Click (buttons=1) -> Orbit
            if (e.buttons === 1) {
                const orbitSpeed = 0.005;
                const heightSpeed = 0.02;
                targetOrbit.current.x -= dx * orbitSpeed;
                targetOrbit.current.y += dy * heightSpeed;
            } 
            // Right Click (buttons=2) or Middle (4) -> Pan
            else if (e.buttons === 2 || e.buttons === 4) {
                const panSpeed = 0.02; // Adjust based on zoom? Keeping simple for now.
                // Pan needs to be relative to camera view
                // Simple approximation: X moves X, Y moves Y (since we mostly look forward)
                // For better pan, we'd use camera right/up vectors, but this is sufficient for a simple tree viewer
                targetPan.current.x -= dx * panSpeed;
                targetPan.current.y += dy * panSpeed;
            }
        };

        const handlePointerUp = (e: PointerEvent) => {
            isDragging = false;
            canvas.releasePointerCapture(e.pointerId);
        };

        const handleContextMenu = (e: Event) => e.preventDefault();

        canvas.addEventListener('wheel', handleWheel, { passive: false });
        canvas.addEventListener('pointerdown', handlePointerDown);
        canvas.addEventListener('pointermove', handlePointerMove);
        canvas.addEventListener('pointerup', handlePointerUp);
        canvas.addEventListener('contextmenu', handleContextMenu);

        return () => {
            canvas.removeEventListener('wheel', handleWheel);
            canvas.removeEventListener('pointerdown', handlePointerDown);
            canvas.removeEventListener('pointermove', handlePointerMove);
            canvas.removeEventListener('pointerup', handlePointerUp);
            canvas.removeEventListener('contextmenu', handleContextMenu);
        };
    }, [gl.domElement, focusedPhotoId]);


    useFrame((state, delta) => {
        if (focusedPhotoId) {
            // In focus mode, we mostly surrender control to the PhotoCloud logic, 
            // but we ensure the camera resets its manual offsets slowly so they don't jump when exiting
            targetZoom.current = 1.0;
            targetOrbit.current = { x: 0, y: 0 };
            targetPan.current.set(0, 0, 0);
            
            // Still smooth towards defaults
            currentZoom.current = THREE.MathUtils.lerp(currentZoom.current, 1.0, delta * 2);
            currentOrbit.current.x = THREE.MathUtils.lerp(currentOrbit.current.x, 0, delta * 2);
            currentOrbit.current.y = THREE.MathUtils.lerp(currentOrbit.current.y, 0, delta * 2);
            currentPan.current.lerp(new THREE.Vector3(0,0,0), delta * 2);
            return; 
        }

        // 1. Smooth Manual Inputs
        const damping = 5.0;
        currentZoom.current = THREE.MathUtils.lerp(currentZoom.current, targetZoom.current, delta * damping);
        currentOrbit.current.x = THREE.MathUtils.lerp(currentOrbit.current.x, targetOrbit.current.x, delta * damping);
        currentOrbit.current.y = THREE.MathUtils.lerp(currentOrbit.current.y, targetOrbit.current.y, delta * damping);
        currentPan.current.lerp(targetPan.current, delta * damping);

        // 2. Calculate Base Auto-Position
        let basePos = new THREE.Vector3();
        let lookAtTarget = new THREE.Vector3(0, 0, 0);

        if (mode === AppMode.SCATTER) {
            // Hand rotation logic
            let rotationInput = (handData.x - 0.5);
            if (Math.abs(rotationInput) < 0.05) rotationInput = 0; // Deadzone

            const rotationSpeed = rotationInput * 1.5; 
            
            if (handData.gesture === GestureType.OPEN_HAND) {
                autoAngle.current += rotationSpeed * delta;
            } else {
                autoAngle.current += delta * 0.05; // Very slow auto drift
            }
            
            // Vertical Tilt based on hand Y
            const heightInput = (handData.y - 0.5) * -10; 
            const clampedHeight = THREE.MathUtils.clamp(2 + heightInput, -2, 8);

            // Base Spherical coords
            // angle + manual orbit
            const finalAngle = autoAngle.current + currentOrbit.current.x;
            const finalRadius = scatterRadius * currentZoom.current;

            basePos.set(
                Math.sin(finalAngle) * finalRadius,
                clampedHeight + currentOrbit.current.y,
                Math.cos(finalAngle) * finalRadius
            );

        } else {
             // Tree/Text/Love mode
             const finalRadius = baseZ * currentZoom.current;
             
             // Gentle bob + Manual Height
             const bob = Math.sin(state.clock.elapsedTime * 0.5) * 0.5;
             const finalY = bob + currentOrbit.current.y;

             // Rotate around 0,0 based on manual orbit
             // Standard position is (0, y, finalRadius)
             // Rotating around Y axis by currentOrbit.x
             const theta = currentOrbit.current.x;
             const x = Math.sin(theta) * finalRadius;
             const z = Math.cos(theta) * finalRadius;

             basePos.set(x, finalY, z);
        }

        // 3. Apply Pan
        // Pan moves the camera AND the lookAt target
        const finalCameraPos = basePos.add(currentPan.current);
        const finalLookAt = lookAtTarget.add(currentPan.current);

        // 4. Update Camera
        camera.position.copy(finalCameraPos);
        camera.lookAt(finalLookAt);
    });

    return null;
};

export const Scene: React.FC = () => {
    return (
        <Canvas 
            camera={{ position: [0, 0, 17.5], fov: 60 }} 
            gl={{ toneMapping: THREE.ReinhardToneMapping, toneMappingExposure: 1.5 }}
            dpr={[1, 2]} // Limit pixel ratio for performance on high-res mobile screens
        >
            <color attach="background" args={['#050505']} />
            
            {/* Environment */}
            <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
            <Sparkles count={200} scale={12} size={2} speed={0.4} opacity={0.5} color="#FFFFE0" />
            <Environment preset="night" />
            
            {/* Dynamic Lighting */}
            <PulsingLights />

            {/* Content */}
            <ChristmasTree />
            <PhotoCloud />
            <Snowfall />
            <CameraController />

            {/* Post Processing */}
            <EffectComposer>
                <Bloom luminanceThreshold={1} mipmapBlur intensity={1.5} radius={0.4} />
            </EffectComposer>
        </Canvas>
    );
};
