import React, { useRef, useEffect, useState } from 'react';
import './App.css';

// PUBLIC_INTERFACE
/**
 * Main App component for Skycraft Pilot - 3D Airplane Game
 * - 3D Minecraft-style world and airplane rendered with Three.js
 * - Third-person camera, smooth following, arrow keys to control airplane
 * - Minimal HUD at corners, full-screen canvas
 */
function App() {
  const mountRef = useRef();
  const [instructionsVisible, setInstructionsVisible] = useState(true);

  useEffect(() => {
    let THREE;
    let renderer, scene, camera, animationId;
    let keyState = {};
    let airplane, airplanePivot;
    let clock;
    let worldChunks = [];
    const PLANE_SPEED = 0.18;        // Forward units per frame
    const TURN_RATE = 0.018;         // How quickly the airplane turns (yaw)
    const PITCH_RATE = 0.013;        // Pitch change
    const ROLL_RATE = 0.022;         // How quickly the airplane rolls

    // Minecraft-style world expansion parameters (LARGER!)
    const CHUNK_SIZE = 18; // Was 16, now larger
    const WORLD_SIZE = 8; // Was 3, now 8x8 = 64 chunks for a vast world

    // Block size - increase for chunkier look, decrease for finer
    const BLOCK_SIZE = 3;

    // Utility: Generate "blocky" ground using simple noise (heightmap)
    // Collect block top positions for object placement
    function generateChunk(chunkX, chunkZ, groundHeights) {
      const group = new THREE.Group();
      for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          // Absolute world coords
          const absX = chunkX * CHUNK_SIZE + x;
          const absZ = chunkZ * CHUNK_SIZE + z;
          // Height: wavy hills (pseudo-noise)
          const height =
            Math.floor(
              2 +
                Math.abs(
                  Math.sin(absX * 0.22) +
                  Math.cos(absZ * 0.19) +
                  0.42 * Math.sin((absX + absZ) * 0.11)
                ) * 3.3
            );
          // Record for object-plopping on surface
          if (groundHeights) {
            groundHeights[`${absX},${absZ}`] = height;
          }

          // Add stacked cubes bottom-up for terrain
          for (let y = 0; y <= height; y++) {
            let color =
              y === 0
                ? 0x888888 // stone
                : y === height
                ? 0x44ac39 // grass (brighter)
                : 0xd7bb86; // sand/dirt
            const geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
            const material = new THREE.MeshLambertMaterial({ color });
            const cube = new THREE.Mesh(geometry, material);
            cube.castShadow = false;
            cube.receiveShadow = true;
            cube.position.set(
              (absX - (WORLD_SIZE * CHUNK_SIZE) / 2) * BLOCK_SIZE,
              y * BLOCK_SIZE - 28,
              (absZ - (WORLD_SIZE * CHUNK_SIZE) / 2) * BLOCK_SIZE
            );
            group.add(cube);
          }
        }
      }
      return group;
    }

    // Generate a simple voxel tree (trunk and leaves)
    function createVoxelTree(THREE, pos) {
      const group = new THREE.Group();

      // Trunk: 2 cubes
      const trunkHeight = 2 + Math.floor(Math.random() * 2); // 2-3 cubes
      for (let y = 0; y < trunkHeight; y++) {
        const trunkGeo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
        const trunkMat = new THREE.MeshLambertMaterial({ color: 0xa57949 });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(pos.x, pos.y + y * BLOCK_SIZE, pos.z);
        group.add(trunk);
      }

      // Leaves: 2~3 stacked cubes (varied, offset a bit)
      const leafHeight = 2 + Math.floor(Math.random() * 2);
      for (let y = 0; y < leafHeight; y++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            // Simple sphere-like shape, thinner at top
            if (Math.abs(dx) + Math.abs(dz) + y < 4) {
              const leafGeo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
              const leafMat = new THREE.MeshLambertMaterial({ color: 0x229944 });
              const leaf = new THREE.Mesh(leafGeo, leafMat);
              leaf.position.set(
                pos.x + dx * BLOCK_SIZE,
                pos.y + trunkHeight * BLOCK_SIZE + y * BLOCK_SIZE,
                pos.z + dz * BLOCK_SIZE
              );
              group.add(leaf);
            }
          }
        }
      }
      return group;
    }

    // Generate a simple blocky building (cube/rectangular, occasional windows/roof)
    function createVoxelBuilding(THREE, pos, maxFloors = 2 + Math.floor(Math.random()*3)) {
      const group = new THREE.Group();
      const width = (2 + Math.floor(Math.random() * 3)) * BLOCK_SIZE;
      const depth = (2 + Math.floor(Math.random() * 2)) * BLOCK_SIZE;
      const height = maxFloors * BLOCK_SIZE;

      // Main walls: bright color
      const wallColors = [0xe67e22, 0xfad02e, 0x4771b2, 0x34db6d, 0xdc5e65];
      const wallMat = new THREE.MeshLambertMaterial({ color: wallColors[Math.floor(Math.random()*wallColors.length)] });

      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        wallMat
      );
      wall.position.set(pos.x, pos.y + height / 2, pos.z);
      group.add(wall);

      // Simple "roof" slab (slightly larger)
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(width + BLOCK_SIZE * 0.35, BLOCK_SIZE * 0.85, depth + BLOCK_SIZE * 0.35),
        roofMat
      );
      roof.position.set(pos.x, pos.y + height + (BLOCK_SIZE * 0.425), pos.z);
      group.add(roof);

      // Windows (optional, as white cubes; only on front/back)
      if (Math.random() > 0.3) {
        for (let floor = 1; floor < maxFloors; floor++) {
          const winHeight = pos.y + floor * BLOCK_SIZE + BLOCK_SIZE/3;
          for (let i = -1; i <= 1; i++) {
            if (Math.random() > 0.6) continue;
            // Front face
            const winF = new THREE.Mesh(
              new THREE.BoxGeometry(BLOCK_SIZE * 0.6, BLOCK_SIZE * 0.7, BLOCK_SIZE * 0.2),
              new THREE.MeshLambertMaterial({ color: 0xeaf4fd, transparent: true, opacity: 0.77 })
            );
            winF.position.set(pos.x + i * BLOCK_SIZE, winHeight, pos.z + depth/2 + 0.54);
            group.add(winF);

            // Back face
            const winB = new THREE.Mesh(
              new THREE.BoxGeometry(BLOCK_SIZE * 0.6, BLOCK_SIZE * 0.7, BLOCK_SIZE * 0.2),
              new THREE.MeshLambertMaterial({ color: 0xeaf4fd, transparent: true, opacity: 0.77 })
            );
            winB.position.set(pos.x + i * BLOCK_SIZE, winHeight, pos.z - depth/2 - 0.54);
            group.add(winB);
          }
        }
      }
      return group;
    }

    async function init() {
      THREE = await import('three');

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setClearColor(0xe9f7fc);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio);

      mountRef.current.appendChild(renderer.domElement);

      // Scene and Camera
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(
        72,
        window.innerWidth / window.innerHeight,
        0.1,
        5000
      );

      // Minecraft-style light (ambient & sun)
      scene.add(new THREE.AmbientLight(0xffffff, 0.82));
      const sun = new THREE.DirectionalLight(0xffe094, 1.04);
      sun.position.set(-320, 340, 420);
      scene.add(sun);

      // --- WORLD BUILDING ---
      // Generate block heights for later tree/building placement
      let groundHeights = {};

      // Chunks: much larger grid
      for (let cx = 0; cx < WORLD_SIZE; cx++) {
        for (let cz = 0; cz < WORLD_SIZE; cz++) {
          const chunk = generateChunk(cx, cz, groundHeights);
          scene.add(chunk);
          worldChunks.push(chunk);
        }
      }

      // --- Populate VOXEL TREES efficiently ---
      // Reduce tree count to around 40 for cleaner rendering
      const totalTrees = 36 + Math.round(Math.random() * 8); // Between 36 and 44 trees
      const possiblePlacements = Object.keys(groundHeights);

      // Use a Set to prevent duplicate placements
      const usedPositions = new Set();
      let attempts = 0;
      let created = 0;
      while (created < totalTrees && attempts < totalTrees * 8) {
        let k, px, pz;
        let tryCount = 0;
        do {
          k = possiblePlacements[Math.floor(Math.random() * possiblePlacements.length)];
          [px, pz] = k.split(",").map(Number);
          tryCount++;
        } while (
          (Math.abs(px - (WORLD_SIZE * CHUNK_SIZE)/2) < 15 &&
           Math.abs(pz - (WORLD_SIZE * CHUNK_SIZE)/2) < 15
          ) && tryCount < 15
        );

        // Avoid duplicate placement
        if (usedPositions.has(k)) {
          attempts++;
          continue;
        }
        usedPositions.add(k);

        const height = groundHeights[k];
        // Jitter coordinates for more natural placement
        const wx = (px - (WORLD_SIZE * CHUNK_SIZE)/2) * BLOCK_SIZE + (Math.random()-0.5)*BLOCK_SIZE*0.7;
        const wy = height * BLOCK_SIZE - 28 + 0.01;
        const wz = (pz - (WORLD_SIZE * CHUNK_SIZE)/2) * BLOCK_SIZE + (Math.random()-0.5)*BLOCK_SIZE*0.7;
        const treeObj = createVoxelTree(THREE, {x: wx, y: wy, z: wz});
        scene.add(treeObj);
        created++;
        attempts++;
      }

      // --- Place Buildings (sparser) ---
      const totalBuildings = 12 + Math.floor(Math.random() * 6);
      for (let i = 0; i < totalBuildings; i++) {
        // Farther apart from origin (so player can "find" them)
        let k, px, pz, attempts = 0;
        do {
          k = possiblePlacements[Math.floor(Math.random() * possiblePlacements.length)];
          [px, pz] = k.split(',').map(Number);
          attempts++;
        } while (
          Math.abs(px - (WORLD_SIZE * CHUNK_SIZE)/2) < 20 &&
          Math.abs(pz - (WORLD_SIZE * CHUNK_SIZE)/2) < 20 &&
          attempts < 30
        );
        const height = groundHeights[k];
        // Slight jitter for not-perfect rectangles
        const wx = (px - (WORLD_SIZE * CHUNK_SIZE)/2) * BLOCK_SIZE + (Math.random()-0.5)*BLOCK_SIZE*0.8;
        const wy = height * BLOCK_SIZE - 28 + 0.01;
        const wz = (pz - (WORLD_SIZE * CHUNK_SIZE)/2) * BLOCK_SIZE + (Math.random()-0.5)*BLOCK_SIZE*0.8;
        const bldg = createVoxelBuilding(THREE, {x: wx, y: wy, z: wz});
        scene.add(bldg);
      }

      // --- Airplane model: blocky, but semi-aerodynamic ---
      airplanePivot = new THREE.Group();
      airplane = createBlockyAirplane(THREE);
      airplanePivot.add(airplane);
      // Start above world, in middle-ish
      airplanePivot.position.set(0, 36, 0);
      airplanePivot.rotation.order = "YXZ";
      scene.add(airplanePivot);

      // --- Clouds ---
      for (let i = 0; i < 18; i++) {
        const mesh = createCloud(
          THREE,
          -420 + Math.random() * 900,
          90 + Math.random() * 110,
          -420 + Math.random() * 900
        );
        scene.add(mesh);
      }

      // Camera setup
      updateCamera();

      // Listen for resizing
      window.addEventListener('resize', handleResize, false);
      window.addEventListener('keydown', onKeyDown, false);
      window.addEventListener('keyup', onKeyUp, false);

      // Main loop
      clock = new THREE.Clock();
      animate();
    }

    function createBlockyAirplane(THREE) {
      // Fuselage
      const group = new THREE.Group();

      const materialBody = new THREE.MeshLambertMaterial({ color: 0x3287c2 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(7, 2, 2), materialBody);
      group.add(body);

      // Cockpit
      const cockpit = new THREE.Mesh(
        new THREE.BoxGeometry(2, 1.15, 2),
        new THREE.MeshLambertMaterial({ color: 0xd8ecfe })
      );
      cockpit.position.set(3.4, 0.61, 0);
      group.add(cockpit);

      // Wings
      const wingGeometry = new THREE.BoxGeometry(3, 0.4, 13);
      const wingMaterial = new THREE.MeshLambertMaterial({ color: 0xf3d75b });
      const wings = new THREE.Mesh(wingGeometry, wingMaterial);
      wings.position.set(-0.3, -0.25, 0);
      group.add(wings);

      // Tail
      const tail = new THREE.Mesh(
        new THREE.BoxGeometry(2.3, 0.4, 2.2),
        new THREE.MeshLambertMaterial({ color: 0xe67e22 })
      );
      tail.position.set(-3.4, 0.45, 0);
      group.add(tail);

      // Vertical Stabilizer
      const vertTail = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 1.45, 0.4),
        new THREE.MeshLambertMaterial({ color: 0xf8a04b })
      );
      vertTail.position.set(-4.1, 1.02, 0);
      group.add(vertTail);

      // Propeller (simple slab)
      const prop = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.4, 2.1),
        new THREE.MeshLambertMaterial({ color: 0x303030 })
      );
      prop.position.set(4.5, 0, 0);
      group.add(prop);

      return group;
    }

    function createCloud(THREE, x, y, z) {
      const group = new THREE.Group();
      for (let i = 0; i < 3 + Math.random() * 4; i++) {
        const geo = new THREE.SphereGeometry(5.7 + Math.random() * 2.4, 10, 8);
        const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.93 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(
          x + (Math.random() - 0.5) * 14,
          y + (Math.random() - 0.5) * 7,
          z + (Math.random() - 0.5) * 14
        );
        group.add(mesh);
      }
      return group;
    }

    // Camera chase: behind and above airplane, smooth following
    function updateCamera() {
      // Airplane local forward direction
      const forward = new THREE.Vector3(1, 0.02, 0);
      forward.applyQuaternion(airplanePivot.quaternion);

      // Offset: behind + above airplane
      const cameraOffset = new THREE.Vector3(-18, 9, 0);
      cameraOffset.applyQuaternion(airplanePivot.quaternion);
      const pos = airplanePivot.position.clone().add(cameraOffset);

      // Smooth lerp to camera position for smooth camera
      camera.position.lerp(pos, 0.13);
      // Look ahead for cinematic, but still focused on airplane
      const lookTarget = airplanePivot.position.clone().add(forward.multiplyScalar(7));
      camera.lookAt(lookTarget);
    }

    function handleResize() {
      if (!renderer || !camera) return;
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    }

    function onKeyDown(e) {
      keyState[e.code] = true;
      if (e.code === 'Space') {
        setInstructionsVisible(false);
      }
    }
    function onKeyUp(e) {
      keyState[e.code] = false;
    }

    // Airplane controls: Arrow keys
    function airplaneControls(dt) {
      if (!airplanePivot) return;
      // Pitch: Up/Down
      if (keyState['ArrowUp']) {
        airplanePivot.rotation.z += ROLL_RATE * dt * 48; // Subtle right roll (banking in 3D)
        airplanePivot.rotation.x += PITCH_RATE * dt * 48;
      }
      if (keyState['ArrowDown']) {
        airplanePivot.rotation.z -= ROLL_RATE * dt * 45;
        airplanePivot.rotation.x -= PITCH_RATE * dt * 48;
      }
      // Bank: Left/Right
      if (keyState['ArrowLeft']) {
        airplanePivot.rotation.y += TURN_RATE * dt * 37; // Yaw left
        airplanePivot.rotation.z += ROLL_RATE * dt * 75;
      }
      if (keyState['ArrowRight']) {
        airplanePivot.rotation.y -= TURN_RATE * dt * 37; // Yaw right
        airplanePivot.rotation.z -= ROLL_RATE * dt * 75;
      }

      // Level roll automatically (dampening)
      airplanePivot.rotation.z = airplanePivot.rotation.z * 0.97;

      // Prevent flipping over (clamp pitch)
      airplanePivot.rotation.x = Math.max(
        Math.min(airplanePivot.rotation.x, Math.PI / 4),
        -Math.PI / 4
      );
    }

    function animate() {
      const dt = clock.getDelta();
      airplaneControls(dt);

      // Move airplane forward in facing direction
      const move = new THREE.Vector3(1, 0, 0); // local forward (X+)
      move.applyEuler(airplanePivot.rotation);
      airplanePivot.position.addScaledVector(move, PLANE_SPEED * (1 + dt * 16));

      updateCamera();

      renderer.render(scene, camera);
      animationId = requestAnimationFrame(animate);
    }

    // Initialize everything
    init();

    return () => {
      // Cleanup
      if (renderer) {
        cancelAnimationFrame(animationId);
        renderer.dispose();
        if (renderer.domElement && mountRef.current) {
          mountRef.current.removeChild(renderer.domElement);
        }
      }
      window.removeEventListener('resize', handleResize, false);
      window.removeEventListener('keydown', onKeyDown, false);
      window.removeEventListener('keyup', onKeyUp, false);
      // Three.js objects: dispose to avoid memory leaks
    };
    // eslint-disable-next-line
  }, []);

  // Minimal HUD (info bottom left; logo top left)
  // Instructions overlay (corner or center) when user hasn't touched controls
  return (
    <div className="App" style={{ overflow: 'hidden', margin: 0, padding: 0 }}>
      <div ref={mountRef} style={{
        width: '100vw',
        height: '100vh',
        position: 'fixed',
        inset: 0,
        zIndex: 1,
        background: "var(--bg-primary)"
      }}
      />
      {/* Logo or game title top left */}
      <div style={{
        position: 'fixed',
        top: 16,
        left: 24,
        zIndex: 10,
        background: 'rgba(255,255,255,0.73)',
        color: '#1A4168',
        borderRadius: 12,
        padding: '10px 18px',
        fontWeight: 800,
        fontSize: 21,
        letterSpacing: '1px',
        boxShadow: '0 2px 12px #e6eff6b0'
      }}>
        ✈️ Skycraft Pilot
      </div>
      {/* Minimal HUD: Controls info bottom-left */}
      <div style={{
        position: 'fixed',
        left: 30,
        bottom: 26,
        zIndex: 12,
        background: 'rgba(255,255,255,0.84)',
        color: '#16416d',
        borderRadius: 8,
        padding: '9px 13px',
        fontSize: 15,
        fontWeight: 500,
        boxShadow: '0 0 12px #d2e6ff50'
      }}>
        Controls: <span style={{ letterSpacing: '1px' }}>↑↓</span> pitch &nbsp;
        / <span style={{ letterSpacing: '1px' }}>←→</span> bank &amp; turn
      </div>
      {/* Minimal HUD: Settings/instructions top right */}
      <div style={{
        position: 'fixed',
        top: 17,
        right: 18,
        zIndex: 12,
        background: 'rgba(255,255,255,0.69)',
        color: '#294064',
        borderRadius: 8,
        padding: '8px 18px',
        fontSize: 15,
        fontWeight: 500,
        letterSpacing: '0.4px',
        boxShadow: '0 0 11px #dbefff35'
      }}>
        Third Person &nbsp;| &nbsp; <span style={{ opacity: 0.6 }}>Light UI</span>
      </div>
      {/* Instructions overlay */}
      {instructionsVisible && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            zIndex: 99,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(255,255,255,0.82)'
          }}
          tabIndex={0}
          onClick={() => setInstructionsVisible(false)}
          onKeyDown={() => setInstructionsVisible(false)}
          role="dialog"
          aria-modal="true"
        >
          <div style={{
            background: 'white',
            color: '#16416d',
            fontWeight: 600,
            padding: '44px 38px',
            borderRadius: 20,
            fontSize: 24,
            boxShadow: '0 8px 32px #d2e6ff80, 0 1px #bbb'
          }}>
            Pilot your <span style={{color: "#2ecc71"}}>airplane</span>!<br/><br/>
            <div style={{fontSize: 19, marginBottom: 11}}>
              <span style={{background: "#ebf5ff", borderRadius: '7px', padding: "4px 11px"}}>
                <span role="img" aria-label="keyboard">⌨️</span>
                &nbsp;Arrow keys to fly <span style={{letterSpacing: "0.5px"}}>(↑↓ pitch, ←→ bank/turn)</span>
              </span>
            </div>
            <div style={{fontSize: 17, color: "#1A7DCB"}}>
              Explore the blocky sky world!<br/>
              <span style={{fontSize: 14, color: "#666"}}>
                (Click or press <b>SPACE</b> to start)
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export default App;
