import React, { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Image, Text, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store';
import { AppMode, GestureType, PhotoData } from '../types';
import { generateHolidayDescription } from '../services/geminiService';

export const PhotoCloud: React.FC = () => {
    const photos = useStore(state => state.photos);
    const { camera } = useThree();
    
    // Registry to track mesh positions for centralized interaction logic
    const itemsRef = useRef<Map<string, THREE.Mesh | THREE.Group>>(new Map());
    
    const registerRef = useCallback((id: string, mesh: THREE.Mesh | THREE.Group | null) => {
        if (mesh) itemsRef.current.set(id, mesh);
        else itemsRef.current.delete(id);
    }, []);

    // Centralized Interaction Loop
    useFrame(() => {
        const { handData, focusedPhotoId, setFocusedPhotoId, updatePhotoDescription, mode } = useStore.getState();

        // 1. Global Close Interaction (Open Hand)
        // If a photo is focused, opening your hand releases/closes it.
        if (focusedPhotoId) {
            if (handData.gesture === GestureType.OPEN_HAND) {
                setFocusedPhotoId(null);
            }
            return; // Exit early to prevent re-triggering open logic immediately
        }

        // 2. Global Open Interaction (Pinch)
        // If no photo is focused, pinching selects the closest photo to the hand cursor.
        if (handData.gesture === GestureType.PINCH) {
            let closestId: string | null = null;
            let minDistance = Infinity;
            
            // Reusable vector to prevent GC churn
            const worldPos = new THREE.Vector3();

            itemsRef.current.forEach((mesh, id) => {
                // Get world position and project to 2D screen space
                mesh.getWorldPosition(worldPos);
                worldPos.project(camera);

                // Convert NDC (-1 to 1) to Screen Coords (0 to 1)
                const screenX = (worldPos.x + 1) / 2;
                const screenY = (1 - worldPos.y) / 2;

                // Calculate Euclidean distance to hand cursor
                const dx = screenX - handData.x;
                const dy = screenY - handData.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Find the absolute closest photo
                if (dist < minDistance) {
                    minDistance = dist;
                    closestId = id;
                }
            });

            // "Magnetic" Selection Threshold
            // If the closest photo is within ~20% of screen width from the cursor, select it.
            // This makes selection much easier than requiring pixel-perfect hover.
            if (closestId && minDistance < 0.2) {
                setFocusedPhotoId(closestId);
                
                // Trigger AI Description if missing
                const photo = photos.find(p => p.id === closestId);
                if (photo && !photo.description) {
                     generateHolidayDescription(photo.url).then(desc => {
                        updatePhotoDescription(closestId!, desc);
                     });
                }
            }
        }
    });

    return (
        <group>
            {photos.map((photo) => (
                <PhotoItem 
                    key={photo.id} 
                    data={photo} 
                    registerRef={registerRef}
                />
            ))}
        </group>
    );
};

interface PhotoItemProps {
    data: PhotoData;
    registerRef: (id: string, mesh: THREE.Mesh | THREE.Group | null) => void;
}

const PhotoItem: React.FC<PhotoItemProps> = ({ data, registerRef }) => {
    const meshRef = useRef<THREE.Group>(null);
    const mode = useStore(state => state.mode);
    const focusedPhotoId = useStore(state => state.focusedPhotoId);
    const setFocusedPhotoId = useStore(state => state.setFocusedPhotoId);
    const updatePhotoDescription = useStore(state => state.updatePhotoDescription);
    
    // Mouse hover state
    const [hovered, setHover] = useState(false);
    // Hand proximity state (Visual only)
    const [handHovered, setHandHover] = useState(false);

    const isFocused = focusedPhotoId === data.id;

    // Register mesh with parent
    useEffect(() => {
        registerRef(data.id, meshRef.current);
        return () => registerRef(data.id, null);
    }, [data.id, registerRef]);

    // Helper object for calculating target rotation smoothly
    const targetObj = useMemo(() => new THREE.Object3D(), []);

    const { camera, size } = useThree();

    useFrame((state, delta) => {
        if (!meshRef.current) return;

        // 1. Determine Target Values
        let targetPos = new THREE.Vector3();
        let targetScale = 1;

        if (isFocused) {
            // Focus Mode: Move in front of camera
            const camDir = new THREE.Vector3();
            camera.getWorldDirection(camDir);
            const focusDist = 5;
            
            // Position: 5 units in front of camera
            targetPos.copy(camera.position).add(camDir.multiplyScalar(focusDist)); 
            
            // Scale: Calculate visible width at this distance to ensure it fits screen
            // Visible height = 2 * dist * tan(fov/2)
            const pCamera = camera as THREE.PerspectiveCamera;
            const vFOV = THREE.MathUtils.degToRad(pCamera.fov);
            const visibleHeight = 2 * focusDist * Math.tan(vFOV / 2);
            const visibleWidth = visibleHeight * (size.width / size.height);
            
            // Adjust scale factor based on screen orientation
            const isPortrait = size.width < size.height;
            // On mobile (portrait), user requested 1/4 width (0.25)
            // On desktop, we can keep it larger (e.g. 0.85)
            const scaleFactor = isPortrait ? 0.25 : 0.85;
            
            // Constrain scale to visible width factor, maxing out at 3.5
            targetScale = Math.min(3.5, visibleWidth * scaleFactor);

            // Rotation Target: Look at camera
            targetObj.position.copy(meshRef.current.position);
            targetObj.lookAt(camera.position);

        } else {
            // Non-Focused Modes
            if (mode === AppMode.TREE) {
                // Tree Mode: Compact arrangement AND Rotating
                
                // Calculate Rotation based on time
                const angle = state.clock.elapsedTime * 0.15;
                const s = Math.sin(angle);
                const c = Math.cos(angle);

                // Rotate the original tree position around Y axis
                const rotatedX = data.position[0] * c + data.position[2] * s;
                const rotatedZ = -data.position[0] * s + data.position[2] * c;

                targetPos.set(rotatedX, data.position[1], rotatedZ);
                targetScale = 0.8;
                
                // Rotation: Face outward from center
                targetObj.position.copy(meshRef.current.position);
                targetObj.lookAt(new THREE.Vector3(rotatedX * 2, data.position[1], rotatedZ * 2));
            } else {
                // Scatter Mode: Dispersed
                targetPos.set(...data.scatterPosition);
                // Add floating motion
                targetPos.y += Math.sin(state.clock.elapsedTime + data.position[0]) * 0.1; 
                targetScale = 1.2;
                
                // Rotation: Generally face camera
                targetObj.position.copy(meshRef.current.position);
                targetObj.lookAt(camera.position);
            }
        }

        // 2. Interpolate Position
        const posSpeed = isFocused ? 12 : 3;
        meshRef.current.position.lerp(targetPos, delta * posSpeed);

        // 3. Interpolate Scale
        const currentScale = meshRef.current.scale.x;
        const scaleSpeed = isFocused ? 12 : 3;
        const nextScale = THREE.MathUtils.lerp(currentScale, targetScale, delta * scaleSpeed);
        meshRef.current.scale.set(nextScale, nextScale, nextScale);

        // 4. Interpolate Rotation (Slerp)
        const rotSpeed = isFocused ? 15 : 3;
        meshRef.current.quaternion.slerp(targetObj.quaternion, delta * rotSpeed);

        // 5. Render Order
        if (isFocused) {
            meshRef.current.renderOrder = 999;
        } else {
            meshRef.current.renderOrder = 0;
        }

        // 6. Visual Feedback Logic (Local)
        // We still calculate local proximity for visual feedback (highlighting),
        // but the actual "Select" logic is now handled by the parent PhotoCloud.
        const handData = useStore.getState().handData;
        const vector = new THREE.Vector3();
        meshRef.current.getWorldPosition(vector);
        vector.project(camera);

        const screenX = (vector.x + 1) / 2;
        const screenY = (1 - vector.y) / 2;
        const dx = screenX - handData.x;
        const dy = screenY - handData.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const isHoveringHand = dist < 0.12;
        if (isHoveringHand !== handHovered) {
            setHandHover(isHoveringHand);
        }
    });

    return (
        <group ref={meshRef}>
            {/* Wrapper Group for Scaling/Positioning */}
                
            {/* Christmas Frame Group */}
            <group position={[0, 0, -0.01]}>
                {/* Main Red Frame - Narrower */}
                <mesh receiveShadow castShadow>
                    <boxGeometry args={[1.08, 1.08, 0.03]} />
                    <meshStandardMaterial 
                        color="#C41E3A" 
                        metalness={0.1} 
                        roughness={0.8} 
                    />
                </mesh>

                {/* Decorations */}
                <group position={[0, 0, 0.02]}>
                    {/* Top Corners: Golden Bells */}
                    {[
                        [-0.5, 0.5, -0.4], // Top Left, rotated slightly right
                        [0.5, 0.5, 0.4]    // Top Right, rotated slightly left
                    ].map(([x, y, r], i) => (
                        <group key={`bell-${i}`} position={[x, y, 0]} rotation={[0, 0, r]}>
                            {/* Bell Body */}
                            <mesh position={[0, -0.03, 0]}>
                                <cylinderGeometry args={[0.01, 0.035, 0.06, 12]} />
                                <meshStandardMaterial color="#fbbf24" metalness={0.6} roughness={0.3} />
                            </mesh>
                            {/* Clapper */}
                            <mesh position={[0, -0.06, 0]}>
                                <sphereGeometry args={[0.012, 8, 8]} />
                                <meshStandardMaterial color="#fbbf24" metalness={0.6} roughness={0.3} />
                            </mesh>
                        </group>
                    ))}

                    {/* Bottom Corners: Red Bows */}
                    {[
                        [-0.5, -0.5], // Bottom Left
                        [0.5, -0.5]   // Bottom Right
                    ].map(([x, y], i) => (
                        <group key={`bow-${i}`} position={[x, y, 0]}>
                            {/* Knot */}
                            <mesh>
                                <sphereGeometry args={[0.02, 8, 8]} />
                                <meshStandardMaterial color="#ef4444" />
                            </mesh>
                            {/* Left Loop */}
                            <mesh position={[-0.03, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
                                <coneGeometry args={[0.02, 0.06, 8]} />
                                <meshStandardMaterial color="#ef4444" />
                            </mesh>
                            {/* Right Loop */}
                            <mesh position={[0.03, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                                <coneGeometry args={[0.02, 0.06, 8]} />
                                <meshStandardMaterial color="#ef4444" />
                            </mesh>
                        </group>
                    ))}
                    
                    {/* Side Studs */}
                    <mesh position={[-0.54, 0, 0]}>
                            <sphereGeometry args={[0.025, 8, 8]} />
                            <meshStandardMaterial color="#fbbf24" metalness={0.6} roughness={0.3} />
                    </mesh>
                    <mesh position={[0.54, 0, 0]}>
                            <sphereGeometry args={[0.025, 8, 8]} />
                            <meshStandardMaterial color="#fbbf24" metalness={0.6} roughness={0.3} />
                    </mesh>
                </group>
            </group>

            {/* Photo Image */}
            <Image
                url={data.url}
                transparent
                side={THREE.DoubleSide}
                onPointerOver={() => setHover(true)}
                onPointerOut={() => setHover(false)}
                onClick={() => {
                    // Fallback mouse interaction
                    if (mode === AppMode.SCATTER || isFocused) {
                        setFocusedPhotoId(isFocused ? null : data.id);
                        if (!isFocused && !data.description) {
                            generateHolidayDescription(data.url).then(desc => {
                                updatePhotoDescription(data.id, desc);
                            });
                        }
                    }
                }}
                // Visual feedback for hover
                color={(hovered || handHovered) && !isFocused ? '#fff5f5' : 'white'}
                toneMapped={false} 
                position={[0, 0, 0.02]} 
            />

            {/* Description Text - Attached to group to follow position/scale */}
            {isFocused && data.description && (
                <Billboard position={[0, -0.75, 0.1]}>
                    <Text 
                        fontSize={0.12} 
                        color="#FFD700" 
                        outlineWidth={0.01}
                        outlineColor="#3E2723"
                        maxWidth={2} 
                        textAlign="center" 
                        font="https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hjp-Ek-_EeA.woff"
                        anchorY="top"
                        lineHeight={1.2}
                    >
                        {data.description}
                    </Text>
                </Billboard>
            )}
        </group>
    );
};