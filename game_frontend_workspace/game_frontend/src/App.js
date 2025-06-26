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

    // Minecraft-style blocky world parameters
    const CHUNK_SIZE = 16;
    const WORLD_SIZE = 3; // 3x3 "chunks" loaded

    // Utility: Generate "blocky" ground using perlin-like noise (simple heights)
    function generateChunk(chunkX, chunkZ) {
      const group = new THREE.Group();
      const blockSize = 3;
      for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          // Simple noise: deterministic "height"
          const absX = chunkX * CHUNK_SIZE + x;
          const absZ = chunkZ * CHUNK_SIZE + z;
          // Toy height: sand/grass/dirt hills
          const height =
            Math.floor(
              2 +
                Math.abs(
                  Math.sin((absX) * 0.23) +
                  Math.cos((absZ) * 0.17) +
                  Math.sin((absX + absZ) * 0.13)
                ) * 3
            );

          for (let y = 0; y <= height; y++) {
            let color =
              y === 0
                ? 0x888888 // stone
                : y === height
                ? 0x228B22 // grass
                : 0xd2b48c; // sand/dirt
            const geometry = new THREE.BoxGeometry(blockSize, blockSize, blockSize);
            const material = new THREE.MeshLambertMaterial({ color });
            const cube = new THREE.Mesh(geometry, material);
            cube.position.set(
              (absX - (WORLD_SIZE * CHUNK_SIZE) / 2) * blockSize,
              y * blockSize - 24,
              (absZ - (WORLD_SIZE * CHUNK_SIZE) / 2) * blockSize
            );
            group.add(cube);
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

      // Minecraft-style light, sun and ambient
      scene.add(new THREE.AmbientLight(0xffffff, 0.80));
      const sun = new THREE.DirectionalLight(0xffe094, 1.0);
      sun.position.set(-230, 340, 200);
      scene.add(sun);

      // WORLD: create a few chunks
      for (let cx = 0; cx < WORLD_SIZE; cx++) {
        for (let cz = 0; cz < WORLD_SIZE; cz++) {
          const chunk = generateChunk(cx, cz);
          scene.add(chunk);
          worldChunks.push(chunk);
        }
      }

      // Airplane model: blocky, but semi-aerodynamic
      airplanePivot = new THREE.Group();
      airplane = createBlockyAirplane(THREE);
      airplanePivot.add(airplane);
      // Start above world
      airplanePivot.position.set(0, 28, 0);
      airplanePivot.rotation.order = "YXZ";
      scene.add(airplanePivot);

      // "Clouds"
      for (let i = 0; i < 13; i++) {
        const mesh = createCloud(
          THREE,
          -180 + Math.random() * 400,
          90 + Math.random() * 40,
          -200 + Math.random() * 400
        );
        scene.add(mesh);
      }

      // Camera setup
      updateCamera();

      // Listen for resizing
      window.addEventListener('resize', handleResize, false);

      // Keyboard input
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
