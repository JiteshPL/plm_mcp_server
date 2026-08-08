// ==========================================
// 1. THREE.JS SCENE SETUP
// ==========================================
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e1e1e);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(5, 4, 7);

const renderer = new THREE.WebGLRenderer({
    antialias: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.localClippingEnabled = true;
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Lighting for Realistic Materials
scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight1.position.set(10, 20, 10);
scene.add(dirLight1);

const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
dirLight2.position.set(-10, -10, -10);
scene.add(dirLight2);

const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
scene.add(gridHelper);

// Dynamic Cross-Section Plane
const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 2);

// ==========================================
// 2. LOAD REALISTIC GLTF ENGINE / CAR MODEL
// ==========================================
const partsRegistry = [];
const loader = new THREE.GLTFLoader();

// Sample Public 3D Engine Model from Khronos Group repository
const MODEL_URL = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Buggy/glTF-Binary/Buggy.glb';

/**
 * Adjusts camera position and controls target to fit the entire model in the viewport.
 * @param {THREE.Object3D} object - The loaded CAD model root object
 * @param {THREE.Camera} camera - Perspective camera
 * @param {OrbitControls} controls - OrbitControls instance
 * @param {number} offsetRatio - Multiplier to leave margin around the model (default 1.25)
 */
function fitModelToView(object, camera, controls, offsetRatio = 1.25) {
    // 1. Compute bounding box of the entire loaded object
    const boundingBox = new THREE.Box3().setFromObject(object);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();

    boundingBox.getCenter(center);
    boundingBox.getSize(size);

    // 2. Center the object's origin
    object.position.sub(center);

    // 3. Get maximum dimension (width, height, or depth)
    const maxDim = Math.max(size.x, size.y, size.z);

    if (maxDim === 0) return; // Prevent division by zero if empty

    // 4. Calculate required distance based on camera Field of View (FOV)
    const fov = camera.fov * (Math.PI / 180);
    let cameraDistance = Math.abs(maxDim / (2 * Math.tan(fov / 2))) * offsetRatio;

    // 5. Reposition camera diagonally (Isometric view relative to size)
    const cameraDirection = new THREE.Vector3(1, 0.8, 1).normalize();
    camera.position.copy(cameraDirection.multiplyScalar(cameraDistance));

    // 6. Set camera clipping planes dynamically to prevent near/far clipping artifacts
    camera.near = cameraDistance / 100;
    camera.far = cameraDistance * 100;
    camera.updateProjectionMatrix();

    // 7. Point OrbitControls target at origin center
    controls.target.set(0, 0, 0);
    controls.update();

    logToConsole(`Fitted model to view. Bounding Size: ${maxDim.toFixed(2)} units`);
}

// Granular Keyword-to-Vendor Mapping
const vendorMap = {
    'Vendor-A': ['tyre', 'tire', 'wheel', 'rim', 'rubber'],
    'Vendor-B': ['chassis', 'frame', 'body', 'axle', 'suspension'],
    'Vendor-C': ['engine', 'cylinder', 'valve', 'cover', 'piston', 'screw', 'bolt']
};

/**
 * Assigns supplier based on part name matching keywords
 */
function assignSupplier(partName) {
    if (!partName) return 'Vendor-A';

    const lowerName = partName.toLowerCase();

    for (const [vendor, keywords] of Object.entries(vendorMap)) {
        if (keywords.some(keyword => lowerName.includes(keyword))) {
            return vendor;
        }
    }

    // Fallback if no keyword matches
    return 'Vendor-A';
}

loader.load(
    MODEL_URL,
    (gltf) => {
        const model = gltf.scene;
        scene.add(model);

        model.traverse((child) => {
            if (child.isMesh) {
                // Get part name (or fallback to parent group name)
                const partName = child.name || child.parent ?.name || `Part_${child.id}`;

                // Determine Vendor dynamically
                const supplier = assignSupplier(partName);

                // Clone material for independent highlighting
                child.material = Array.isArray(child.material) ?
                    child.material.map(m => m.clone()) :
                    child.material.clone();

                child.userData = {
                    partId: partName,
                    supplier: supplier, // E.g., 'Vendor-A' for tyres, 'Vendor-B' for chassis
                    originalColor: (Array.isArray(child.material) ? child.material[0] : child.material).color.getHex(),
                    initialPosition: child.position.clone()
                };

                partsRegistry.push(child);
            }
        });

        fitModelToView(model, camera, controls, 1.3);
        logToConsole(`Loaded assembly: ${partsRegistry.length} parts registered.`);
    },
    (xhr) => {
        const percent = Math.round((xhr.loaded / (xhr.total || 1)) * 100);
        logToConsole(`Loading CAD Model... ${percent}%`);
    },
    (err) => logToConsole(`Error loading model: ${err.message}`)
);

// ==========================================
// 3. MCP TOOL IMPLEMENTATIONS
// ==========================================

window.mcp_highlight_components = function (args) {
    const targetSupplier = args.filterCriteria?.supplier?.toLowerCase();
    const hexColor = parseInt(args.colorHex.replace('#', '0x'), 16);
    let matchedCount = 0;

    partsRegistry.forEach(mesh => {
        const meshSupplier = mesh.userData.supplier?.toLowerCase();
        const isMatch = targetSupplier && meshSupplier === targetSupplier;

        if (isMatch) {
            matchedCount++;
            mesh.visible = true;

            // Handle both single and multi-material meshes
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.color.setHex(hexColor));
            } else {
                mesh.material.color.setHex(hexColor);
            }
        } else {
            if (args.isolateMode) {
                mesh.visible = false;
            } else {
                // Reset non-matching parts back to original color if isolateMode is false
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach(m => m.color.setHex(mesh.userData.originalColor));
                } else {
                    mesh.material.color.setHex(mesh.userData.originalColor);
                }
            }
        }
    });

    logToConsole(`Highlighted ${matchedCount} part(s) matching '${args.filterCriteria?.supplier}'.`);
};

