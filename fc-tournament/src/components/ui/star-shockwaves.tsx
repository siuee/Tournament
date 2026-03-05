import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

type ThemeKey = 'molten' | 'cosmic' | 'emerald';

function StarShockwaves() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);

  const [theme, setTheme] = useState<ThemeKey>('molten');
  const [isAnimating, setIsAnimating] = useState(true);

  // Allow outer UI (App-level controls) to drive theme / pulse / animate
  useEffect(() => {
    const handleTheme = (e: Event) => {
      const detail = (e as CustomEvent).detail as ThemeKey | undefined;
      if (detail === 'molten' || detail === 'cosmic' || detail === 'emerald') {
        setTheme(detail);
      }
    };

    const handlePulse = () => {
      call('pulse');
    };

    const handleAnimate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === 'boolean') {
        setIsAnimating(detail);
      }
    };

    window.addEventListener('starshockwaves-theme', handleTheme);
    window.addEventListener('starshockwaves-pulse', handlePulse);
    window.addEventListener('starshockwaves-animate', handleAnimate);

    // Request current state on mount (e.g. when switching pages) so theme/animate persist
    window.dispatchEvent(new Event('starshockwaves-request-state'));

    return () => {
      window.removeEventListener('starshockwaves-theme', handleTheme);
      window.removeEventListener('starshockwaves-pulse', handlePulse);
      window.removeEventListener('starshockwaves-animate', handleAnimate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const body = document.body;
    const classes = ['theme-molten', 'theme-cosmic', 'theme-emerald'];
    classes.forEach(c => body.classList.remove(c));
    body.classList.add(`theme-${theme}`);
  }, [theme]);

  useEffect(() => {
    if (!mountRef.current) return;

    let width = mountRef.current.clientWidth;
    let height = mountRef.current.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1500);
    camera.position.z = 90;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.25;
    controls.minDistance = 30;
    controls.maxDistance = 300;
    controls.enablePan = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.15;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 1.5, 0.4, 0.85);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    const themes: Record<
      ThemeKey,
      { name: string; colors: THREE.Color[]; bloom: { strength: number; radius: number; threshold: number } }
    > = {
      molten: {
        name: 'Molten',
        colors: [
          new THREE.Color(0xff4800),
          new THREE.Color(0xff8c00),
          new THREE.Color(0xd73a00),
          new THREE.Color(0x3d1005),
          new THREE.Color(0xffc600)
        ],
        bloom: { strength: 0.35, radius: 0.45, threshold: 0.7 }
      },
      cosmic: {
        name: 'Cosmic',
        colors: [
          new THREE.Color(0x6a0dad),
          new THREE.Color(0x9370db),
          new THREE.Color(0x4b0082),
          new THREE.Color(0x8a2be2),
          new THREE.Color(0xdda0dd)
        ],
        bloom: { strength: 0.4, radius: 0.5, threshold: 0.65 }
      },
      emerald: {
        name: 'Emerald',
        colors: [
          new THREE.Color(0x00ff7f),
          new THREE.Color(0x3cb371),
          new THREE.Color(0x2e8b57),
          new THREE.Color(0x00fa9a),
          new THREE.Color(0x98fb98)
        ],
        bloom: { strength: 0.3, radius: 0.6, threshold: 0.75 }
      }
    };

    const particleCount = 10000;
    const MAX_HOME_RADIUS = 45;
    let time = 0;
    let shockwaves: Array<{ t0: number; amplitude: number; speed: number; width: number; decay: number }> = [];

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const targetPositions = new Float32Array(particleCount * 3);
    const disintegrationOffsets = new Float32Array(particleCount * 3);

    function createStarPath(particleIndex: number, totalParticles: number) {
      const numStarPoints = 5;
      const outerRadius = 35;
      const innerRadius = 15;
      const scale = 1.0;
      const zDepth = 4;

      const starVertices: THREE.Vector2[] = [];
      for (let i = 0; i < numStarPoints; i++) {
        let angle = (i / numStarPoints) * Math.PI * 2 - Math.PI / 2;
        starVertices.push(new THREE.Vector2(outerRadius * Math.cos(angle), outerRadius * Math.sin(angle)));
        angle += Math.PI / numStarPoints;
        starVertices.push(new THREE.Vector2(innerRadius * Math.cos(angle), innerRadius * Math.sin(angle)));
      }

      const numSegments = starVertices.length;
      const t_path = (particleIndex / totalParticles) * numSegments;
      const segmentIndex = Math.floor(t_path) % numSegments;
      const segmentProgress = t_path - Math.floor(t_path);
      const startVertex = starVertices[segmentIndex];
      const endVertex = starVertices[(segmentIndex + 1) % numSegments];

      const x = THREE.MathUtils.lerp(startVertex.x, endVertex.x, segmentProgress);
      const y = THREE.MathUtils.lerp(startVertex.y, endVertex.y, segmentProgress);
      const z = Math.sin((particleIndex / totalParticles) * Math.PI * 4) * (zDepth / 2);
      const jitterStrength = 0.2;

      return new THREE.Vector3(
        x * scale + (Math.random() - 0.5) * jitterStrength,
        y * scale + (Math.random() - 0.5) * jitterStrength,
        z + (Math.random() - 0.5) * jitterStrength * 0.5
      );
    }

    function getAttributesForParticle(i: number, palette: THREE.Color[]) {
      const t = i / particleCount;
      const colorProgress = (t * palette.length * 1.5 + time * 0.05) % palette.length;
      const colorIndex1 = Math.floor(colorProgress);
      const colorIndex2 = (colorIndex1 + 1) % palette.length;
      const blendFactor = colorProgress - colorIndex1;
      const color1 = palette[colorIndex1];
      const color2 = palette[colorIndex2];
      const baseColor = new THREE.Color().lerpColors(color1, color2, blendFactor);
      const color = baseColor.clone().multiplyScalar(0.65 + Math.random() * 0.55);
      const size = 0.65 + Math.random() * 0.6;
      return { color, size };
    }

    function createParticleTexture() {
      const canvas = document.createElement('canvas');
      const size = 64;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const centerX = size / 2;
      const centerY = size / 2;
      const outerRadius = size * 0.45;
      const innerRadius = size * 0.2;
      const numPoints = 5;

      ctx.beginPath();
      ctx.moveTo(centerX, centerY - outerRadius);
      for (let i = 0; i < numPoints; i++) {
        const outerAngle = (i / numPoints) * Math.PI * 2 - Math.PI / 2;
        ctx.lineTo(centerX + outerRadius * Math.cos(outerAngle), centerY + outerRadius * Math.sin(outerAngle));
        const innerAngle = outerAngle + Math.PI / numPoints;
        ctx.lineTo(centerX + innerRadius * Math.cos(innerAngle), centerY + innerRadius * Math.sin(innerAngle));
      }
      ctx.closePath();

      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, outerRadius);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.3, 'rgba(255,255,220,0.9)');
      gradient.addColorStop(0.6, 'rgba(255,200,150,0.6)');
      gradient.addColorStop(1, 'rgba(255,150,0,0)');
      ctx.fillStyle = gradient;
      ctx.fill();

      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      return tex;
    }

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      const pos = createStarPath(i, particleCount);
      positions[i3] = pos.x;
      positions[i3 + 1] = pos.y;
      positions[i3 + 2] = pos.z;
      targetPositions[i3] = pos.x;
      targetPositions[i3 + 1] = pos.y;
      targetPositions[i3 + 2] = pos.z;

      const { color, size } = getAttributesForParticle(i, themes[theme].colors);
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
      sizes[i] = size;

      const offsetStrength = 30 + Math.random() * 40;
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.acos(2 * Math.random() - 1);
      disintegrationOffsets[i3] = Math.sin(theta) * Math.cos(phi) * offsetStrength;
      disintegrationOffsets[i3 + 1] = Math.sin(theta) * Math.sin(phi) * offsetStrength;
      disintegrationOffsets[i3 + 2] = Math.cos(theta) * offsetStrength * 0.5;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('targetPosition', new THREE.BufferAttribute(targetPositions, 3));
    geometry.setAttribute('disintegrationOffset', new THREE.BufferAttribute(disintegrationOffsets, 3));

    const material = new THREE.PointsMaterial({
      size: 2.8,
      map: createParticleTexture(),
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      alphaTest: 0.01
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const applyBloomForTheme = (t: ThemeKey) => {
      const b = themes[t].bloom;
      bloomPass.strength = b.strength;
      bloomPass.radius = b.radius;
      bloomPass.threshold = b.threshold;
    };
    applyBloomForTheme(theme);

    let raf = 0;
    const tempRotatedTargets = new Float32Array(targetPositions.length);

    function triggerShockwave(opts: { amplitude?: number; speed?: number; width?: number; decay?: number } = {}) {
      const { amplitude = 12, speed = 28, width = 6, decay = 1.25 } = opts;
      shockwaves.push({ t0: time, amplitude, speed, width, decay });
      if (shockwaves.length > 6) shockwaves.shift();
    }

    const onResize = () => {
      if (!mountRef.current) return;
      width = mountRef.current.clientWidth;
      height = mountRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
    };
    window.addEventListener('resize', onResize);

    let chargeStart: number | null = null;

    (mountRef.current as any)._handlers = {
      pulse: () => triggerShockwave({ amplitude: 12, speed: 28, width: 6, decay: 1.25 }),
      chargeStart: () => {
        if (chargeStart === null) chargeStart = performance.now();
      },
      chargeEnd: () => {
        if (chargeStart === null) return;
        const heldMs = performance.now() - chargeStart;
        chargeStart = null;
        const heldSec = Math.min(heldMs / 1000, 2.0);
        const amplitude = 10 + heldSec * 15;
        const width = 5 + heldSec * 4;
        const speed = 28 + heldSec * 6;
        triggerShockwave({ amplitude, speed, width, decay: 1.35 });
      }
    };

    function animate() {
      raf = requestAnimationFrame(animate);
      // Pause heavy work when tab is hidden to save CPU and battery
      if (typeof document !== 'undefined' && document.hidden) return;
      time += 0.016;
      controls.update();

      if (isAnimating) {
        const pos = geometry.attributes.position.array as Float32Array;
        const tgt = geometry.attributes.targetPosition.array as Float32Array;
        const col = geometry.attributes.color.array as Float32Array;
        const sz = geometry.attributes.size.array as Float32Array;

        const palette = themes[theme].colors;

        const rotationSpeed = 0.0008;
        const cosRot = Math.cos(rotationSpeed);
        const sinRot = Math.sin(rotationSpeed);
        for (let i = 0; i < particleCount; i++) {
          const i3 = i * 3;
          const tx = tgt[i3];
          const ty = tgt[i3 + 1];
          tgt[i3] = tx * cosRot - ty * sinRot;
          tgt[i3 + 1] = tx * sinRot + ty * cosRot;
        }

        tempRotatedTargets.set(tgt);
        for (let i = 0; i < particleCount; i++) {
          const i3 = i * 3;
          const nextI3 = ((i + 1) % particleCount) * 3;
          const flowFactor = Math.sin(time * 0.4 + (i / particleCount) * Math.PI * 10) * 0.005;
          tgt[i3] += (tempRotatedTargets[nextI3] - tempRotatedTargets[i3]) * flowFactor;
          tgt[i3 + 1] += (tempRotatedTargets[nextI3 + 1] - tempRotatedTargets[i3 + 1]) * flowFactor;
          tgt[i3 + 2] += (tempRotatedTargets[nextI3 + 2] - tempRotatedTargets[i3 + 2]) * flowFactor;
        }

        for (let i = 0; i < particleCount; i++) {
          const i3 = i * 3;
          const homeX = tgt[i3];
          const homeY = tgt[i3 + 1];
          const homeZ = tgt[i3 + 2];

          const disintegrationCycleTime = 10.0;
          const particleCycleOffset = (i / particleCount) * disintegrationCycleTime * 0.5;
          const cycleProgress = ((time * 0.6 + particleCycleOffset) % disintegrationCycleTime) / disintegrationCycleTime;

          let disAmt = 0;
          const stableEnd = 0.5;
          const disStart = stableEnd;
          const disFull = stableEnd + 0.15;
          const holdEnd = disFull + 0.1;
          if (cycleProgress < stableEnd) disAmt = 0;
          else if (cycleProgress < disFull) disAmt = (cycleProgress - disStart) / (disFull - disStart);
          else if (cycleProgress < holdEnd) disAmt = 1.0;
          else disAmt = 1.0 - (cycleProgress - holdEnd) / (1.0 - holdEnd);
          disAmt = Math.sin(disAmt * Math.PI * 0.5);

          let addX = 0,
            addY = 0,
            addZ = 0;
          const dist = Math.sqrt(homeX * homeX + homeY * homeY + homeZ * homeZ) + 1e-6;
          for (let w = 0; w < shockwaves.length; w++) {
            const sw = shockwaves[w];
            const elapsed = Math.max(0, time - sw.t0);
            const R = sw.speed * elapsed;
            const sigma = sw.width;
            const decayFactor = Math.exp(-sw.decay * elapsed);
            const g = Math.exp(-((dist - R) * (dist - R)) / (2 * sigma * sigma));
            const amp = sw.amplitude * g * decayFactor;
            addX += (homeX / dist) * amp;
            addY += (homeY / dist) * amp;
            addZ += (homeZ / dist) * amp * 0.6;
          }

          let curTargetX = homeX + addX;
          let curTargetY = homeY + addY;
          let curTargetZ = homeZ + addZ;

          let lerp = 0.07;
          if (disAmt > 0.001) {
            curTargetX += disintegrationOffsets[i3] * disAmt;
            curTargetY += disintegrationOffsets[i3 + 1] * disAmt;
            curTargetZ += disintegrationOffsets[i3 + 2] * disAmt;
            lerp = 0.045 + disAmt * 0.02;
          }

          pos[i3] += (curTargetX - pos[i3]) * lerp;
          pos[i3 + 1] += (curTargetY - pos[i3 + 1]) * lerp;
          pos[i3 + 2] += (curTargetZ - pos[i3 + 2]) * lerp;

          const { color: baseColor, size } = getAttributesForParticle(i, palette);
          let bright = (0.65 + Math.sin((i / particleCount) * Math.PI * 7 + time * 1.3) * 0.35) * (1 - disAmt * 0.75);
          bright *= 0.85 + Math.sin(time * 7 + i * 0.5) * 0.15;

          col[i3] = baseColor.r * bright;
          col[i3 + 1] = baseColor.g * bright;
          col[i3 + 2] = baseColor.b * bright;

          let curSize = size * (1 - disAmt * 0.9);
          curSize *= 0.8 + Math.sin(time * 5 + i * 0.3) * 0.2;
          sz[i] = Math.max(0.05, curSize);
        }

        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.targetPosition.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
        geometry.attributes.size.needsUpdate = true;

        if (shockwaves.length) {
          shockwaves = shockwaves.filter(sw => {
            const elapsed = time - sw.t0;
            const R = sw.speed * elapsed;
            const expiredByRadius = R - MAX_HOME_RADIUS > 6 * sw.width;
            const expiredByTime = elapsed > 12;
            return !(expiredByRadius || expiredByTime);
          });
        }
      }

      composer.render();
    }

    raf = requestAnimationFrame(animate);

    const updateTheme = () => {
      applyBloomForTheme(theme);
      const col = geometry.attributes.color.array as Float32Array;
      const sz = geometry.attributes.size.array as Float32Array;
      for (let i = 0; i < particleCount; i++) {
        const { color, size } = getAttributesForParticle(i, themes[theme].colors);
        col[i * 3] = color.r;
        col[i * 3 + 1] = color.g;
        col[i * 3 + 2] = color.b;
        sz[i] = size;
      }
      geometry.attributes.color.needsUpdate = true;
      geometry.attributes.size.needsUpdate = true;
    };
    updateTheme();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      geometry.dispose();
      (material.map as THREE.Texture)?.dispose();
      material.dispose();
      composer.dispose();
      renderer.dispose();
      scene.clear();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, [theme, isAnimating]);

  const call = (name: 'pulse' | 'chargeStart' | 'chargeEnd') => {
    const handlers = (mountRef.current as any)?._handlers;
    if (handlers && typeof handlers[name] === 'function') handlers[name]();
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-black text-white">
      <div ref={glowRef} className="glow pointer-events-none fixed inset-0 opacity-75 mix-blend-screen" />

      <div ref={mountRef} className="absolute inset-0" />

      {/* Internal controls hidden; driven externally via window events */}

      <style>{`
        * {
          box-sizing: border-box;
        }
        body {
          transition: background 1.5s ease;
        }
        body.theme-molten {
          background: linear-gradient(180deg, #000000 0%, #100500 50%, #1f0a00 100%);
        }
        body.theme-cosmic {
          background: linear-gradient(180deg, #000000 0%, #050010 50%, #0a001f 100%);
        }
        body.theme-emerald {
          background: linear-gradient(180deg, #000000 0%, #001005 50%, #001f0a 100%);
        }
        body.theme-molten .glow {
          background: radial-gradient(
            circle at 50% 50%,
            rgba(255, 100, 0, 0.05) 0%,
            rgba(200, 50, 0, 0.05) 50%,
            transparent 65%
          );
        }
        body.theme-cosmic .glow {
          background: radial-gradient(
            circle at 50% 50%,
            rgba(147, 112, 219, 0.05) 0%,
            rgba(75, 0, 130, 0.05) 50%,
            transparent 65%
          );
        }
        body.theme-emerald .glow {
          background: radial-gradient(
            circle at 50% 50%,
            rgba(0, 255, 127, 0.05) 0%,
            rgba(46, 139, 87, 0.05) 50%,
            transparent 65%
          );
        }
        .ui-panel {
          box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
          transition: background 1.5s ease, border-color 1.5s ease;
        }
        body.theme-molten .ui-panel {
          background: rgba(50, 20, 10, 0.3);
          border-color: rgba(255, 120, 50, 0.4);
        }
        body.theme-cosmic .ui-panel {
          background: rgba(40, 20, 60, 0.3);
          border-color: rgba(147, 112, 219, 0.4);
        }
        body.theme-emerald .ui-panel {
          background: rgba(20, 60, 40, 0.3);
          border-color: rgba(60, 179, 113, 0.4);
        }
        .theme-btn {
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.1);
          transition: background 0.3s, border-color 0.3s, color 0.3s, transform 0.08s ease;
        }
        .theme-btn.active {
          color: #fff;
          font-weight: 500;
        }
        body.theme-molten .theme-btn.active {
          background: rgba(255, 100, 0, 0.5);
          border-color: rgba(255, 100, 0, 0.7);
        }
        body.theme-cosmic .theme-btn.active {
          background: rgba(147, 112, 219, 0.5);
          border-color: rgba(147, 112, 219, 0.7);
        }
        body.theme-emerald .theme-btn.active {
          background: rgba(60, 179, 113, 0.5);
          border-color: rgba(60, 179, 113, 0.7);
        }
        .toggle-slider {
          background: rgba(255, 255, 255, 0.2);
        }
        body.theme-molten .toggle-slider {
          background: rgba(180, 80, 40, 0.4);
        }
        body.theme-cosmic .toggle-slider {
          background: rgba(147, 112, 219, 0.4);
        }
        body.theme-emerald .toggle-slider {
          background: rgba(60, 179, 113, 0.4);
        }
        .toggle-slider::before {
          content: '';
          position: absolute;
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background: white;
          border-radius: 9999px;
          transition: transform 0.3s;
        }
        input#animateToggle:checked + .toggle-slider::before {
          transform: translateX(22px);
        }
        body.theme-molten input#animateToggle:checked + .toggle-slider {
          background-color: rgba(255, 100, 0, 0.6);
        }
        body.theme-cosmic input#animateToggle:checked + .toggle-slider {
          background-color: rgba(147, 112, 219, 0.6);
        }
        body.theme-emerald input#animateToggle:checked + .toggle-slider {
          background-color: rgba(60, 179, 113, 0.6);
        }
        body.theme-molten .toggle-slider::before {
          box-shadow: 0 0 8px rgba(255, 150, 50, 0.8);
        }
        body.theme-cosmic .toggle-slider::before {
          box-shadow: 0 0 8px rgba(170, 130, 230, 0.8);
        }
        body.theme-emerald .toggle-slider::before {
          box-shadow: 0 0 8px rgba(100, 200, 150, 0.8);
        }
      `}</style>
    </div>
  );
}

export { StarShockwaves };

