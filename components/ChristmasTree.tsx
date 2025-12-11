import React, { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { AppMode } from '../types';
import { Instance, Instances, Trail, useTexture } from '@react-three/drei';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Detect mobile device width for performance optimization
const IS_MOBILE = typeof window !== 'undefined' && window.innerWidth < 768;

// Increased proportional particle counts
const PARTICLE_COUNT = IS_MOBILE ? 3500 : 9000;
const ORNAMENT_COUNT = IS_MOBILE ? 400 : 700;

// Tree Geometry Constants (Aspect Ratio 1:0.7 -> Width = 0.7 * Height)
const TREE_HEIGHT = 12;
const TREE_WIDTH_RATIO = 0.7;
const MAX_RADIUS = (TREE_HEIGHT * TREE_WIDTH_RATIO) / 2; // 4.2

// Audio Context Singleton
let sharedAudioCtx: AudioContext | null = null;
const getAudioCtx = () => {
    if (!sharedAudioCtx && typeof window !== 'undefined') {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
            sharedAudioCtx = new AudioContextClass();
        }
    }
    return sharedAudioCtx;
};

const playStarJumpSound = (pitchFactor: number) => {
    try {
        const ctx = getAudioCtx();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});

        const now = ctx.currentTime;
        // Base note C5 (approx 523Hz), adjusted by pitchFactor
        const baseFreq = 523.25 * pitchFactor; 

        // Oscillator 1: Main Tone (Sine)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(baseFreq, now);
        // Slight frequency slide up for "jump" feel
        osc1.frequency.exponentialRampToValueAtTime(baseFreq * 1.05, now + 0.1);

        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        
        // Envelope 1
        gain1.gain.setValueAtTime(0, now);
        gain1.gain.linearRampToValueAtTime(0.08, now + 0.05); // Soft attack
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.8); // Long tail
        
        osc1.start(now);
        osc1.stop(now + 0.9);

        // Oscillator 2: Overtone (Fifth) for "sparkle/chime"
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(baseFreq * 1.5, now);
        
        osc2.connect(gain2);
        gain2.connect(ctx.destination);

        // Envelope 2
        gain2.gain.setValueAtTime(0, now);
        gain2.gain.linearRampToValueAtTime(0.04, now + 0.05);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        
        osc2.start(now);
        osc2.stop(now + 0.7);

    } catch (e) {
        // Ignore audio errors
    }
};

// Helper to generate points for a cone shape
const getTreePos = (volume: boolean) => {
    // Height from -6 to +6
    const y = (Math.random() * TREE_HEIGHT) - (TREE_HEIGHT / 2);
    
    // Normalized height (0 at bottom, 1 at top)
    const h = (y + (TREE_HEIGHT / 2)) / TREE_HEIGHT;
    
    // Cone radius at this height
    const maxR = MAX_RADIUS * (1 - h);
    
    const angle = Math.random() * Math.PI * 2;
    
    let r;
    if (volume) {
        // Volume: sqrt makes distribution uniform in the circle
        r = maxR * Math.sqrt(Math.random());
    } else {
        // Surface: Concentrate near edge
        r = maxR * (0.85 + Math.random() * 0.15);
    }

    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;

    return new THREE.Vector3(x, y, z);
};

// Helper for scatter coordinates
const getScatterPos = () => {
    const range = 20;
    return new THREE.Vector3(
        (Math.random() - 0.5) * range,
        (Math.random() - 0.5) * range,
        (Math.random() - 0.5) * range
    );
};

// Helper to create a 5-pointed star shape
const createStarShape = (outerRadius: number, innerRadius: number) => {
    const shape = new THREE.Shape();
    const points = 5;
    // Rotate so point is up (PI/2 = 90 degrees)
    const offset = Math.PI / 2;

    for (let i = 0; i < points * 2; i++) {
        const angle = (i * Math.PI) / points + offset;
        const r = i % 2 === 0 ? outerRadius : innerRadius;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
    }
    shape.closePath();
    return shape;
};

// --- REALISTIC GEOMETRY HELPERS ---

