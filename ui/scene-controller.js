console.log("PLM scene-controller STARTED");

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

console.log("THREE loaded:", THREE.REVISION);
console.log("OrbitControls loaded:", typeof OrbitControls);
console.log("GLTFLoader loaded:", typeof GLTFLoader);

const container = document.getElementById("canvas-container");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e1e1e);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
camera.position.set(5, 4, 7);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.localClippingEnabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.0;

container.appendChild(renderer.domElement);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const targetOutlinePass = new OutlinePass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  scene,
  camera,
);
targetOutlinePass.edgeStrength = 6;
targetOutlinePass.edgeGlow = 0.5;
targetOutlinePass.edgeThickness = 3;
targetOutlinePass.visibleEdgeColor.set(0x00ffff);
targetOutlinePass.hiddenEdgeColor.set(0x00ffff);
composer.addPass(targetOutlinePass);

const relatedOutlinePass = new OutlinePass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  scene,
  camera,
);
relatedOutlinePass.edgeStrength = 2;
relatedOutlinePass.edgeGlow = 0;
relatedOutlinePass.edgeThickness = 1;
relatedOutlinePass.visibleEdgeColor.set(0xffa500);
relatedOutlinePass.hiddenEdgeColor.set(0xffa500);
composer.addPass(relatedOutlinePass);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
scene.add(ambientLight);

const dirLight1 = new THREE.DirectionalLight(0xffffff, 2.5);
dirLight1.position.set(10, 20, 10);
scene.add(dirLight1);

const dirLight2 = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight2.position.set(-10, 10, -10);
scene.add(dirLight2);

const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.5);
scene.add(hemisphereLight);

const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
scene.add(gridHelper);

const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 2);
const partsRegistry = [];
const loader = new GLTFLoader();
const MODEL_URL =
  "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Buggy/glTF-Binary/Buggy.glb";

function focusOnParts(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = Math.max(maxDim * 3, 2);
  const direction = new THREE.Vector3(1, 0.8, 1).normalize();

  camera.position.copy(center.clone().add(direction.multiplyScalar(distance)));
  controls.target.copy(center);
  controls.update();
}

function fitModelToView(object, cameraRef, controlsRef, offsetRatio = 1.25) {
  const boundingBox = new THREE.Box3().setFromObject(object);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();

  boundingBox.getCenter(center);
  boundingBox.getSize(size);

  object.position.sub(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim === 0) return;

  const fov = cameraRef.fov * (Math.PI / 180);
  let cameraDistance =
    Math.abs(maxDim / (2 * Math.tan(fov / 2))) * offsetRatio;

  const cameraDirection = new THREE.Vector3(1, 0.8, 1).normalize();
  cameraRef.position.copy(cameraDirection.multiplyScalar(cameraDistance));
  cameraRef.near = cameraDistance / 100;
  cameraRef.far = cameraDistance * 100;
  cameraRef.updateProjectionMatrix();

  controlsRef.target.set(0, 0, 0);
  controlsRef.update();

  logToConsole(`Fitted model to view. Bounding Size: ${maxDim.toFixed(2)} units`);
}

const vendorMap = {
  "Vendor-A": ["tyre", "tire", "wheel", "rim", "rubber"],
  "Vendor-B": ["chassis", "frame", "body", "axle", "suspension"],
  "Vendor-C": [
    "engine",
    "cylinder",
    "valve",
    "cover",
    "piston",
    "screw",
    "bolt",
  ],
};

function assignSupplier(partName) {
  if (!partName) return "Vendor-A";
  const lowerName = partName.toLowerCase();
  for (const [vendor, keywords] of Object.entries(vendorMap)) {
    if (keywords.some((keyword) => lowerName.includes(keyword))) {
      return vendor;
    }
  }
  return "Vendor-A";
}

