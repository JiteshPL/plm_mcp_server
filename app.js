// ==========================================
// 1. THREE.JS SCENE SETUP
// ==========================================
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e1e1e);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(15, 12, 20);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(20, 40, 20);
scene.add(dirLight);

const gridHelper = new THREE.GridHelper(30, 30, 0x444444, 0x222222);
scene.add(gridHelper);

// ==========================================
// 2. MOCK CAD ASSEMBLY CREATION (WITH METADATA)
// ==========================================
const partsRegistry = [];

function createCADComponent(id, geometry, color, supplier, position) {
  const material = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.4,
    metalness: 0.6
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.name = id;

  // Attach Custom Metadata (Simulating PLM BOM Attributes)
  mesh.userData = {
    partId: id,
    supplier: supplier,
    originalColor: color,
    originalVisibility: true
  };

  scene.add(mesh);
  partsRegistry.push(mesh);
}

// Build Mock Assembly with items from Vendor-A, Vendor-B, Vendor-C
createCADComponent('Base-Plate-01', new THREE.BoxGeometry(10, 0.5, 10), 0x7f8c8d, 'Vendor-A', [0, 0, 0]);
createCADComponent('Bracket-Left-02', new THREE.BoxGeometry(1, 4, 1), 0x3498db, 'Vendor-B', [-3, 2, 0]);
createCADComponent('Bracket-Right-03', new THREE.BoxGeometry(1, 4, 1), 0x3498db, 'Vendor-B', [3, 2, 0]);
createCADComponent('Engine-Block-04', new THREE.CylinderGeometry(2, 2, 5, 32), 0x95a5a6, 'Vendor-A', [0, 2.5, 0]);
createCADComponent('Valve-Cover-05', new THREE.SphereGeometry(1.5, 32, 16), 0xe67e22, 'Vendor-C', [0, 5.5, 0]);
createCADComponent('Fastener-Pin-06', new THREE.CylinderGeometry(0.3, 0.3, 2, 16), 0xf1c40f, 'Vendor-B', [0, 2.5, 3]);

// ==========================================
// 3. EXPOSED MCP TOOL IMPLEMENTATION
// ==========================================

/**
 * MCP Tool Handler: highlight_components
 *
 * @param {Object} args
 * @param {Object} args.filterCriteria - e.g. { supplier: "Vendor-B" }
 * @param {string} args.colorHex - Hex color string to highlight (e.g. "#FF0000")
 * @param {boolean} args.isolateMode - If true, hides all components that don't match criteria
 */
window.mcp_highlight_components = function(args) {
  logToConsole('Executing MCP Tool: highlight_components...');
  logToConsole(`Payload: ${JSON.stringify(args)}`);

  let matchedCount = 0;

  partsRegistry.forEach(mesh => {
    const matchesSupplier = args.filterCriteria?.supplier &&
                            mesh.userData.supplier === args.filterCriteria.supplier;

    if (matchesSupplier) {
      // Highlight match in requested red color
      mesh.material.color.set(args.colorHex);
      mesh.visible = true;
      matchedCount++;
    } else {
      // Handle isolation mode (hide unmatched parts)
      if (args.isolateMode) {
        mesh.visible = false;
      }
    }
  });

  const responseMessage = `Successfully highlighted ${matchedCount} part(s) matching criteria. Isolate Mode: ${args.isolateMode}`;
  logToConsole(`[MCP Response]: ${responseMessage}`);

  return {
    status: 'success',
    matchedPartsCount: matchedCount,
    message: responseMessage
  };
};

// Helper: Reset scene to initial state
function resetScene() {
  partsRegistry.forEach(mesh => {
    mesh.material.color.set(mesh.userData.originalColor);
    mesh.visible = true;
  });
  logToConsole('Scene reset to default state.');
}

// Trigger helper simulating an incoming JSON payload from WebSocket / MCP Server
function triggerMcpToolCall() {
  const mockPayload = {
    filterCriteria: { supplier: 'Vendor-B' },
    colorHex: '#FF0000',
    isolateMode: true
  };

  // Call the tool as the MCP Server SDK would
  window.mcp_highlight_components(mockPayload);
}

function logToConsole(text) {
  const logEl = document.getElementById('log-output');
  logEl.innerHTML += `<div>> ${text}</div>`;
  logEl.scrollTop = logEl.scrollHeight;
}

// ==========================================
// 4. ANIMATION & RESIZE LOOPS
// ==========================================
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

// Ensure this script tag exists in your index.html
const WS_PORT = 8080;
let socket;

function connectWebSocket() {
  socket = new WebSocket(`ws://localhost:${WS_PORT}`);

  socket.onopen = () => {
    logToConsole(`Connected to MCP Server WebSocket Bridge on port ${WS_PORT}`);
  };

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.action === 'highlight_components') {
        window.mcp_highlight_components(message.payload);
      }
    } catch (err) {
      console.error("Failed to execute MCP command", err);
    }
  };

  socket.onerror = (err) => {
    console.error("WebSocket Error:", err);
  };

  socket.onclose = () => {
    logToConsole("WebSocket closed. Retrying connection in 3s...");
    setTimeout(connectWebSocket, 3000);
  };
}

// Start connection loop
connectWebSocket();