// 1. Realistic Bell Profile (Lathe)
const createBellGeometry = () => {
    const points = [];
    // Bell curve profile
    for (let i = 0; i <= 10; i++) {
        const y = (i / 10) * 0.15; // Height 0.15
        // Radius function: wide at bottom, narrows, then flares slightly at top
        const x = 0.08 * Math.pow(1 - (i/10), 2) + 0.02; 
        points.push(new THREE.Vector2(x, y));
    }
    const geometry = new THREE.LatheGeometry(points, 16);
    geometry.computeVertexNormals();
    return geometry;
};

// 2. Realistic Candy Cane (Tube along curve)
const createCaneGeometry = () => {
    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.1, 0),
        new THREE.Vector3(0, 0.05, 0),
        new THREE.Vector3(0.03, 0.08, 0),
        new THREE.Vector3(0.06, 0.05, 0),
        new THREE.Vector3(0.06, 0.02, 0)
    ]);
    return new THREE.TubeGeometry(curve, 20, 0.015, 8, false);
};

// 3. Realistic Ribbon Geometry (Cross + Bow)
const createRibbonGeometry = () => {
    // Vertical wrap
    const vGeo = new THREE.BoxGeometry(0.205, 0.205, 0.05);
    // Horizontal wrap
    const hGeo = new THREE.BoxGeometry(0.05, 0.205, 0.205);
    
    // Merge
    const merged = mergeGeometries([vGeo, hGeo]);
    return merged;
};

// 4. Bauble Cap Geometry
const createBaubleCapGeometry = () => {
    const cyl = new THREE.CylinderGeometry(0.03, 0.03, 0.04, 12);
    cyl.translate(0, 0.11, 0); // Move to top of sphere (radius 0.12)
    const ring = new THREE.TorusGeometry(0.015, 0.005, 6, 12);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, 0.14, 0);
    
    // Merge
    const merged = mergeGeometries([cyl, ring]);
    return merged;
}

const createStockingShape = () => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.08, 0); // Top width
    shape.lineTo(0.09, -0.15); // Front ankle
    shape.quadraticCurveTo(0.12, -0.2, 0.16, -0.2); // Top of foot
    shape.lineTo(0.16, -0.25); // Toe vertical
    shape.quadraticCurveTo(0.08, -0.25, 0.0, -0.25); // Sole
    shape.quadraticCurveTo(-0.02, -0.25, -0.02, -0.15); // Heel
    shape.lineTo(-0.01, 0); // Back calf
    return shape;
};

// Procedural Striped Texture Hook
const useStripedTexture = () => {
    return useMemo(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 64; 
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#ff0000'; // Red base
            ctx.fillRect(0, 0, 64, 64);
            ctx.fillStyle = '#ffffff'; // White stripes
            ctx.beginPath();
            // Draw diagonal stripes
            for(let i = -64; i < 128; i+=16) {
                ctx.moveTo(i, 0);
                ctx.lineTo(i + 8, 0);
                ctx.lineTo(i + 8 - 64, 64);
                ctx.lineTo(i - 64, 64);
            }
            ctx.fill();
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(2, 2);
        // Slightly rotate texture to align with tube spiral? 
        // Tube mapping is linear UV, diagonal texture works well for "barber pole"
        return tex;
    }, []);
};

// Helper for Text Generation using Off-screen Canvas
const getTextPositions = (count: number, textLines: string[], isMobile: boolean): THREE.Vector3[] => {
    const canvas = document.createElement('canvas');
    const width = 256;
    const height = 128;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return Array(count).fill(new THREE.Vector3(0,0,0));

    // Draw background and text
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    
    // Use the loaded font or fallback
    ctx.font = 'bold 50px "Mountains of Christmas", serif'; 
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Draw Text lines
    if (textLines.length === 1) {
        ctx.fillText(textLines[0], width / 2, height / 2);
    } else {
        ctx.fillText(textLines[0], width / 2, height / 3);
        ctx.fillText(textLines[1], width / 2, (height / 3) * 2.2);
    }

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const validPixels: {x: number, y: number}[] = [];

    // Scan for white pixels
    for(let i = 0; i < width * height; i++) {
        // Check Alpha and Red channel (white text)
        if(data[i * 4] > 100) { 
            const x = (i % width);
            const y = Math.floor(i / width);
            validPixels.push({x, y});
        }
    }

    const result: THREE.Vector3[] = [];
    if (validPixels.length === 0) return Array(count).fill(new THREE.Vector3(0,0,0));

    // Determine 3D mapping size
    const viewWidth = isMobile ? 9.0 : 16;
    const viewHeight = isMobile ? 4.5 : 8;

    for(let i = 0; i < count; i++) {
        const pixel = validPixels[i % validPixels.length];
        
        // Map 2D pixel to 3D Space (Scale and Center)
        const nx = (pixel.x / width - 0.5) * viewWidth;
        const ny = -(pixel.y / height - 0.5) * viewHeight; // Invert Y
        
        // Add random Z depth for 3D volume effect
        const nz = (Math.random() - 0.5) * 0.8; 
        
        // Add slight jitter to x/y to prevent grid look
        const jitter = 0.05;
        result.push(new THREE.Vector3(
            nx + (Math.random() - 0.5) * jitter, 
            ny + (Math.random() - 0.5) * jitter, 
            nz
        ));
    }
    
    // Shuffle the result so particles fill in randomly
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
}

