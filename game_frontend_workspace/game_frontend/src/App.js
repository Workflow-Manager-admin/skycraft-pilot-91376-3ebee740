import React, { useRef, useEffect, useState } from 'react';
import './App.css';

/**
 * Main App component for Skycraft Pilot - 3D Airplane Game
 * Optimized for high rendering performance using batching, instancing, and frustum culling.
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
    let treeInstances, buildingInstances;
    let treeInstanceBaseGroup, buildingInstanceBaseGroup;
    let lastVisibleRange = {};
    let cloudGroups = [];
    const PLANE_SPEED = 0.18;
    const TURN_RATE = 0.018;
    const PITCH_RATE = 0.013;
    const ROLL_RATE = 0.022;

    // ---- Performance/Optimization adjustments ----
    // Reduce world size by about 50% if needed:
    // Old: CHUNK_SIZE = 18, WORLD_SIZE = 8   (big), New: CHUNK_SIZE = 16, WORLD_SIZE = 4
    const CHUNK_SIZE = 12; // Reduce chunk size for less geometry
    const WORLD_SIZE = 4;  // Only 4x4 chunks (was 8x8)
    const BLOCK_SIZE = 3;
    // Only draw terrain/objects near player (basic frustum culling cutoff)
    const RENDER_DIST_BLOCKS = CHUNK_SIZE * 2.1 * BLOCK_SIZE;


    // ---- BATCHED TERRAIN with InstancedMeshes ----
    function generateInstancedChunk(chunkX, chunkZ, groundHeights, batchMaterials) {
      // Batch (stone, dirt/sand, grass) blocks per material
      let blockIndex = 0;
      // Buffers: 0 - stone, 1 - dirt/sand, 2 - grass
      const blockCounts = [0, 0, 0];
      const totalBlocks = CHUNK_SIZE * CHUNK_SIZE * 8; // upper bound (over-alloc, trimmed later)

      // Buffers for transform matrices
      const matrices = [[], [], []];

      for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          const absX = chunkX * CHUNK_SIZE + x;
          const absZ = chunkZ * CHUNK_SIZE + z;
          const height =
            Math.floor(
              2 +
                Math.abs(
                  Math.sin(absX * 0.22) +
                  Math.cos(absZ * 0.19) +
                  0.42 * Math.sin((absX + absZ) * 0.11)
                ) * 3.3
            );
          if (groundHeights) groundHeights[`${absX},${absZ}`] = height;

          for (let y = 0; y <= height; y++) {
            let type;
            if (y === 0) type = 0;         // stone
            else if (y === height) type = 2; // grass
            else type = 1;                 // dirt/sand
            const matrix = new THREE.Matrix4();
            matrix.makeTranslation(
              (absX - (WORLD_SIZE * CHUNK_SIZE) / 2) * BLOCK_SIZE,
              y * BLOCK_SIZE - 28,
              (absZ - (WORLD_SIZE * CHUNK_SIZE) / 2) * BLOCK_SIZE
            );
            matrices[type].push(matrix);
            blockCounts[type]++;
          }
        }
      }
      // For each type, create InstancedMesh if count > 0
      const GEO = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
      const group = new THREE.Group();
      for (let t = 0; t < 3; t++) {
        if (blockCounts[t] === 0) continue;
        const inst = new THREE.InstancedMesh(GEO, batchMaterials[t], blockCounts[t]);
        for (let i = 0; i < blockCounts[t]; i++) inst.setMatrixAt(i, matrices[t][i]);
        inst.castShadow = false;
        inst.receiveShadow = true;
        group.add(inst);
      }
      return group;
    }

    // ---- Instanced Trees (batched) ----
    // Instead of many meshes, use instancing for trees
    let TREE_TRUNK, TREE_LEAF;
    let treeTrunkMat, treeLeafMat;
    let treeInstancedTrunk, treeInstancedLeaf;
    let treePositions = [];

    function makeTreeBaseGeometries() {
      // Trunk block, leaf block
      TREE_TRUNK = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
      treeTrunkMat = new THREE.MeshLambertMaterial({ color: 0xa57949 });
      TREE_LEAF = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
      treeLeafMat = new THREE.MeshLambertMaterial({ color: 0x229944 });
    }
    // Place N trees, storing the needed trunk/leaf matrices for instancing
    function createInstancedTrees(THREE, groundHeights, scene, N) {
      makeTreeBaseGeometries();
      treePositions = [];
      const possiblePlacements = Object.keys(groundHeights);
      const usedPositions = new Set();
      let attempts = 0, created = 0;
      // Matrices for all trunks, all leaves
      const trunkMatrices = [], leafMatrices = [];
      while (created < N && attempts < N * 9) {
        let k, px, pz, tryCount = 0;
        do {
          k = possiblePlacements[Math.floor(Math.random() * possiblePlacements.length)];
          [px, pz] = k.split(",").map(Number);
          tryCount++;
        } while (
          (Math.abs(px - (WORLD_SIZE * CHUNK_SIZE)/2) < 6 &&
           Math.abs(pz - (WORLD_SIZE * CHUNK_SIZE)/2) < 6
          ) && tryCount < 10
        );
        if (usedPositions.has(k)) { attempts++; continue; }
        usedPositions.add(k);
        const height = groundHeights[k];
        const wx = (px - (WORLD_SIZE * CHUNK_SIZE)/2) * BLOCK_SIZE + (Math.random()-0.5)*BLOCK_SIZE*0.6;
        const wy = height * BLOCK_SIZE - 28 + 0.01;
        const wz = (pz - (WORLD_SIZE * CHUNK_SIZE)/2) * BLOCK_SIZE + (Math.random()-0.5)*BLOCK_SIZE*0.6;
        // Trunk
        const trunkHeight = 2 + Math.floor(Math.random() * 2); // 2-3 blocks high
        for (let y = 0; y < trunkHeight; y++) {
          const tmat = new THREE.Matrix4();
          tmat.makeTranslation(wx, wy + y * BLOCK_SIZE, wz);
          trunkMatrices.push(tmat);
        }
        // Leaves: 2-3 stacked, simple dome
        const leafHeight = 2 + Math.floor(Math.random() * 2);
        for (let y = 0; y < leafHeight; y++)
          for (let dx = -1; dx <= 1; dx++)
            for (let dz = -1; dz <= 1; dz++)
              if (Math.abs(dx) + Math.abs(dz) + y < 4) {
                const lmat = new THREE.Matrix4();
                lmat.makeTranslation(
                  wx + dx * BLOCK_SIZE,
                  wy + trunkHeight * BLOCK_SIZE + y * BLOCK_SIZE,
                  wz + dz * BLOCK_SIZE
                );
                leafMatrices.push(lmat);
              }
        created++; attempts++;
        treePositions.push({wx, wy, wz, trunkHeight, leafHeight});
      }
      // Instanced trunk mesh
      treeInstancedTrunk = new THREE.InstancedMesh(TREE_TRUNK, treeTrunkMat, trunkMatrices.length);
      for (let i = 0; i < trunkMatrices.length; i++) treeInstancedTrunk.setMatrixAt(i, trunkMatrices[i]);
      treeInstancedLeaf = new THREE.InstancedMesh(TREE_LEAF, treeLeafMat, leafMatrices.length);
      for (let i = 0; i < leafMatrices.length; i++) treeInstancedLeaf.setMatrixAt(i, leafMatrices[i]);
      scene.add(treeInstancedTrunk);
      scene.add(treeInstancedLeaf);
    }

    // ---- Instanced Buildings (batched and simplified) ----
    let BLDG_BOX, bldgMats = [], bldgRoofMat, BLDG_ROOF;
    let bldgInstancedBox, bldgInstancedRoof;
    function makeBuildingBaseGeometries() {
      BLDG_BOX = new THREE.BoxGeometry(BLOCK_SIZE*3, BLOCK_SIZE*3, BLOCK_SIZE*4);
      bldgMats = [
        new THREE.MeshLambertMaterial({ color: 0xe67e22 }),
        new THREE.MeshLambertMaterial({ color: 0xfad02e }),
        new THREE.MeshLambertMaterial({ color: 0x4771b2 }),
        new THREE.MeshLambertMaterial({ color: 0x34db6d }),
        new THREE.MeshLambertMaterial({ color: 0xdc5e65 })
      ];
      bldgRoofMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
      BLDG_ROOF = new THREE.BoxGeometry(BLOCK_SIZE*3.1, BLOCK_SIZE*1, BLOCK_SIZE*4.1);
    }
    // Place M buildings, each using instancing
    function createInstancedBuildings(THREE, groundHeights, scene, M) {
      makeBuildingBaseGeometries();
      const possiblePlacements = Object.keys(groundHeights);
      const usedPositions = new Set();
      let boxMatrices = [];
      let roofMatrices = [];
      let colorIndexes = [];
      let created = 0, attempts = 0;
      while (created < M && attempts < M * 8) {
        let k, px, pz, trys = 0;
        do {
          k = possiblePlacements[Math.floor(Math.random()*possiblePlacements.length)];
          [px, pz] = k.split(",");
          trys++;
        } while (
          Math.abs(px - (WORLD_SIZE * CHUNK_SIZE) / 2) < 9 &&
          Math.abs(pz - (WORLD_SIZE * CHUNK_SIZE) / 2) < 9 &&
          trys < 12
        );
        if (usedPositions.has(k)) { attempts++; continue; }
        usedPositions.add(k);

        const wx = (px - (WORLD_SIZE * CHUNK_SIZE)/2) * BLOCK_SIZE + (Math.random()-0.5)*BLOCK_SIZE*0.7;
        const wy = groundHeights[k] * BLOCK_SIZE - 28 + 0.01;
        const wz = (pz - (WORLD_SIZE * CHUNK_SIZE)/2) * BLOCK_SIZE + (Math.random()-0.5)*BLOCK_SIZE*0.7;
        const matIdx = Math.floor(Math.random() * bldgMats.length);
        // Walls
        let mtx = new THREE.Matrix4();
        mtx.makeTranslation(wx, wy + BLOCK_SIZE * 1.5, wz);
        boxMatrices.push(mtx);
        colorIndexes.push(matIdx);
        // Roof
        let rm = new THREE.Matrix4();
        rm.makeTranslation(wx, wy + BLOCK_SIZE * 3.5, wz);
        roofMatrices.push(rm);
        created++; attempts++;
      }

      // Batched instanced mesh, but use one material for all (pick a color at random)
      bldgInstancedBox = new THREE.InstancedMesh(BLDG_BOX, bldgMats[0], boxMatrices.length); // will change color below
      for (let i = 0; i < boxMatrices.length; i++) {
        bldgInstancedBox.setMatrixAt(i, boxMatrices[i]);
        bldgInstancedBox.setColorAt(i, new THREE.Color(bldgMats[colorIndexes[i]].color));
      }
      bldgInstancedBox.instanceColor.needsUpdate = true;
      // Roofs
      bldgInstancedRoof = new THREE.InstancedMesh(BLDG_ROOF, bldgRoofMat, roofMatrices.length);
      for (let i = 0; i < roofMatrices.length; i++)
        bldgInstancedRoof.setMatrixAt(i, roofMatrices[i]);
      scene.add(bldgInstancedBox);
      scene.add(bldgInstancedRoof);
    }

    // -- Frustum culling for chunks (hide ones far from airplane) --
    function updateVisibleWorldChunks(playerPos) {
      worldChunks.forEach(chunk => {
        // Chunk's center
        const chunkPos = chunk.userData.chunkCenter;
        const dist = chunkPos.distanceTo(playerPos);
        // Fast hide if outside render distance
        chunk.visible = dist < RENDER_DIST_BLOCKS;
      });
    }

    // Clouds: same as before, but keep references for simple distance culling.
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
      group.userData.cloudCenter = new THREE.Vector3(x, y, z);
      return group;
    }

    // ---------------------------------------------------------
    // ------------ MAIN SCENE BUILDING  -----------------------
    async function init() {
      THREE = await import('three');
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setClearColor(0xe9f7fc);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio);

      mountRef.current.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(
        72,
        window.innerWidth / window.innerHeight,
        0.1,
        2400
      );

      // Lighting
      scene.add(new THREE.AmbientLight(0xffffff, 0.82));
      const sun = new THREE.DirectionalLight(0xffe094, 0.89);
      sun.position.set(-220, 200, 320);
      scene.add(sun);

      // Batched terrain: just 3 materials for instancing
      const MAT_STONE = new THREE.MeshLambertMaterial({ color: 0x888888 });
      const MAT_DIRT = new THREE.MeshLambertMaterial({ color: 0xd7bb86 });
      const MAT_GRASS = new THREE.MeshLambertMaterial({ color: 0x44ac39 });
      let groundHeights = {};

      // Chunks: smaller and fewer
      for (let cx = 0; cx < WORLD_SIZE; cx++) {
        for (let cz = 0; cz < WORLD_SIZE; cz++) {
          const chunkGroup = generateInstancedChunk(cx, cz, groundHeights, [MAT_STONE, MAT_DIRT, MAT_GRASS]);
          // Store world-space chunk center for culling
          const cxw = (cx + 0.5) * CHUNK_SIZE - (WORLD_SIZE * CHUNK_SIZE)/2;
          const czw = (cz + 0.5) * CHUNK_SIZE - (WORLD_SIZE * CHUNK_SIZE)/2;
          chunkGroup.userData.chunkCenter = new THREE.Vector3(
            cxw * BLOCK_SIZE,
            2,
            czw * BLOCK_SIZE
          );
          scene.add(chunkGroup);
          worldChunks.push(chunkGroup);
        }
      }

      // Instanced trees: batch render (reduced count)
      createInstancedTrees(THREE, groundHeights, scene, 18 + Math.round(Math.random() * 4)); // 18~22 trees

      // Instanced buildings: batch render (reduced count)
      createInstancedBuildings(THREE, groundHeights, scene, 4 + Math.floor(Math.random() * 3)); // 4~6 buildings

      // Minimal airplane as before
      airplanePivot = new THREE.Group();
      airplane = createBlockyAirplane(THREE);
      airplanePivot.add(airplane);
      // Position airplane well outside landscape bounds, aiming toward the center
      // Landscape spans from (-WORLD_SIZE*CHUNK_SIZE/2 * BLOCK_SIZE) to (WORLD_SIZE*CHUNK_SIZE/2 * BLOCK_SIZE)
      // Let's put the airplane along -X (left), at Y=32 above landscape, at center Z, facing positive X (toward terrain)
      const LANDSCAPE_HALF = (WORLD_SIZE * CHUNK_SIZE * BLOCK_SIZE) / 2; // e.g., 4*12*3/2=72
      const airplaneStartX = -LANDSCAPE_HALF - 52; // 52 units farther left of edge for a clear approach
      const airplaneStartY = 32; // A bit above expected landscape height
      const airplaneStartZ = 0;
      airplanePivot.position.set(airplaneStartX, airplaneStartY, airplaneStartZ);
      // Orientation: face toward the center (positive X direction), so yaw=0, pitch=0, roll=0 is OK
      // If needed, can adjust slightly for diagonal approach by yawing toward (0,0,0)
      airplanePivot.rotation.order = "YXZ";
      airplanePivot.rotation.set(0, 0, 0); // Ensure forward along X toward center
      scene.add(airplanePivot);

      // Clouds (reference groups for culling)
      cloudGroups = [];
      for (let i = 0; i < 8; i++) {
        const gx = -120 + Math.random() * 420;
        const gz = -120 + Math.random() * 420;
        const mesh = createCloud(THREE, gx, 80 + Math.random() * 75, gz);
        scene.add(mesh);
        cloudGroups.push(mesh);
      }

      updateCamera();

      window.addEventListener('resize', handleResize, false);
      window.addEventListener('keydown', onKeyDown, false);
      window.addEventListener('keyup', onKeyUp, false);

      clock = new THREE.Clock();
      animate();
    }

    // (Removed legacy: generateChunk, createVoxelTree, createVoxelBuilding, and their code blocks as they are now obsolete and cause lint/build errors.)

    // Simpler blocky airplane, unchanged (for focus on world perf)
    function createBlockyAirplane(THREE) {
      const group = new THREE.Group();
      const materialBody = new THREE.MeshLambertMaterial({ color: 0x3287c2 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(7, 2, 2), materialBody);
      group.add(body);
      const cockpit = new THREE.Mesh(
        new THREE.BoxGeometry(2, 1.15, 2),
        new THREE.MeshLambertMaterial({ color: 0xd8ecfe })
      );
      cockpit.position.set(3.4, 0.61, 0); group.add(cockpit);
      const wingGeometry = new THREE.BoxGeometry(3, 0.4, 10.5);
      const wingMaterial = new THREE.MeshLambertMaterial({ color: 0xf3d75b });
      const wings = new THREE.Mesh(wingGeometry, wingMaterial);
      wings.position.set(-0.3, -0.25, 0); group.add(wings);
      const tail = new THREE.Mesh(
        new THREE.BoxGeometry(2, 0.4, 2),
        new THREE.MeshLambertMaterial({ color: 0xe67e22 })
      );
      tail.position.set(-3.6, 0.45, 0); group.add(tail);
      const vertTail = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 1.25, 0.4),
        new THREE.MeshLambertMaterial({ color: 0xf8a04b })
      );
      vertTail.position.set(-4.3, 1.02, 0); group.add(vertTail);
      const prop = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.4, 2.1),
        new THREE.MeshLambertMaterial({ color: 0x303030 })
      );
      prop.position.set(4.5, 0, 0); group.add(prop);
      return group;
    }

    // Camera following, unchanged (for smoothness)
    function updateCamera() {
      const forward = new THREE.Vector3(1, 0.02, 0);
      forward.applyQuaternion(airplanePivot.quaternion);
      const cameraOffset = new THREE.Vector3(-14, 8.3, 0);
      cameraOffset.applyQuaternion(airplanePivot.quaternion);
      const pos = airplanePivot.position.clone().add(cameraOffset);
      camera.position.lerp(pos, 0.19);
      const lookTarget = airplanePivot.position.clone().add(forward.multiplyScalar(8));
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
      if (e.code === "Space") setInstructionsVisible(false);
    }
    function onKeyUp(e) {
      keyState[e.code] = false;
    }

    function airplaneControls(dt) {
      if (!airplanePivot) return;
      if (keyState['ArrowUp']) {
        airplanePivot.rotation.z += ROLL_RATE * dt * 43;
        airplanePivot.rotation.x += PITCH_RATE * dt * 44;
      }
      if (keyState['ArrowDown']) {
        airplanePivot.rotation.z -= ROLL_RATE * dt * 40;
        airplanePivot.rotation.x -= PITCH_RATE * dt * 44;
      }
      if (keyState['ArrowLeft']) {
        airplanePivot.rotation.y += TURN_RATE * dt * 29;
        airplanePivot.rotation.z += ROLL_RATE * dt * 56;
      }
      if (keyState['ArrowRight']) {
        airplanePivot.rotation.y -= TURN_RATE * dt * 29;
        airplanePivot.rotation.z -= ROLL_RATE * dt * 56;
      }
      airplanePivot.rotation.z = airplanePivot.rotation.z * 0.97;
      airplanePivot.rotation.x = Math.max(
        Math.min(airplanePivot.rotation.x, Math.PI / 4),
        -Math.PI / 4
      );
    }

    function animate() {
      const dt = clock.getDelta();
      airplaneControls(dt);
      // Move airplane forward in facing direction
      const move = new THREE.Vector3(1, 0, 0);
      move.applyEuler(airplanePivot.rotation);
      airplanePivot.position.addScaledVector(move, PLANE_SPEED * (1 + dt * 16));

      // --- DYNAMIC FRUSTUM CULLING of world, clouds ---
      updateVisibleWorldChunks(airplanePivot.position);
      cloudGroups.forEach(g => {
        // Hide clouds if >300 units away horizontally
        const dist = airplanePivot.position.distanceTo(g.userData.cloudCenter);
        g.visible = dist < 380;
      });

      updateCamera();
      renderer.render(scene, camera);
      animationId = requestAnimationFrame(animate);
    }

    init();

    return () => {
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
      // cleaning up three.js objects is omitted for brevity (small memory leak possible, irrelevant for perf in this simple demo)
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
