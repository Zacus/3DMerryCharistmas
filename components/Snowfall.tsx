import React, { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Instance, Instances } from '@react-three/drei';
import * as THREE from 'three';

const SNOW_COUNT = 1200;

// Helper to generate snow data
const generateSnowData = (count: number) => {
    const temp = [];
    for (let i = 0; i < count; i++) {
        temp.push({
            position: new THREE.Vector3(
                (Math.random() - 0.5) * 40,
                (Math.random() - 0.5) * 30 + 5,
                (Math.random() - 0.5) * 40
            ),
            speed: 0.2 + Math.random() * 0.8, // Slower, gentler fall
            wobbleSpeed: 0.5 + Math.random(),
            offset: Math.random() * 100,
            scale: 0.5 + Math.random() * 0.8 // Random scale 0.5x to 1.3x
        });
    }
    return temp;
};

export const Snowfall: React.FC = () => {
    // Split count into groups for variety
    const group1Count = Math.floor(SNOW_COUNT * 0.5); // 50% Standard
    const group2Count = Math.floor(SNOW_COUNT * 0.3); // 30% Diamond
    const group3Count = SNOW_COUNT - group1Count - group2Count; // 20% Tiny

    const group1 = useMemo(() => generateSnowData(group1Count), [group1Count]);
    const group2 = useMemo(() => generateSnowData(group2Count), [group2Count]);
    const group3 = useMemo(() => generateSnowData(group3Count), [group3Count]);

    const materialProps = {
        color: "#ffffff", 
        emissive: "#e0f2fe",
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.9,
        toneMapped: false
    };

    // Pre-create geometries to pass to Instances explicitly to avoid undefined errors
    const dodecaGeo = useMemo(() => new THREE.DodecahedronGeometry(0.03, 0), []);
    const octaGeo = useMemo(() => new THREE.OctahedronGeometry(0.025, 0), []);
    const tetraGeo = useMemo(() => new THREE.TetrahedronGeometry(0.02, 0), []);

    return (
        <group>
            {/* Group 1: Standard Fluffy Snow (Dodecahedron) */}
            <Instances range={group1Count} geometry={dodecaGeo}>
                <meshStandardMaterial {...materialProps} />
                {group1.map((data, i) => (
                    <SnowFlake key={`g1-${i}`} data={data} />
                ))}
            </Instances>

            {/* Group 2: Diamond/Crystal Snow (Octahedron) */}
            <Instances range={group2Count} geometry={octaGeo}>
                <meshStandardMaterial {...materialProps} />
                {group2.map((data, i) => (
                    <SnowFlake key={`g2-${i}`} data={data} />
                ))}
            </Instances>

            {/* Group 3: Tiny Sharp Snow (Tetrahedron) */}
            <Instances range={group3Count} geometry={tetraGeo}>
                <meshStandardMaterial {...materialProps} />
                {group3.map((data, i) => (
                    <SnowFlake key={`g3-${i}`} data={data} />
                ))}
            </Instances>
        </group>
    );
};

const SnowFlake: React.FC<{data: any}> = ({ data }) => {
    const ref = useRef<any>(null);
    const pos = useRef(data.position.clone());

    useLayoutEffect(() => {
        if(ref.current) {
            ref.current.position.copy(data.position);
            ref.current.scale.setScalar(data.scale);
        }
    }, [data]);

    useFrame((state, delta) => {
        if (!ref.current) return;

        // Fall down
        pos.current.y -= data.speed * delta;

        // Reset logic: if below y=-10, reset to top
        if (pos.current.y < -10) {
            pos.current.y = 25;
            // Randomize X/Z again so they don't fall in lines
            pos.current.x = (Math.random() - 0.5) * 40;
            pos.current.z = (Math.random() - 0.5) * 40;
        }

        // Wobble
        const time = state.clock.elapsedTime;
        const xOffset = Math.sin(time * data.wobbleSpeed + data.offset) * 0.2; // Slight side movement
        const zOffset = Math.cos(time * data.wobbleSpeed + data.offset) * 0.2;

        ref.current.position.set(
            pos.current.x + xOffset,
            pos.current.y,
            pos.current.z + zOffset
        );
        
        // Rotate the flake
        ref.current.rotation.x += delta * 0.5;
        ref.current.rotation.y += delta * 0.3;
    });

    // DO NOT pass position={data.position} or scale={data.scale} here to avoid read-only conflicts
    return <Instance ref={ref} />;
};