export const ChristmasTree: React.FC = () => {
    const mode = useStore(state => state.mode);
    
    const textPositions = useMemo(() => getTextPositions(PARTICLE_COUNT + ORNAMENT_COUNT, ['Merry','Christmas'], IS_MOBILE), []);
    const loveTextPositions = useMemo(() => getTextPositions(PARTICLE_COUNT + ORNAMENT_COUNT, ['G X X'], IS_MOBILE), []);

    // Textures & Shapes
    const stripedTexture = useStripedTexture();
    const bellGeometry = useMemo(() => createBellGeometry(), []);
    const caneGeometry = useMemo(() => createCaneGeometry(), []);
    const ribbonGeometry = useMemo(() => createRibbonGeometry(), []);
    const baubleCapGeometry = useMemo(() => createBaubleCapGeometry(), []);
    const stockingShape = useMemo(() => createStockingShape(), []);
    
    // Pre-create geometries to pass as props to Instances to avoid undefined errors
    const boxGeometry = useMemo(() => new RoundedBoxGeometry(0.2, 0.2, 0.2, 4, 0.02), []);
    const particleGreenGeo = useMemo(() => new THREE.DodecahedronGeometry(0.025, 0), []);
    const particleYellowGeo = useMemo(() => new THREE.DodecahedronGeometry(0.03, 0), []);
    const sphereGeo = useMemo(() => new THREE.SphereGeometry(0.12, 32, 32), []);
    const pineConeGeo = useMemo(() => new THREE.ConeGeometry(0.06, 0.15, 8), []);
    const stockingExtrudeGeo = useMemo(() => new THREE.ExtrudeGeometry(stockingShape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3 }), [stockingShape]);


    // Generate Particles
    const particles = useMemo(() => {
        const temp = [];
        for(let i=0; i<PARTICLE_COUNT; i++) {
             temp.push({
                 treePos: getTreePos(true), // volume fill
                 scatterPos: getScatterPos(),
                 textPos: textPositions[i],
                 lovePos: loveTextPositions[i],
                 type: Math.random() < 0.3 ? 'yellow' : 'green',
                 phase: Math.random() * Math.PI * 2,
                 twinkleSpeed: 1 + Math.random() * 4
             });
        }
        return temp;
    }, [textPositions, loveTextPositions]);

    const greenParticles = useMemo(() => particles.filter(p => p.type === 'green'), [particles]);
    const yellowParticles = useMemo(() => particles.filter(p => p.type === 'yellow'), [particles]);

    // Generate Ornaments
    const ornamentGroups = useMemo(() => {
        const boxes = [];
        const spheres = [];
        const canes = [];
        const bells = [];
        const pinecones = [];
        const stockings = [];
        
        let globalIndex = PARTICLE_COUNT; 

        for(let i=0; i<ORNAMENT_COUNT; i++) {
            const typeRoll = Math.random();
            const data = {
                treePos: getTreePos(false), // surface
                scatterPos: getScatterPos(),
                textPos: textPositions[globalIndex % textPositions.length],
                lovePos: loveTextPositions[globalIndex % loveTextPositions.length]
            };
            globalIndex++;

            if (typeRoll < 0.20) {
                // Box
                boxes.push({ ...data, color: Math.random() > 0.5 ? '#ef4444' : '#fbbf24' });
            } else if (typeRoll < 0.40) {
                // Sphere
                spheres.push({ ...data, color: '#fbbf24' });
            } else if (typeRoll < 0.55) {
                // Bells
                bells.push({ ...data, color: '#e5e7eb' }); 
            } else if (typeRoll < 0.70) {
                 // Pinecones
                 pinecones.push({ ...data, color: '#d97706' });
            } else if (typeRoll < 0.85) {
                // Stockings
                stockings.push({ ...data, color: '#ef4444' });
            } else {
                // Cane
                canes.push({ ...data, color: '#ffffff' }); // White base for texture
            }
        }
        return { boxes, spheres, canes, bells, pinecones, stockings };
    }, [textPositions, loveTextPositions]);

    const groupRef = useRef<THREE.Group>(null);

    useFrame((state, delta) => {
        if (!groupRef.current) return;
        if (mode === AppMode.TREE) {
            groupRef.current.rotation.y = state.clock.elapsedTime * 0.15;
        } else if (mode === AppMode.TEXT || mode === AppMode.LOVE) {
            groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.1;
        }
    });

    return (
        <group ref={groupRef}>
            {/* --- Green Particles --- */}
            <Instances range={greenParticles.length} geometry={particleGreenGeo}>
                <meshStandardMaterial 
                    color="#22c55e" 
                    emissive="#15803d"
                    emissiveIntensity={3}
                    toneMapped={false}
                />
                {greenParticles.map((data, i) => (
                    <TransitionParticle key={`g-${i}`} data={data} mode={mode} />
                ))}
            </Instances>

            {/* --- Yellow Particles --- */}
            <Instances range={yellowParticles.length} geometry={particleYellowGeo}>
                <meshStandardMaterial 
                    color="#facc15" 
                    emissive="#eab308"
                    emissiveIntensity={4}
                    toneMapped={false}
                />
                {yellowParticles.map((data, i) => (
                    <TransitionParticle key={`y-${i}`} data={data} mode={mode} />
                ))}
            </Instances>

            {/* --- Gift Boxes (Rounded with Ribbons) --- */}
            {/* 1. The Box */}
            <Instances range={ornamentGroups.boxes.length} geometry={boxGeometry}>
                 <meshStandardMaterial 
                    metalness={0.1} 
                    roughness={0.8} // Matte paper look
                />
                {ornamentGroups.boxes.map((data, i) => (
                     <TransitionInstance key={`b-${i}`} data={data} mode={mode} />
                ))}
            </Instances>
            {/* 2. The Ribbon (Reusing Box positions) */}
            <Instances range={ornamentGroups.boxes.length} geometry={ribbonGeometry}>
                <meshStandardMaterial 
                    color="#ffffff" 
                    metalness={0.9} 
                    roughness={0.1} 
                    emissive="#ffffff"
                    emissiveIntensity={0.2}
                />
                 {ornamentGroups.boxes.map((data, i) => (
                     <TransitionInstance key={`br-${i}`} data={data} mode={mode} />
                ))}
            </Instances>


            {/* --- Sphere Ornaments (High Gloss + Caps) --- */}
            {/* 1. The Sphere */}
            <Instances range={ornamentGroups.spheres.length} geometry={sphereGeo}>
                <meshStandardMaterial 
                    metalness={1.0} 
                    roughness={0.0} 
                    envMapIntensity={2.5}
                    color="#fbbf24"
                />
                {ornamentGroups.spheres.map((data, i) => (
                     <TransitionInstance key={`s-${i}`} data={data} mode={mode} />
                ))}
            </Instances>
            {/* 2. The Cap */}
            <Instances range={ornamentGroups.spheres.length} geometry={baubleCapGeometry}>
                 <meshStandardMaterial 
                    color="#d4d4d8"
                    metalness={1.0} 
                    roughness={0.3} 
                />
                {ornamentGroups.spheres.map((data, i) => (
                     <TransitionInstance key={`sc-${i}`} data={data} mode={mode} />
                ))}
            </Instances>


            {/* --- Realistic Bells (Lathe Geometry) --- */}
            <Instances range={ornamentGroups.bells.length} geometry={bellGeometry}>
                <meshStandardMaterial 
                    metalness={0.9} 
                    roughness={0.15} 
                    color="#fbbf24" // Gold
                    envMapIntensity={2.0}
                    side={THREE.DoubleSide}
                />
                {ornamentGroups.bells.map((data, i) => (
                     <TransitionInstance key={`bell-${i}`} data={data} mode={mode} />
                ))}
            </Instances>

            {/* --- Realistic Candy Canes (Striped Tubes) --- */}
            <Instances range={ornamentGroups.canes.length} geometry={caneGeometry}>
                <meshPhysicalMaterial 
                    map={stripedTexture}
                    clearcoat={1.0}
                    clearcoatRoughness={0.1}
                    metalness={0.1} 
                    roughness={0.2}
                    color="#ffffff" // Base color white, texture adds red
                />
                {ornamentGroups.canes.map((data, i) => (
                     <TransitionInstance key={`c-${i}`} data={data} mode={mode} />
                ))}
            </Instances>

             {/* --- Stockings (Thicker Felt) --- */}
             <Instances range={ornamentGroups.stockings.length} geometry={stockingExtrudeGeo}>
                <meshStandardMaterial 
                    metalness={0.0} 
                    roughness={1.0} // Fabric look
                    color="#ef4444"
                />
                {ornamentGroups.stockings.map((data, i) => (
                     <TransitionInstance key={`stock-${i}`} data={data} mode={mode} />
                ))}
            </Instances>

            {/* --- Pinecones --- */}
            <Instances range={ornamentGroups.pinecones.length} geometry={pineConeGeo}>
                <meshStandardMaterial 
                    metalness={0.1} 
                    roughness={0.9} 
                    color="#92400e" // Darker brown
                    flatShading
                />
                {ornamentGroups.pinecones.map((data, i) => (
                     <TransitionInstance key={`pine-${i}`} data={data} mode={mode} />
                ))}
            </Instances>

            <StarSystem mode={mode} />
        </group>
    );
};

