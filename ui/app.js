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


function focusOnParts(mesh) {

    const box =
        new THREE.Box3().setFromObject(mesh);

    const center =
        box.getCenter(new THREE.Vector3());

    const size =
        box.getSize(new THREE.Vector3());

    const maxDim =
        Math.max(size.x, size.y, size.z);

    const distance =
        Math.max(maxDim * 3, 2);

    const direction =
        new THREE.Vector3(1, 0.8, 1)
            .normalize();

    camera.position.copy(
        center.clone()
            .add(direction.multiplyScalar(distance))
    );

    controls.target.copy(center);

    controls.update();
}

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
                    partName: partName,
                    aliases: [
                        partName.toLowerCase()
                    ],
                    supplier: supplier,
                    originalColor: (
                        Array.isArray(child.material) ?
                        child.material[0] :
                        child.material
                    ).color.getHex(),
                    initialPosition: child.position.clone()
                };

                partsRegistry.push(child);
            }
        });

        fitModelToView(model, camera, controls, 1.3);
        configureExplosionData(model);
        sendModelSummaryToServer();
        logToConsole(`Loaded assembly: ${partsRegistry.length} parts registered.`);
    },
    (xhr) => {
        const percent = Math.round((xhr.loaded / (xhr.total || 1)) * 100);
        logToConsole(`Loading CAD Model... ${percent}%`);
    },
    (err) => logToConsole(`Error loading model: ${err.message}`)
);

function configureExplosionData(model) {
    scene.updateMatrixWorld(true);
    const assemblyCenter = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());

    partsRegistry.forEach((mesh, index) => {
        const partCenter = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
        const direction = partCenter.sub(assemblyCenter);

        // Nested GLTF meshes can share one local origin; give each of those a
        // stable direction so the assembly still visibly separates.
        if (direction.lengthSq() < 0.000001) {
            direction.set((index % 3) - 1, (Math.floor(index / 3) % 3) - 1, (Math.floor(index / 9) % 3) - 1);
        }

        mesh.userData.initialWorldPosition = mesh.getWorldPosition(new THREE.Vector3());
        mesh.userData.explosionDirection = direction.normalize();
    });
}

function buildModelSummary(model) {
    const assemblyBox = new THREE.Box3().setFromObject(model);
    const size = assemblyBox.getSize(new THREE.Vector3());
    const supplierBreakdown = {};

    partsRegistry.forEach(mesh => {
        const supplier = mesh.userData?.supplier || 'Unknown';
        supplierBreakdown[supplier] = (supplierBreakdown[supplier] || 0) + 1;
    });

    const representativeParts = partsRegistry.slice(0, 12).map(mesh => {
        const bounds = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
        return {
            name: mesh.userData?.partId || mesh.name || 'Unnamed part',
            supplier: mesh.userData?.supplier || 'Unknown',
            size: {
                x: Number(bounds.x.toFixed(2)),
                y: Number(bounds.y.toFixed(2)),
                z: Number(bounds.z.toFixed(2))
            }
        };
    });

    return {
        partCount: partsRegistry.length,
        boundingBox: {
            size: {
                x: Number(size.x.toFixed(2)),
                y: Number(size.y.toFixed(2)),
                z: Number(size.z.toFixed(2))
            },
            center: {
                x: Number(assemblyBox.getCenter(new THREE.Vector3()).x.toFixed(2)),
                y: Number(assemblyBox.getCenter(new THREE.Vector3()).y.toFixed(2)),
                z: Number(assemblyBox.getCenter(new THREE.Vector3()).z.toFixed(2))
            }
        },
        supplierBreakdown,
        representativeParts,
        complexity: partsRegistry.length > 40 ? 'high' : partsRegistry.length > 15 ? 'medium' : 'low'
    };
}

function sendModelSummaryToServer() {
    if (!browserSocket || browserSocket.readyState !== WebSocket.OPEN) return;
    browserSocket.send(JSON.stringify({
        type: 'model-summary',
        summary: buildModelSummary(scene)
    }));
}

// ==========================================
// 3. MCP TOOL IMPLEMENTATIONS
// ==========================================