loader.load(
  MODEL_URL,
  (gltf) => {
    const model = gltf.scene;
    scene.add(model);

    model.traverse((child) => {
      if (!child.isMesh) return;
      const partName = child.name || child.parent?.name || `Part_${child.id}`;
      const supplier = assignSupplier(partName);
      child.material = Array.isArray(child.material)
        ? child.material.map((material) => material.clone())
        : child.material.clone();
      child.userData = {
        partId: partName,
        partName,
        aliases: [partName.toLowerCase()],
        supplier,
        originalColor: (Array.isArray(child.material)
          ? child.material[0]
          : child.material
        ).color.getHex(),
        initialPosition: child.position.clone(),
      };
      partsRegistry.push(child);
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
  (err) => logToConsole(`Error loading model: ${err.message}`),
);

function configureExplosionData(model) {
  scene.updateMatrixWorld(true);
  const assemblyCenter = new THREE.Box3()
    .setFromObject(model)
    .getCenter(new THREE.Vector3());

  partsRegistry.forEach((mesh, index) => {
    const partCenter = new THREE.Box3()
      .setFromObject(mesh)
      .getCenter(new THREE.Vector3());
    const direction = partCenter.sub(assemblyCenter);

    if (direction.lengthSq() < 0.000001) {
      direction.set(
        (index % 3) - 1,
        (Math.floor(index / 3) % 3) - 1,
        (Math.floor(index / 9) % 3) - 1,
      );
    }

    mesh.userData.initialWorldPosition = mesh.getWorldPosition(
      new THREE.Vector3(),
    );
    mesh.userData.explosionDirection = direction.normalize();
  });
}

function buildModelSummary(model) {
  const assemblyBox = new THREE.Box3().setFromObject(model);
  const size = assemblyBox.getSize(new THREE.Vector3());
  const supplierBreakdown = {};

  partsRegistry.forEach((mesh) => {
    const supplier = mesh.userData?.supplier || "Unknown";
    supplierBreakdown[supplier] = (supplierBreakdown[supplier] || 0) + 1;
  });

  const representativeParts = partsRegistry.slice(0, 12).map((mesh) => {
    const bounds = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
    return {
      name: mesh.userData?.partId || mesh.name || "Unnamed part",
      supplier: mesh.userData?.supplier || "Unknown",
      size: {
        x: Number(bounds.x.toFixed(2)),
        y: Number(bounds.y.toFixed(2)),
        z: Number(bounds.z.toFixed(2)),
      },
    };
  });

  const center = assemblyBox.getCenter(new THREE.Vector3());

  return {
    partCount: partsRegistry.length,
    boundingBox: {
      size: {
        x: Number(size.x.toFixed(2)),
        y: Number(size.y.toFixed(2)),
        z: Number(size.z.toFixed(2)),
      },
      center: {
        x: Number(center.x.toFixed(2)),
        y: Number(center.y.toFixed(2)),
        z: Number(center.z.toFixed(2)),
      },
    },
    supplierBreakdown,
    representativeParts,
    complexity:
      partsRegistry.length > 40
        ? "high"
        : partsRegistry.length > 15
          ? "medium"
          : "low",
  };
}

function sendModelSummaryToServer() {
  if (!browserSocket || browserSocket.readyState !== WebSocket.OPEN) return;
  browserSocket.send(
    JSON.stringify({
      type: "model-summary",
      summary: buildModelSummary(scene),
    }),
  );
}

window.mcp_highlight_components = function (args) {
  clearOutline();
  const targetSupplier = args.filterCriteria?.supplier?.toLowerCase();
  const namedColors = {
    blue: "#0084ff",
    red: "#ff0000",
    green: "#00c853",
    yellow: "#ffd600",
    orange: "#ff6d00",
    purple: "#9c27b0",
  };
  const requestedColor = String(args.colorHex || "").trim().toLowerCase();
  const colorHex = namedColors[requestedColor] || requestedColor;
  const validColor = /^#[0-9a-f]{6}$/i.test(colorHex);
  const hexColor = validColor ? parseInt(colorHex.slice(1), 16) : 0xff6d00;

  if (!validColor) {
    console.warn(`Invalid highlight color "${args.colorHex}". Using orange.`);
  }

  let matchedCount = 0;

  partsRegistry.forEach((mesh) => {
    const meshSupplier = mesh.userData?.supplier?.toLowerCase();
    const isMatch = targetSupplier && meshSupplier === targetSupplier;
    if (isMatch) {
      matchedCount++;
      mesh.visible = true;
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => material.color.setHex(hexColor));
      } else {
        mesh.material.color.setHex(hexColor);
      }
    } else if (args.isolateMode) {
      mesh.visible = false;
    } else if (Array.isArray(mesh.material)) {
      mesh.material.forEach((material) =>
        material.color.setHex(mesh.userData.originalColor),
      );
    } else {
      mesh.material.color.setHex(mesh.userData.originalColor);
    }
  });

  logToConsole(
    `Highlighted ${matchedCount} part(s) matching '${args.filterCriteria?.supplier}'.`,
  );
};

window.mcp_set_camera_view = function (args) {
  clearOutline();
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 10;
  const fov = camera.fov * (Math.PI / 180);
  const distance = Math.abs(maxDim / (2 * Math.tan(fov / 2))) * 1.3;
  controls.target.set(0, 0, 0);

  switch (args.preset) {
    case "Top":
      camera.position.set(0, distance, 0.001);
      break;
    case "Bottom":
      camera.position.set(0, -distance, 0.001);
      break;
    case "Front":
      camera.position.set(0, 0, distance);
      break;
    case "Right":
      camera.position.set(distance, 0, 0);
      break;
    case "Isometric":
    default:
      camera.position.set(distance * 0.7, distance * 0.6, distance * 0.7);
      break;
  }
  controls.update();
  logToConsole(`Camera view set to ${args.preset}`);
};

window.mcp_generate_exploded_view = function (args) {
  clearOutline();
  const factor = Number(args.explosionFactor) || 0;
  partsRegistry.forEach((mesh) => {
    const initialWorldPosition = mesh.userData?.initialWorldPosition;
    const meshDirection = mesh.userData?.explosionDirection || new THREE.Vector3(1, 0, 0);
    if (!initialWorldPosition || !mesh.parent) return;
    const targetWorldPosition = initialWorldPosition
      .clone()
      .addScaledVector(meshDirection, factor * 2);
    mesh.position.copy(mesh.parent.worldToLocal(targetWorldPosition));
  });
  logToConsole(`Exploded view factor set to: ${factor}`);
};

window.mcp_create_cross_section = function (args) {
  clearOutline();
  const enabled = args.enabled ?? true;
  const offset = args.offsetDistance ?? 0;
  if (!enabled) {
    partsRegistry.forEach((mesh) => (mesh.material.clippingPlanes = []));
    logToConsole("Cross section disabled.");
    return;
  }
  switch (args.plane) {
    case "XY":
      clipPlane.normal.set(0, 0, -1);
      break;
    case "YZ":
      clipPlane.normal.set(-1, 0, 0);
      break;
    case "ZX":
    default:
      clipPlane.normal.set(0, -1, 0);
      break;
  }
  clipPlane.constant = offset + 1.0;
  partsRegistry.forEach((mesh) => (mesh.material.clippingPlanes = [clipPlane]));
  logToConsole(`Cross section active on ${args.plane} plane at offset ${offset}`);
};

function resetScene() {
  clearOutline();
  partsRegistry.forEach((mesh) => {
    mesh.material.color.setHex(mesh.userData.originalColor);
    mesh.position.copy(mesh.userData.initialPosition);
    mesh.material.clippingPlanes = [];
    mesh.visible = true;
  });
  window.mcp_set_camera_view({ preset: "Isometric" });
  logToConsole("Scene reset to default.");
}

window.mcp_reset_scene = function () {
  resetScene();
};

function findPartMatches(partName) {
  const query = String(partName || "").trim().toLowerCase();
  return partsRegistry.filter((mesh) => {
    const name = String(
      mesh.userData.partName || mesh.userData.partId || mesh.name || "",
    ).toLowerCase();
    return name === query || name.includes(query);
  });
}

window.mcp_isolate_part = function (args) {
  clearOutline();
  resetAllPartOpacity();
  const matches = findPartMatches(args.partName);
  if (matches.length === 0) {
    partsRegistry.forEach((mesh) => {
      mesh.visible = true;
    });
    logToConsole(`Part '${args.partName}' not found.`);
    return;
  }

  partsRegistry.forEach((mesh) => {
    const selected = matches.includes(mesh);
    mesh.visible = selected;
  });

  focusOnParts(matches);
  logToConsole(`Isolated ${matches.length} part(s) matching '${args.partName}'.`);
};

function findSpatialNeighbors(targetMeshes, maxDistance = 1) {
  const targetBox = new THREE.Box3();
  targetMeshes.forEach((mesh) => {
    const box = new THREE.Box3().setFromObject(mesh);
    targetBox.union(box);
  });
  const candidates = [];
  partsRegistry.forEach((candidate) => {
    if (targetMeshes.includes(candidate)) return;
    const candidateBox = new THREE.Box3().setFromObject(candidate);
    const distance = getBoxDistance(targetBox, candidateBox);
    if (distance <= maxDistance) {
      candidates.push({ mesh: candidate, distance });
    }
  });

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates;
}

function getBoxDistance(boxA, boxB) {
  const dx = Math.max(boxA.min.x - boxB.max.x, boxB.min.x - boxA.max.x, 0);
  const dy = Math.max(boxA.min.y - boxB.max.y, boxB.min.y - boxA.max.y, 0);
  const dz = Math.max(boxA.min.z - boxB.max.z, boxB.min.z - boxA.max.z, 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function addPartIfValid(object, result) {
  if (!object || !object.isMesh || !object.userData?.partId) return;
  result.add(object);
}

function highlightMesh(mesh, colorHex = 0xffa500) {
  if (!mesh || !mesh.material) return;
  if (!mesh.userData.originalMaterial) {
    if (Array.isArray(mesh.material)) {
      mesh.userData.originalMaterial = mesh.material.map((material) =>
        material.clone(),
      );
    } else {
      mesh.userData.originalMaterial = mesh.material.clone();
    }
  }

  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((material) => {
      if (material.color) material.color.setHex(colorHex);
      if (material.emissive) {
        material.emissive.setHex(colorHex);
        material.emissiveIntensity = 0.5;
      }
    });
  } else {
    if (mesh.material.color) mesh.material.color.setHex(colorHex);
    if (mesh.material.emissive) {
      mesh.material.emissive.setHex(colorHex);
      mesh.material.emissiveIntensity = 0.5;
    }
  }
}

function removeMeshHighlight(mesh) {
  if (!mesh || !mesh.userData.originalMaterial) return;

  if (Array.isArray(mesh.userData.originalMaterial)) {
    mesh.material = mesh.userData.originalMaterial.map((material) =>
      material.clone(),
    );
  } else {
    mesh.material = mesh.userData.originalMaterial.clone();
  }

  delete mesh.userData.originalMaterial;
}

function outlineMeshes(meshes) {
  outlinePass.selectedObjects = meshes.filter(
    (mesh) => mesh && typeof mesh.updateWorldMatrix === "function",
  );
}

function clearOutline() {
  targetOutlinePass.selectedObjects.length = 0;
  relatedOutlinePass.selectedObjects.length = 0;
}

function setMeshOpacity(object, opacity) {
  object.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      material.transparent = opacity < 1;
      material.opacity = opacity;
      material.depthWrite = opacity >= 1;
      material.needsUpdate = true;
    });
  });
}