// Reusable component for particles movement
const TransitionParticle: React.FC<{data: any, mode: AppMode}> = ({data, mode}) => {
    const ref = useRef<any>(null);
    useFrame((state, delta) => {
        if (!ref.current) return;
        
        let target;
        if (mode === AppMode.TREE) target = data.treePos;
        else if (mode === AppMode.TEXT) target = data.textPos;
        else if (mode === AppMode.LOVE) target = data.lovePos;
        else target = data.scatterPos;
        
        // Smooth lerp
        // Optimize: Make scattering faster for an "explosion" feel from static text
        const lerpSpeed = mode === AppMode.SCATTER ? 4.0 : 2.5;
        ref.current.position.lerp(target, delta * lerpSpeed);
        
        // Add subtle noise/twinkle movement
        if (mode !== AppMode.TREE) {
            ref.current.position.y += Math.sin(state.clock.elapsedTime + data.treePos.x) * 0.01;
        }

        // Twinkling effect (Scale pulsing)
        const time = state.clock.elapsedTime;
        // Pulse between 0.7 and 1.3 for a visible but subtle twinkle
        const scale = 1.0 + Math.sin(time * data.twinkleSpeed + data.phase) * 0.3;
        ref.current.scale.setScalar(scale);
    });
    return <Instance ref={ref} />;
};