window.mcp_set_camera_view = function (args) {
    // Calculate current scene bounds
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 10;

    const fov = camera.fov * (Math.PI / 180);
    const distance = Math.abs(maxDim / (2 * Math.tan(fov / 2))) * 1.3;

    controls.target.set(0, 0, 0);

    switch (args.preset) {
        case 'Top':
            camera.position.set(0, distance, 0.001);
            break;
        case 'Front':
            camera.position.set(0, 0, distance);
            break;
        case 'Right':
            camera.position.set(distance, 0, 0);
            break;
        case 'Isometric':
        default:
            camera.position.set(distance * 0.7, distance * 0.6, distance * 0.7);
            break;
    }

    controls.update();
    logToConsole(`Camera view set to ${args.preset}`);
};

window.mcp_generate_exploded_view = function (args) {
    const factor = args.explosionFactor || 0;
    partsRegistry.forEach(mesh => {
        const initial = mesh.userData.initialPosition;
        const direction = initial.clone().normalize();
        if (direction.length() === 0) direction.set(0, 1, 0);

        mesh.position.copy(initial).addScaledVector(direction, factor * 2);
    });
    logToConsole(`Exploded view factor set to: ${factor}`);
};

window.mcp_create_cross_section = function (args) {
    const enabled = args.enabled ?? true;
    const offset = args.offsetDistance ?? 0;

    if (!enabled) {
        partsRegistry.forEach(mesh => mesh.material.clippingPlanes = []);
        logToConsole('Cross section disabled.');
        return;
    }

    switch (args.plane) {
        case 'XY':
            clipPlane.normal.set(0, 0, -1);
            break;
        case 'YZ':
            clipPlane.normal.set(-1, 0, 0);
            break;
        case 'ZX':
        default:
            clipPlane.normal.set(0, -1, 0);
            break;
    }

    clipPlane.constant = offset + 1.0;
    partsRegistry.forEach(mesh => mesh.material.clippingPlanes = [clipPlane]);
    logToConsole(`Cross section active on ${args.plane} plane at offset ${offset}`);
};