function resetAllPartOpacity() {
  partsRegistry.forEach((mesh) => setMeshOpacity(mesh, 1.0));
}

window.mcp_find_related_parts = function (args) {
  resetAllPartOpacity();
  const partName = String(args.partName || "").trim().toLowerCase();
  const maxDistance = args.maxDistance !== undefined ? Number(args.maxDistance) : 1;
  if (!partName) {
    logToConsole("No part name provided.");
    return [];
  }

  partsRegistry.forEach((mesh) => removeMeshHighlight(mesh));
  const matches = findPartMatches(partName);
  if (matches.length === 0) {
    logToConsole(`Part '${args.partName}' was not found.`);
    return [];
  }

  const neighbors = findSpatialNeighbors(matches, maxDistance);
  const neighborMeshes = neighbors.map((item) => item.mesh);
  const visibleParts = new Set([...matches, ...neighborMeshes]);

  partsRegistry.forEach((mesh) => {
    mesh.visible = visibleParts.has(mesh);
  });

  targetOutlinePass.selectedObjects = matches;
  relatedOutlinePass.selectedObjects = neighborMeshes;

  matches.forEach((mesh) => setMeshOpacity(mesh, 1.0));

  const result = neighbors.map((item) => ({
    partName:
      item.mesh.userData?.partName || item.mesh.userData?.partId || item.mesh.name,
    partId: item.mesh.userData?.partId || item.mesh.name,
    distance: Number(item.distance.toFixed(3)),
  }));

  logToConsole(
    `Showing ${result.length} spatial neighbours within distance ${maxDistance}.`,
  );

  return result;
};