window.mcp_highlight_components = function (args) {
    const targetSupplier = args.filterCriteria?.supplier?.toLowerCase();
    const namedColors = {
        blue: '#0084ff', red: '#ff0000', green: '#00c853',
        yellow: '#ffd600', orange: '#ff6d00', purple: '#9c27b0'
    };
    const requestedColor = String(args.colorHex || '').trim().toLowerCase();
    const colorHex = namedColors[requestedColor] || requestedColor;
    const validColor = /^#[0-9a-f]{6}$/i.test(colorHex);
    const hexColor = validColor ? parseInt(colorHex.slice(1), 16) : 0xff6d00;

    if (!validColor) console.warn(`Invalid highlight color "${args.colorHex}". Using orange.`);
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
        case 'Bottom':
            camera.position.set(0, -distance, 0.001);
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
    const factor = Number(args.explosionFactor) || 0;
    partsRegistry.forEach(mesh => {
        const initialWorldPosition = mesh.userData.initialWorldPosition;
        const direction = mesh.userData.explosionDirection;
        if (!initialWorldPosition || !direction || !mesh.parent) return;

        const targetWorldPosition = initialWorldPosition.clone().addScaledVector(direction, factor * 2);
        mesh.position.copy(mesh.parent.worldToLocal(targetWorldPosition));
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

window.mcp_reset_scene = function () {
    resetScene();
};

function findPartMatches(partName) {

    const query =
        String(partName || "")
            .trim()
            .toLowerCase();

    return partsRegistry.filter(mesh => {

        const name =
            String(
                mesh.userData.partName ||
                mesh.userData.partId ||
                mesh.name ||
                ""
            ).toLowerCase();

        return (
            name === query ||
            name.includes(query)
        );
    });
}

window.mcp_isolate_part = function (args) {

    const matches =
        findPartMatches(args.partName);

    if (matches.length === 0) {

        partsRegistry.forEach(mesh => {
            mesh.visible = true;
        });

        logToConsole(
            `Part '${args.partName}' not found.`
        );

        return;
    }

    partsRegistry.forEach(mesh => {

        const selected =
            matches.includes(mesh);

        mesh.visible = selected;

        if (selected) {

            const color =
                parseInt(
                    (args.colorHex || "#ffd600")
                        .replace("#", ""),
                    16
                );

            // if (Array.isArray(mesh.material)) {
            //     mesh.material.forEach(m =>
            //         m.color.setHex(color)
            //     );
            // } else {
            //     mesh.material.color.setHex(color);
            // }
        }
    });

    focusOnParts(matches);

    logToConsole(
        `Isolated ${matches.length} part(s) matching '${args.partName}'.`
    );
};

function findSpatialNeighbors(
    targetMeshes,
    maxResults = 20,
    maxDistance = Infinity
) {
    const targetBox = new THREE.Box3();

    // Create a combined bounding box for all target parts
    targetMeshes.forEach(mesh => {
        const box = new THREE.Box3().setFromObject(mesh);
        targetBox.union(box);
    });

    const candidates = [];

    partsRegistry.forEach(candidate => {

        // Don't return the target itself
        if (targetMeshes.includes(candidate)) {
            return;
        }

        const candidateBox =
            new THREE.Box3().setFromObject(candidate);

        const distance =
            getBoxDistance(targetBox, candidateBox);

        if (distance <= maxDistance) {

            candidates.push({
                mesh: candidate,
                distance
            });
        }
    });

    // Closest parts first
    candidates.sort(
        (a, b) => a.distance - b.distance
    );

    return candidates.slice(0, maxResults);
}

function getBoxDistance(boxA, boxB) {

    const dx = Math.max(
        boxA.min.x - boxB.max.x,
        boxB.min.x - boxA.max.x,
        0
    );

    const dy = Math.max(
        boxA.min.y - boxB.max.y,
        boxB.min.y - boxA.max.y,
        0
    );

    const dz = Math.max(
        boxA.min.z - boxB.max.z,
        boxB.min.z - boxA.max.z,
        0
    );

    return Math.sqrt(
        dx * dx +
        dy * dy +
        dz * dz
    );
}

function addPartIfValid(object, result) {

    if (!object) {
        return;
    }

    if (!object.isMesh) {
        return;
    }

    if (!object.userData?.partId) {
        return;
    }

    result.add(object);
}

   function highlightMesh(mesh, colorHex = 0xffa500) {

    if (!mesh || !mesh.material) {
        return;
    }

    // Save original material/color only once
    if (!mesh.userData.originalMaterial) {

        if (Array.isArray(mesh.material)) {
            mesh.userData.originalMaterial =
                mesh.material.map(material => material.clone());
        } else {
            mesh.userData.originalMaterial =
                mesh.material.clone();
        }
    }

    if (Array.isArray(mesh.material)) {

        mesh.material.forEach(material => {

            if (material.color) {
                material.color.setHex(colorHex);
            }

            if (material.emissive) {
                material.emissive.setHex(colorHex);
                material.emissiveIntensity = 0.5;
            }
        });

    } else {

        if (mesh.material.color) {
            mesh.material.color.setHex(colorHex);
        }

        if (mesh.material.emissive) {
            mesh.material.emissive.setHex(colorHex);
            mesh.material.emissiveIntensity = 0.5;
        }
    }
}

function removeMeshHighlight(mesh) {

    if (!mesh || !mesh.userData.originalMaterial) {
        return;
    }

    if (Array.isArray(mesh.userData.originalMaterial)) {

        mesh.material =
            mesh.userData.originalMaterial.map(
                material => material.clone()
            );

    } else {

        mesh.material =
            mesh.userData.originalMaterial.clone();
    }

    delete mesh.userData.originalMaterial;
}

window.mcp_find_related_parts = function (args) {

    const partName =
        String(args.partName || "")
            .trim()
            .toLowerCase();

    const maxResults =
        Number(args.maxResults || 5);

    const maxDistance =
        args.maxDistance !== undefined
            ? Number(args.maxDistance)
            : Infinity;

    if (!partName) {
        logToConsole("No part name provided.");
        return [];
    }

    // Remove previous highlights
    partsRegistry.forEach(mesh => {
        removeMeshHighlight(mesh);
    });

    // Find target part(s)
    const matches = findPartMatches(partName);

    if (matches.length === 0) {
        logToConsole(
            `Part '${args.partName}' was not found.`
        );
        return [];
    }

    // Find spatial neighbours
    const neighbors = findSpatialNeighbors(
        matches,
        maxResults,
        maxDistance
    );

    // Get actual THREE meshes
    const neighborMeshes =
        neighbors.map(item => item.mesh);

    // ---------------------------------------
    // Target + neighbours are the ONLY visible
    // ---------------------------------------

    const visibleParts = new Set([
        ...matches,
        ...neighborMeshes
    ]);

    partsRegistry.forEach(mesh => {

        mesh.visible = visibleParts.has(mesh);

    });

    // ---------------------------------------
    // Highlight target
    // ---------------------------------------

    matches.forEach(mesh => {

        highlightMesh(
            mesh,
            0x00ff00
        );

    });

    // ---------------------------------------
    // Highlight neighbours
    // ---------------------------------------

    neighborMeshes.forEach(mesh => {

        highlightMesh(
            mesh,
            0xffa500
        );

    });

    // ---------------------------------------
    // Focus camera
    // ---------------------------------------
console.log(
    "Total registered parts:",
    partsRegistry.length
);

console.log(
    "Target parts:",
    matches.length
);

console.log(
    "Neighbours:",
    neighborMeshes.length
);
    // focusOnParts([
    //     ...matches,
    //     ...neighborMeshes
    // ]);

    // ---------------------------------------
    // Return information to agent
    // ---------------------------------------

    const result = neighbors.map(item => ({
        partName:
            item.mesh.userData?.partName ||
            item.mesh.userData?.partId ||
            item.mesh.name,

        partId:
            item.mesh.userData?.partId ||
            item.mesh.name,

        distance: Number(
            item.distance.toFixed(3)
        )
    }));

    logToConsole(
        `Showing target + ${result.length} spatial neighbours.`
    );

    return result;
};

function logToConsole(text) {
    const logEl = document.getElementById('log-output');
    logEl.innerHTML += `<div>> ${text}</div>`;
    logEl.scrollTop = logEl.scrollHeight;
}

// ==========================================
// 4. WEBSOCKET BRIDGE
// ==========================================
let browserSocket = null;
let currentSocketPortIndex = 0;

function getCandidateServerPorts() {
    const ports = [window.location.port, '8080', '8081', '8082', '8083', '8084']
        .filter(Boolean)
        .map(value => String(value));
    return [...new Set(ports)];
}

function connectWebSocket() {
    const ports = getCandidateServerPorts();
    const port = ports[currentSocketPortIndex % ports.length];
    browserSocket = new WebSocket(`ws://localhost:${port}`);

    browserSocket.onopen = () => {
        currentSocketPortIndex = 0;
        logToConsole(`Connected to MCP Server on ws://localhost:${port}`);
        sendModelSummaryToServer();
    };

    browserSocket.onerror = () => {
        currentSocketPortIndex = (currentSocketPortIndex + 1) % ports.length;
        if (currentSocketPortIndex === 0) {
            logToConsole(`Unable to connect to MCP server. Tried ports: ${ports.join(', ')}`);
        }
        setTimeout(connectWebSocket, 1000);
    };

    browserSocket.onmessage = (event) => {
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

    browserSocket.onclose = () => setTimeout(connectWebSocket, 3000);
}

const actionHandlers = {
    reset_scene: window.mcp_reset_scene,
    highlight_components: window.mcp_highlight_components,
    set_camera_view: window.mcp_set_camera_view,
    generate_exploded_view: window.mcp_generate_exploded_view,
    create_cross_section: window.mcp_create_cross_section,
    isolate_part: window.mcp_isolate_part,
    find_related_parts:window.mcp_find_related_parts,
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