// Reusable component for ornaments (supports color and rotation)
const TransitionInstance: React.FC<{data: any, mode: AppMode}> = ({data, mode}) => {
    const ref = useRef<any>(null);
    // Random initial rotation
    const randRot = useMemo(() => new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI), []);
    
    useLayoutEffect(() => {
        if (ref.current) {
            ref.current.rotation.copy(randRot);
        }
    }, [randRot]);

    useFrame((state, delta) => {
        if (!ref.current) return;
        
        let target;
        if (mode === AppMode.TREE) target = data.treePos;
        else if (mode === AppMode.TEXT) target = data.textPos;
        else if (mode === AppMode.LOVE) target = data.lovePos;
        else target = data.scatterPos;
        
        const lerpSpeed = mode === AppMode.SCATTER ? 4.5 : 3.0;
        ref.current.position.lerp(target, delta * lerpSpeed);
        
        // Continuous rotation
        ref.current.rotation.x += delta * 0.5;
        ref.current.rotation.y += delta * 0.5;
    });

    // DO NOT pass rotation={randRot} here to avoid read-only assignment errors in newer Drei versions
    return <Instance ref={ref} color={data.color} />;
};

// New StarSystem Component
const StarSystem: React.FC<{mode: AppMode}> = ({mode}) => {
    const bigStarRef = useRef<THREE.Mesh>(null);
    const starShape = useMemo(() => createStarShape(0.6, 0.3), []);
    const miniStarShape = useMemo(() => createStarShape(0.15, 0.07), []);
    const lastSegmentRef = useRef<number>(-1);
    
    // Adjusted Y to 6.5 so bottom of star (approx -0.5) touches tree top (y=6.0)
    const treeTopPos = new THREE.Vector3(0, 6.5, 0);

    // Generate random scatter positions for mini stars
    const miniStarsData = useMemo(() => {
        const count = 60;
        const temp = [];
        for(let i = 0; i < count; i++) {
            // Scatter widely
            const scatter = new THREE.Vector3(
                (Math.random() - 0.5) * 25,
                (Math.random() - 0.5) * 20 + 5,
                (Math.random() - 0.5) * 25
            );
            // Slight jitter for gather position so they don't z-fight perfectly
            const gatherJitter = new THREE.Vector3(
                (Math.random() - 0.5) * 0.2,
                (Math.random() - 0.5) * 0.2,
                (Math.random() - 0.5) * 0.2
            );
            temp.push({ scatter, gatherJitter });
        }
        return temp;
    }, []);

    // Create shared geometry to save memory
    const miniGeo = useMemo(() => {
        return new THREE.ExtrudeGeometry(miniStarShape, { depth: 0.05, bevelEnabled: false });
    }, [miniStarShape]);

    useFrame((state, delta) => {
        if (bigStarRef.current) {
            const isScatter = mode === AppMode.SCATTER;
            
            // Big Star Scale Logic
            // Shrink to 0 in scatter mode, Grow to 1 in Tree/Text mode
            const targetScale = isScatter ? 0.0 : 1.0;
            const currentScale = bigStarRef.current.scale.x;
            const nextScale = THREE.MathUtils.lerp(currentScale, targetScale, delta * 5);
            bigStarRef.current.scale.set(nextScale, nextScale, nextScale);
            
            // Base Rotation
            bigStarRef.current.rotation.y += delta * 0.5;
            
            let targetPos = treeTopPos;
            let lerpSpeed = 2; // Default relaxed lerp speed
            let zTilt = Math.sin(state.clock.elapsedTime) * 0.1; // Default gentle sway

            if (mode === AppMode.TEXT) {
                // Move to top-left of 'M' in "Merry Christmas"
                if (IS_MOBILE) {
                    targetPos = new THREE.Vector3(-2.5, 2.0, 0.5); 
                } else {
                    targetPos = new THREE.Vector3(-4.5, 3.5, 0.5);
                }
                lastSegmentRef.current = -1;
            } else if (mode === AppMode.LOVE) {
                // Dynamic Jumping Logic for "G X X"
                const time = state.clock.elapsedTime;
                const jumpDuration = 1.3; // Slower, more elegant
                const totalCycle = jumpDuration * 4; // L->C, C->R, R->C, C->L
                
                const progress = (time % totalCycle) / jumpDuration; 
                const segment = Math.floor(progress); // 0, 1, 2, 3
                const alpha = progress % 1; 

                // Sound Effect Trigger
                if (segment !== lastSegmentRef.current) {
                    // Play sound: Higher pitch for middle jumps (Center<->Right)
                    const pitch = (segment === 1 || segment === 2) ? 1.25 : 1.0;
                    playStarJumpSound(pitch);
                    lastSegmentRef.current = segment;
                }

                // Smoothstep for elegant horizontal ease
                const smoothAlpha = THREE.MathUtils.smoothstep(alpha, 0, 1);

                // Coordinates for G (Left), X (Center), X (Right)
                // Assuming "G X X" text is centered around 0
                const xOffset = IS_MOBILE ? 2.5 : 5.0; 
                const yBase = IS_MOBILE ? 1.5 : 2.5; 
                const jumpHeight = IS_MOBILE ? 1.5 : 2.0;

                const left = new THREE.Vector3(-xOffset, yBase, 0);
                const center = new THREE.Vector3(0, yBase, 0);
                const right = new THREE.Vector3(xOffset, yBase, 0);

                let start, end;
                let direction = 1; // 1 for right, -1 for left

                switch(segment) {
                    case 0: // G -> X
                        start = left; end = center; 
                        direction = 1;
                        break;
                    case 1: // X -> X (Right)
                        start = center; end = right; 
                        direction = 1;
                        break;
                    case 2: // X -> X (Center)
                        start = right; end = center; 
                        direction = -1;
                        break;
                    default: // X -> G
                        start = center; end = left; 
                        direction = -1;
                        break;
                }

                // Interpolate X/Z
                targetPos = new THREE.Vector3().lerpVectors(start, end, smoothAlpha);
                
                // Add Parabolic Arc to Y (Jump)
                // sin(0..PI) creates the arc 
                targetPos.y += Math.sin(alpha * Math.PI) * jumpHeight;

                // Dynamic Tilt: Lean into the jump direction
                // Tilt angle peaks at middle of jump
                zTilt = -direction * Math.sin(alpha * Math.PI) * 0.4;

                // Increase lerp speed significantly to follow the calculated arc closely
                // otherwise the smoothing will flatten the jump
                lerpSpeed = 8;
            } else {
                lastSegmentRef.current = -1;
            }
            
            bigStarRef.current.position.lerp(targetPos, delta * lerpSpeed);
            
            // Smoothly interpolate rotation tilt
            const currentTilt = bigStarRef.current.rotation.z;
            bigStarRef.current.rotation.z = THREE.MathUtils.lerp(currentTilt, zTilt, delta * 3);
        }
    });

    return (
        <group>
            {/* Big Main Star with Trail */}
            <Trail
                width={0.6}
                length={6}
                color={new THREE.Color("#FCD34D")}
                attenuation={(t) => t * t}
            >
                <mesh ref={bigStarRef} position={[0, 6.5, 0]}>
                    <extrudeGeometry args={[starShape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 }]} />
                    <meshStandardMaterial 
                        color="#FCD34D" 
                        emissive="#fbbf24" 
                        emissiveIntensity={4} 
                        toneMapped={false}
                        metalness={0.8}
                        roughness={0.1}
                    />
                    <pointLight distance={10} intensity={5} color="#fbbf24" decay={2} />
                </mesh>
            </Trail>

            {/* Exploding Mini Stars with Trails */}
             {miniStarsData.map((data, i) => (
                 <MiniStarWithTrail 
                    key={i} 
                    data={data} 
                    mode={mode} 
                    treeTop={treeTopPos} 
                    geometry={miniGeo} 
                 />
             ))}
        </group>
    );
};