function logToConsole(text) {
  const logEl = document.getElementById("log-output");
  if (!logEl) return;
  logEl.innerHTML += `<div>> ${text}</div>`;
  logEl.scrollTop = logEl.scrollHeight;
}

let browserSocket = null;
let currentSocketPortIndex = 0;

function getCandidateServerPorts() {
  const ports = [window.location.port, "8080", "8081", "8082", "8083", "8084"]
    .filter(Boolean)
    .map((value) => String(value));
  return [...new Set(ports)];
}

function getStatusText(message) {
  if (typeof message.message === "string") {
    return message.message;
  }

  if (typeof message.message === "object" && message.message !== null) {
    if (typeof message.message.text === "string") return message.message.text;
    if (typeof message.message.message === "string") return message.message.message;
    return JSON.stringify(message.message);
  }

  if (typeof message.tool === "string") {
    return `Using ${message.tool}...`;
  }

  return "Working...";
}

function addAgentStep(icon, message, status) {
  const container = document.getElementById("agent-steps");
  if (!container) return;

  const step = document.createElement("div");
  step.className = `agent-step ${status}`;

  const iconEl = document.createElement("span");
  iconEl.className = "agent-step-icon";
  iconEl.textContent = icon;

  const messageEl = document.createElement("span");
  messageEl.className = "agent-step-message";
  messageEl.textContent = message;

  step.appendChild(iconEl);
  step.appendChild(messageEl);
  container.appendChild(step);
  container.scrollTop = container.scrollHeight;
}