function resetScene() {
    partsRegistry.forEach(mesh => {
        mesh.material.color.setHex(mesh.userData.originalColor);
        mesh.position.copy(mesh.userData.initialPosition);
        mesh.material.clippingPlanes = [];
        mesh.visible = true;
    });
    window.mcp_set_camera_view({
        preset: 'Isometric'
    });
    logToConsole('Scene reset to default.');
}

function logToConsole(text) {
    const logEl = document.getElementById('log-output');
    logEl.innerHTML += `<div>> ${text}</div>`;
    logEl.scrollTop = logEl.scrollHeight;
}

// ==========================================
// 4. WEBSOCKET BRIDGE
// ==========================================
function connectWebSocket() {
    const socket = new WebSocket('ws://localhost:8080');

    socket.onopen = () => {
        logToConsole('Connected to MCP Server on ws://localhost:8080');
    };

    socket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            // New servers send an ordered batch. Keep accepting the old single
            // action shape so a browser refresh is not required during rollout.
            const actions = message.actions || [{ name: message.action, args: message.payload }];
            executeActions(actions);
        } catch (err) {
            console.error('Action error', err);
        }
    };

    socket.onclose = () => setTimeout(connectWebSocket, 3000);
}

const actionHandlers = {
    highlight_components: window.mcp_highlight_components,
    set_camera_view: window.mcp_set_camera_view,
    generate_exploded_view: window.mcp_generate_exploded_view,
    create_cross_section: window.mcp_create_cross_section
};

let actionQueue = Promise.resolve();

function executeActions(actions) {
    actionQueue = actionQueue.then(() => {
        for (const { name, args } of actions) {
            const handler = actionHandlers[name];
            if (!handler) {
                console.warn(`Unknown MCP action: ${name}`);
                continue;
            }
            // A malformed action should be reported without preventing the
            // remaining actions in this LLM command from running.
            try {
                handler(args || {});
            } catch (err) {
                console.error(`Action error for ${name}`, err);
            }
        }
    }).catch(err => console.error('Action error', err));
    return actionQueue;
}

connectWebSocket();

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});


/**
 * Renders a structured Action Card inside the chat container
 * @param {string} actionType - E.g., "highlight_components" or "set_camera_view"
 * @param {string} description - E.g., "Highlighted 87 parts matching Vendor-A"
 * @param {Function} undoCallback - Function to revert the specific action
 */
function appendActionCard(actionType, description, undoCallback = null) {
  const chatContainer = document.getElementById('chat-messages');
  if (!chatContainer) return;

  const card = document.createElement('div');
  card.className = 'message assistant action-card';

  card.innerHTML = `
    <div class="action-info">
      <span class="action-badge">✓ ${actionType.replace('_', ' ')}</span>
      <span>${description}</span>
    </div>
    ${undoCallback ? '<button class="undo-btn">Undo</button>' : ''}
  `;

  if (undoCallback) {
    const undoBtn = card.querySelector('.undo-btn');
    undoBtn?.addEventListener('click', () => {
      undoCallback();
      card.style.opacity = '0.5';
      undoBtn.disabled = true;
      undoBtn.innerText = 'Reverted';
    });
  }

  chatContainer.appendChild(card);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function runVendorHighlight(vendor, colorHex) {
  window.mcp_highlight_components({
    filterCriteria: { supplier: vendor },
    colorHex,
    isolateMode: true
  });
}

document.getElementById('btnVendorA')?.addEventListener('click', () => {
  runVendorHighlight('Vendor-A', '#0000ff');
  appendActionCard(
    'highlight_components',
    'Highlighted Vendor-A parts in blue',
    () => resetScene()
  );
});

document.getElementById('btnVendorB')?.addEventListener('click', () => {
  runVendorHighlight('Vendor-B', '#ff0000');
  appendActionCard(
    'highlight_components',
    'Highlighted Vendor-B parts in red',
    () => resetScene()
  );
});