const MiniStarWithTrail: React.FC<{data: any, mode: AppMode, treeTop: THREE.Vector3, geometry: THREE.BufferGeometry}> = ({data, mode, treeTop, geometry}) => {
    const ref = useRef<THREE.Mesh>(null);
    const rotationSpeed = useMemo(() => (Math.random() - 0.5) * 5, []); // Fast rotation

    useFrame((state, delta) => {
        if(!ref.current) return;
        
        let target;
        let scaleTarget = 1;
        
        if (mode === AppMode.SCATTER) {
            // Explode outwards
            target = data.scatter;
            scaleTarget = 1.0;
        } else {
            // Implode into the big star
            // Add jitter so they don't occupy exact same float coordinate
            target = treeTop.clone().add(data.gatherJitter); 
            // Shrink them slightly as they enter center so they don't stick out of the big star too much while transitioning
            scaleTarget = 0.01; 
        }

        ref.current.position.lerp(target, delta * (mode === AppMode.SCATTER ? 2 : 4)); // Gather faster than scatter
        
        // Lerp scale
        const cs = ref.current.scale.x;
        const ns = THREE.MathUtils.lerp(cs, scaleTarget, delta * 3);
        ref.current.scale.set(ns, ns, ns);

        // Rotate
        ref.current.rotation.x += delta * rotationSpeed;
        ref.current.rotation.y += delta * rotationSpeed;
    });

    return (
        <Trail
            width={0.05} 
            length={1.5} 
            color={new THREE.Color("#FCD34D")}
            attenuation={(t) => t * t}
            interval={1} 
        >
            <mesh ref={ref} geometry={geometry}>
                 <meshStandardMaterial 
                    color="#FCD34D" 
                    emissive="#fbbf24" 
                    emissiveIntensity={3} 
                    toneMapped={false}
                 />
            </mesh>
        </Trail>
    );
}