let agentStatusClosed = false;

function closeAgentStatus() {
  const panel = document.getElementById("agent-status");
  if (!panel) return;

  panel.classList.add("hidden");
  agentStatusClosed = true;
}

function handleAgentStatus(message) {
  const panel = document.getElementById("agent-status");
  const steps = document.getElementById("agent-steps");
  const state = document.getElementById("agent-status-state");

  if (!panel || !steps) return;

  if (message.status === "thinking") {
    agentStatusClosed = false;
    steps.innerHTML = "";
    panel.classList.remove("hidden");
  }

  if (agentStatusClosed) return;

  const text = getStatusText(message) || "Working...";

  if (message.status === "thinking") {
    addAgentStep("🤔", text, "active");
    state.textContent = "Thinking";
    return;
  }

  if (message.status === "tool_selected") {
    addAgentStep("🔧", text, "active");
    state.textContent = "Selecting tool";
    return;
  }

  if (message.status === "executing") {
    addAgentStep("⚙", text, "active");
    state.textContent = "Working";
    return;
  }

  if (message.status === "completed") {
    addAgentStep("✓", text, "completed");
    state.textContent = "Completed";
    return;
  }

  if (message.status === "error") {
    addAgentStep("⚠", text, "error");
    state.textContent = "Error";
  }
}

function connectWebSocket() {
  const ports = getCandidateServerPorts();
  const port = ports[currentSocketPortIndex % ports.length];
  browserSocket = new WebSocket(`ws://localhost:${port}`);

  browserSocket.onopen = () => {
    console.log("[Browser] Connected to PLM server");
    browserSocket.send(
      JSON.stringify({
        type: "client-role",
        role: "browser",
      }),
    );
    sendModelSummaryToServer();
  };

  browserSocket.onerror = () => {
    currentSocketPortIndex = (currentSocketPortIndex + 1) % ports.length;
    if (currentSocketPortIndex === 0) {
      logToConsole(
        `Unable to connect to MCP server. Tried ports: ${ports.join(", ")}`,
      );
    }
    setTimeout(connectWebSocket, 1000);
  };

  browserSocket.onmessage = async (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "agent_status") {
      updateAgentStatus(message);
      return;
    }

    if (message.type === "execute-action") {
      const { requestId, action } = message;

      try {
        const functionName = `mcp_${action.name}`;
        const handler = window[functionName];

        if (typeof handler !== "function") {
          throw new Error(`Tool handler not found: ${functionName}`);
        }

        const result = await handler(action.args || {});

        browserSocket.send(
          JSON.stringify({
            type: "action-result",
            requestId,
            result,
          }),
        );
      } catch (error) {
        browserSocket.send(
          JSON.stringify({
            type: "action-result",
            requestId,
            result: { error: error.message },
          }),
        );
      }
    }

    if (Array.isArray(message.actions)) {
      for (const action of message.actions) {
        await executeAction(action);
      }
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
  find_related_parts: window.mcp_find_related_parts,
};

let actionQueue = Promise.resolve();

function executeActions(actions) {
  actionQueue = actionQueue
    .then(() => {
      for (const { name, args } of actions) {
        const handler = actionHandlers[name];
        if (!handler) {
          console.warn(`Unknown MCP action: ${name}`);
          continue;
        }

        try {
          handler(args || {});
        } catch (err) {
          console.error(`Action error for ${name}`, err);
        }
      }
    })
    .catch((err) => console.error("Action error", err));

  return actionQueue;
}

connectWebSocket();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  composer.render();
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

function updateAgentStatus(data) {
  const panel = document.getElementById("agent-status");
  const state = document.getElementById("agent-status-state");
  const steps = document.getElementById("agent-steps");

  if (!panel || !state || !steps) {
    console.warn("[Agent Status] UI elements not found");
    return;
  }

  panel.classList.remove("hidden");
  state.textContent = data.status || "Working";

  const messageText = getStatusText(data);

  if (messageText) {
    const step = document.createElement("div");
    step.className = "agent-step";

    const icon =
      data.status === "completed" ? "✓" : data.status === "error" ? "⚠" : "●";

    step.innerHTML = `
      <span class="agent-step-icon">${icon}</span>
      <span class="agent-step-text">${escapeHtml(messageText)}</span>
    `;

    steps.appendChild(step);
    steps.scrollTop = steps.scrollHeight;
  }
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}

function appendActionCard(actionType, description, undoCallback = null) {
  const chatContainer = document.getElementById("chat-messages");
  if (!chatContainer) return;

  const card = document.createElement("div");
  card.className = "message assistant action-card";

  card.innerHTML = `
    <div class="action-info">
      <span class="action-badge">✓ ${actionType.replace("_", " ")}</span>
      <span>${description}</span>
    </div>
    ${undoCallback ? '<button class="undo-btn">Undo</button>' : ""}
  `;

  if (undoCallback) {
    const undoBtn = card.querySelector(".undo-btn");
    undoBtn?.addEventListener("click", () => {
      undoCallback();
      card.style.opacity = "0.5";
      undoBtn.disabled = true;
      undoBtn.innerText = "Reverted";
    });
  }

  chatContainer.appendChild(card);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function runVendorHighlight(vendor, colorHex) {
  window.mcp_highlight_components({
    filterCriteria: { supplier: vendor },
    colorHex,
    isolateMode: true,
  });
}

document.getElementById("btnVendorA")?.addEventListener("click", () => {
  runVendorHighlight("Vendor-A", "#0000ff");
  appendActionCard(
    "highlight_components",
    "Highlighted Vendor-A parts in blue",
    () => resetScene(),
  );
});

document.getElementById("btnVendorB")?.addEventListener("click", () => {
  runVendorHighlight("Vendor-B", "#ff0000");
  appendActionCard(
    "highlight_components",
    "Highlighted Vendor-B parts in red",
    () => resetScene(),
  );
});

window.resetScene = resetScene;
window.closeAgentStatus = closeAgentStatus;
window.executeActions = executeActions;
window.handleAgentStatus = handleAgentStatus;
window.getStatusText = getStatusText;
window.appendActionCard = appendActionCard;
