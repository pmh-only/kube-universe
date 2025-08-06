// Graph instance
let graph;

// Initialize the 3D graph
function initializeGraph() {
  const elem = document.getElementById('3d-graph');
  graph = ForceGraph3D()(elem)
    .backgroundColor('#212121') // Very dark background for contrast
    .nodeLabel(createNodeTooltip)
    .nodeOpacity(1)
    .nodeColor(getNodeColor)
    .nodeThreeObject(createNodeObject)
    .linkColor(getLinkColor)
    .linkWidth(2) // Static link width for better performance
    .linkDirectionalParticles(15) // Static particle count
    .linkDirectionalParticleWidth(3) // Static particle width
    .linkDirectionalParticleColor(() => '#ffffff') // Static white particles
    .numDimensions(3)
    .nodeResolution(15)
    .linkDirectionalParticleSpeed(0.008) // Static particle speed
    .linkOpacity(getLinkOpacity)
    .onNodeHover(node => elem.style.cursor = node ? 'pointer' : null)
    .onNodeClick(handleNodeClick)
    .cooldownTicks(Infinity) // Keep physics engine running indefinitely
    .cooldownTime(15000) // Never stop the physics simulation
    .d3AlphaDecay(0.01) // Prevent alpha from decaying (keeps simulation active)
    .d3VelocityDecay(0.3); // Control velocity decay for smoother movement

  const linkForce = graph
    .d3Force('link')
    .distance(link => 150);

  // Mobile-specific optimizations
  if (isMobileDevice()) {
    graph
      .nodeResolution(8) // Lower resolution for better performance
      .linkDirectionalParticles(8) // Fewer particles for mobile performance
      .linkDirectionalParticleWidth(2) // Smaller particles
      .enableNodeDrag(false) // Disable node dragging on mobile for better touch interaction
      .enableNavigationControls(true); // Enable navigation controls for mobile camera control
      
    // Allow touch behaviors for camera control
    const graphElement = document.getElementById('3d-graph');
    
    // Only prevent multi-touch zoom, allow single touch for camera control
    graphElement.addEventListener('touchstart', (e) => {
      if (e.touches.length > 2) {
        e.preventDefault(); // Prevent 3+ finger gestures
      }
    }, { passive: false });
    
    // Allow two-finger gestures for zoom and rotation
    graphElement.addEventListener('touchmove', (e) => {
      // Allow all touch moves for camera control
    }, { passive: true });
  }
}

// Create node tooltip
function createNodeTooltip(n) {
  let tooltip = `<div style="background: rgba(0,0,0,0.9); color: white; padding: 12px; border-radius: 8px; font-family: 'Courier New', monospace; font-size: 12px; max-width: 400px; line-height: 1.4;">`;
  
  // Header with name and type
  tooltip += `<div style="color: #66ccff; font-weight: bold; font-size: 14px; margin-bottom: 8px;">${n.name}</div>`;
  tooltip += `<div style="color: #ffcc66; margin-bottom: 8px;">Type: ${n.type}</div>`;
  
  // Basic info
  if (n.namespace) {
    tooltip += `<div style="margin-bottom: 4px;"><span style="color: #99ff66;">Namespace:</span> ${n.namespace}</div>`;
  }
  
  if (n.age) {
    tooltip += `<div style="margin-bottom: 4px;"><span style="color: #99ff66;">Age:</span> ${n.age}</div>`;
  }
  
  if (n.status) {
    const statusColor = n.status === 'Running' || n.status.includes('Ready') ? '#44ff44' : 
                       n.status === 'Failed' || n.status.includes('Error') ? '#ff4444' : '#ff8844';
    tooltip += `<div style="margin-bottom: 4px;"><span style="color: #99ff66;">Status:</span> <span style="color: ${statusColor};">${n.status}</span></div>`;
  }
  
  if (n.statusmessage) {
    tooltip += `<div style="margin-bottom: 4px;"><span style="color: #99ff66;">Message:</span> ${n.statusmessage}</div>`;
  }
  
  // Resource-specific information
  if (n.resourceinfo) {
    tooltip += `<div style="border-top: 1px solid #444; margin-top: 8px; padding-top: 8px;">`;
    tooltip += getResourceSpecificInfo(n);
    tooltip += `</div>`;
  }
  
  // Labels (show first few)
  if (n.labels && Object.keys(n.labels).length > 0) {
    tooltip += `<div style="border-top: 1px solid #444; margin-top: 8px; padding-top: 8px;">`;
    tooltip += `<div style="color: #ffcc66; margin-bottom: 4px;">Labels:</div>`;
    const labelEntries = Object.entries(n.labels).slice(0, 3);
    labelEntries.forEach(([key, value]) => {
      tooltip += `<div style="font-size: 11px; color: #ccc; margin-left: 8px;">${key}: ${value}</div>`;
    });
    if (Object.keys(n.labels).length > 3) {
      tooltip += `<div style="font-size: 11px; color: #888; margin-left: 8px;">... and ${Object.keys(n.labels).length - 3} more</div>`;
    }
    tooltip += `</div>`;
  }
  
  tooltip += `</div>`;
  return tooltip;
}

// Get resource-specific information for tooltip
function getResourceSpecificInfo(n) {
  let info = '';
  
  // Pod-specific info
  if (n.type === 'pod') {
    if (n.resourceinfo.containers) info += `<div><span style="color: #cc66ff;">Containers:</span> ${n.resourceinfo.containers}</div>`;
    if (n.resourceinfo.restart_count !== undefined) info += `<div><span style="color: #cc66ff;">Restarts:</span> ${n.resourceinfo.restart_count}</div>`;
    if (n.resourceinfo.node_name) info += `<div><span style="color: #cc66ff;">Node:</span> ${n.resourceinfo.node_name}</div>`;
    if (n.resourceinfo.pod_ip) info += `<div><span style="color: #cc66ff;">Pod IP:</span> ${n.resourceinfo.pod_ip}</div>`;
    if (n.resourceinfo.qos_class) info += `<div><span style="color: #cc66ff;">QoS:</span> ${n.resourceinfo.qos_class}</div>`;
  }
  
  // Node-specific info
  if (n.type === 'node') {
    if (n.resourceinfo.cpu_capacity) info += `<div><span style="color: #cc66ff;">CPU:</span> ${n.resourceinfo.cpu_capacity}</div>`;
    if (n.resourceinfo.memory_capacity) info += `<div><span style="color: #cc66ff;">Memory:</span> ${n.resourceinfo.memory_capacity}</div>`;
    if (n.resourceinfo.storage_capacity) info += `<div><span style="color: #cc66ff;">Storage:</span> ${n.resourceinfo.storage_capacity}</div>`;
    if (n.resourceinfo.os_image) info += `<div><span style="color: #cc66ff;">OS:</span> ${n.resourceinfo.os_image}</div>`;
    if (n.resourceinfo.kernel_version) info += `<div><span style="color: #cc66ff;">Kernel:</span> ${n.resourceinfo.kernel_version}</div>`;
  }
  
  // Service-specific info
  if (n.type === 'service') {
    if (n.resourceinfo.service_type) info += `<div><span style="color: #cc66ff;">Service Type:</span> ${n.resourceinfo.service_type}</div>`;
    if (n.resourceinfo.cluster_ip) info += `<div><span style="color: #cc66ff;">Cluster IP:</span> ${n.resourceinfo.cluster_ip}</div>`;
    if (n.resourceinfo.ports) info += `<div><span style="color: #cc66ff;">Ports:</span> ${n.resourceinfo.ports}</div>`;
    if (n.resourceinfo.load_balancer_ip) info += `<div><span style="color: #cc66ff;">LB IP:</span> ${n.resourceinfo.load_balancer_ip}</div>`;
  }
  
  // ConfigMap-specific info
  if (n.type === 'configmap') {
    if (n.resourceinfo.total_keys) info += `<div><span style="color: #cc66ff;">Keys:</span> ${n.resourceinfo.total_keys}</div>`;
    if (n.resourceinfo.total_size_bytes) {
      const sizeKB = Math.round(n.resourceinfo.total_size_bytes / 1024);
      info += `<div><span style="color: #cc66ff;">Size:</span> ${sizeKB} KB</div>`;
    }
    if (n.resourceinfo.key_names && n.resourceinfo.key_names.length > 0) {
      info += `<div><span style="color: #cc66ff;">Keys:</span> ${n.resourceinfo.key_names.slice(0, 5).join(', ')}${n.resourceinfo.key_names.length > 5 ? '...' : ''}</div>`;
    }
  }
  
  // Secret-specific info
  if (n.type === 'secret') {
    if (n.resourceinfo.secret_type) info += `<div><span style="color: #cc66ff;">Secret Type:</span> ${n.resourceinfo.secret_type}</div>`;
    if (n.resourceinfo.total_keys) info += `<div><span style="color: #cc66ff;">Keys:</span> ${n.resourceinfo.total_keys}</div>`;
    if (n.resourceinfo.total_size_bytes) {
      const sizeKB = Math.round(n.resourceinfo.total_size_bytes / 1024);
      info += `<div><span style="color: #cc66ff;">Size:</span> ${sizeKB} KB</div>`;
    }
  }
  
  // Deployment/ReplicaSet/StatefulSet info
  if (n.type === 'deployment' || n.type === 'replicaset' || n.type === 'statefulset') {
    if (n.resourceinfo.desired_replicas !== undefined) info += `<div><span style="color: #cc66ff;">Desired:</span> ${n.resourceinfo.desired_replicas}</div>`;
    if (n.resourceinfo.ready_replicas !== undefined) info += `<div><span style="color: #cc66ff;">Ready:</span> ${n.resourceinfo.ready_replicas}</div>`;
    if (n.resourceinfo.available_replicas !== undefined) info += `<div><span style="color: #cc66ff;">Available:</span> ${n.resourceinfo.available_replicas}</div>`;
  }
  
  // DaemonSet info
  if (n.type === 'daemonset') {
    if (n.resourceinfo.desired_number_scheduled !== undefined) info += `<div><span style="color: #cc66ff;">Desired:</span> ${n.resourceinfo.desired_number_scheduled}</div>`;
    if (n.resourceinfo.number_ready !== undefined) info += `<div><span style="color: #cc66ff;">Ready:</span> ${n.resourceinfo.number_ready}</div>`;
    if (n.resourceinfo.number_available !== undefined) info += `<div><span style="color: #cc66ff;">Available:</span> ${n.resourceinfo.number_available}</div>`;
  }
  
  // Ingress info
  if (n.type === 'ingress') {
    if (n.resourceinfo.rules) info += `<div><span style="color: #cc66ff;">Rules:</span> ${n.resourceinfo.rules}</div>`;
    if (n.resourceinfo.tls) info += `<div><span style="color: #cc66ff;">TLS:</span> ${n.resourceinfo.tls}</div>`;
    if (n.resourceinfo.ingress_class) info += `<div><span style="color: #cc66ff;">Class:</span> ${n.resourceinfo.ingress_class}</div>`;
  }
  
  // EndpointSlice info
  if (n.type === 'endpointslice') {
    if (n.resourceinfo.endpoints) info += `<div><span style="color: #cc66ff;">Endpoints:</span> ${n.resourceinfo.endpoints}</div>`;
    if (n.resourceinfo.address_type) info += `<div><span style="color: #cc66ff;">Address Type:</span> ${n.resourceinfo.address_type}</div>`;
  }
  
  // ServiceAccount info
  if (n.type === 'serviceaccount') {
    if (n.resourceinfo.secrets) info += `<div><span style="color: #cc66ff;">Secrets:</span> ${n.resourceinfo.secrets}</div>`;
    if (n.resourceinfo.image_pull_secrets) info += `<div><span style="color: #cc66ff;">Image Pull Secrets:</span> ${n.resourceinfo.image_pull_secrets}</div>`;
  }
  
  // PersistentVolume info
  if (n.type === 'persistentvolume') {
    if (n.resourceinfo.capacity) info += `<div><span style="color: #cc66ff;">Capacity:</span> ${n.resourceinfo.capacity}</div>`;
    if (n.resourceinfo.access_modes) info += `<div><span style="color: #cc66ff;">Access Modes:</span> ${n.resourceinfo.access_modes}</div>`;
    if (n.resourceinfo.reclaim_policy) info += `<div><span style="color: #cc66ff;">Reclaim Policy:</span> ${n.resourceinfo.reclaim_policy}</div>`;
    if (n.resourceinfo.storage_class) info += `<div><span style="color: #cc66ff;">Storage Class:</span> ${n.resourceinfo.storage_class}</div>`;
    if (n.resourceinfo.volume_mode) info += `<div><span style="color: #cc66ff;">Volume Mode:</span> ${n.resourceinfo.volume_mode}</div>`;
    if (n.resourceinfo.claim_ref) info += `<div><span style="color: #cc66ff;">Claimed By:</span> ${n.resourceinfo.claim_ref}</div>`;
  }
  
  // PersistentVolumeClaim info
  if (n.type === 'persistentvolumeclaim') {
    if (n.resourceinfo.requested_storage) info += `<div><span style="color: #cc66ff;">Requested:</span> ${n.resourceinfo.requested_storage}</div>`;
    if (n.resourceinfo.access_modes) info += `<div><span style="color: #cc66ff;">Access Modes:</span> ${n.resourceinfo.access_modes}</div>`;
    if (n.resourceinfo.storage_class) info += `<div><span style="color: #cc66ff;">Storage Class:</span> ${n.resourceinfo.storage_class}</div>`;
    if (n.resourceinfo.volume_name) info += `<div><span style="color: #cc66ff;">Volume:</span> ${n.resourceinfo.volume_name}</div>`;
    if (n.resourceinfo.volume_mode) info += `<div><span style="color: #cc66ff;">Volume Mode:</span> ${n.resourceinfo.volume_mode}</div>`;
    if (n.resourceinfo.phase) info += `<div><span style="color: #cc66ff;">Phase:</span> ${n.resourceinfo.phase}</div>`;
  }
  
  return info;
}

// Get node color based on type and status
function getNodeColor(n) {
  if (n.type == "namespace") {
    return '#66ccff'; // Bright cyan for namespaces
  } else if (n.type == "domain") {
    return '#ff9900'; // Bright orange for domains
  } else if (n.type == "pod") {
    if (n.status === "Running") return '#44ff44'; // Bright green for running
    if (n.status === "Failed") return '#ff4444'; // Bright red for failed
    return '#ff8844'; // Bright orange for other states
  } else if (n.type == "node") {
    return '#4488ff'; // Bright blue for nodes
  } else if (n.type == "service") {
    return '#ff66cc'; // Bright magenta for services
  } else if (n.type == "ingress") {
    return '#ffcc66'; // Bright yellow for ingresses
  } else if (n.type == "endpointslice") {
    return '#cc66ff'; // Bright purple for endpoint slices
  } else if (n.type == "serviceaccount") {
    return '#66ffcc'; // Bright teal for service accounts
  } else if (n.type == "deployment") {
    return '#ff9966'; // Bright coral for deployments
  } else if (n.type == "replicaset") {
    return '#99ff66'; // Bright lime for replica sets
  } else if (n.type == "daemonset") {
    return '#6699ff'; // Bright sky blue for daemon sets
  } else if (n.type == "statefulset") {
    return '#ff6699'; // Bright pink for stateful sets
  } else if (n.type == "configmap") {
    return '#ccff66'; // Bright yellow-green for config maps
  } else if (n.type == "secret") {
    return '#ff6666'; // Bright red for secrets
  } else if (n.type == "persistentvolume") {
    return '#ffaa44'; // Bright orange for persistent volumes
  } else if (n.type == "persistentvolumeclaim") {
    return '#44aaff'; // Bright blue for persistent volume claims
  }
  return '#ffffff'; // Default white
}

// Create 3D object for nodes
function createNodeObject(n) {
  // Helper function to create a group with mesh and combined label
  function createNodeWithLabel(mesh, name, type, yOffset = -20) {
    const group = new THREE.Group();
    group.add(mesh);
    
    // Create combined name and type label
    const combinedLabel = `[${type}] ${name}`;
    const labelSprite = new SpriteText(combinedLabel);
    labelSprite.color = '#ffffff';
    labelSprite.textHeight = 3.5;
    labelSprite.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    labelSprite.padding = 3;
    labelSprite.borderRadius = 3;
    labelSprite.position.y = yOffset;
    labelSprite.fontFace = 'Arial, sans-serif';
    group.add(labelSprite);
    
    return group;
  }
  
  if (n.type == "domain") {
    // Bright orange diamond for domains - represents external access points
    var mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(12),
      new THREE.MeshPhongMaterial({
        color: 0xff9900,
        emissive: 0x442200,
        transparent: false,
        opacity: 1
    }))
    return createNodeWithLabel(mesh, n.name, n.type, -18);
  }
  if (n.type == "pod" && n.hasOwnProperty('status')
    && n.status != "Running" && n.status != "Succeeded") {
    // Bright red/orange for failed pods
    var mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(8),
      new THREE.MeshPhongMaterial({
        color: n.status === "Failed" ? 0xff4444 : 0xff8844,
        emissive: n.status === "Failed" ? 0x441111 : 0x442211,
        transparent: false,
        opacity: 1
    }))
    return createNodeWithLabel(mesh, n.name, n.type, -15);
  }
  if (n.type == "pod" && n.hasOwnProperty('status') && n.status == "Running") {
    // Bright green for running pods
    var mesh = new THREE.Mesh(
      new THREE.SphereGeometry(8),
      new THREE.MeshPhongMaterial({
        color: 0x44ff44,
        emissive: 0x114411,
        transparent: false,
        opacity: 1
    }))
    return createNodeWithLabel(mesh, n.name, n.type, -15);
  }
  if (n.type == "node") {
    // Bright blue for nodes
    var mesh = new THREE.Mesh(
      new THREE.BoxGeometry(20,20,20),
      new THREE.MeshPhongMaterial({
        color: 0x4488ff,
        emissive: 0x112244,
        transparent: false,
        opacity: 1
    }))
    return createNodeWithLabel(mesh, n.name, n.type, -20);
  }
  if (n.type == "service") {
    // Bright magenta cylinder for services
    var mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(8, 8, 16),
      new THREE.MeshPhongMaterial({
        color: 0xff66cc,
        emissive: 0x441133,
        transparent: false,
        opacity: 1
    }))
    return createNodeWithLabel(mesh, n.name, n.type, -18);
  }
  if (n.type == "ingress") {
    // Bright yellow cone for ingresses
    var mesh = new THREE.Mesh(
      new THREE.ConeGeometry(10, 16),
      new THREE.MeshPhongMaterial({
        color: 0xffcc66,
        emissive: 0x443311,
        transparent: false,
        opacity: 1
    }))
    return createNodeWithLabel(mesh, n.name, n.type, -18);
  }
  if (n.type == "endpointslice") {
    // Bright purple octahedron for endpoint slices
    var mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(6),
      new THREE.MeshPhongMaterial({
        color: 0xcc66ff,
        emissive: 0x331144,
        transparent: false,
        opacity: 1
    }))
    return createNodeWithLabel(mesh, n.name, n.type, -12);
  }
  if (n.type == "serviceaccount") {
    // Bright teal tetrahedron for service accounts
    var mesh = new THREE.Mesh(
      new THREE.TetrahedronGeometry(8),
      new THREE.MeshPhongMaterial({
        color: 0x66ffcc,
        emissive: 0x114433,
        transparent: false,
        opacity: 1
    }))
    return createNodeWithLabel(mesh, n.name, n.type, -15);
  }
  if (n.type == "deployment") {
    // Bright coral box for deployments
    var mesh = new THREE.Mesh(
      new THREE.BoxGeometry(14,14,14),
      new THREE.MeshPhongMaterial({
        color: 0xff9966,
        emissive: 0x442211,
        transparent: false,
        opacity: 1
    }))
    return createNodeWithLabel(mesh, n.name, n.type, -17);
  }
  if (n.type == "replicaset") {
    // Bright lime smaller box for replica sets
    var mesh = new THREE.Mesh(
      new THREE.BoxGeometry(10,10,10),
      new THREE.MeshPhongMaterial({
        color: 0x99ff66,
        emissive: 0x224411,
        transparent: false,
        opacity: 1
    }))
    return createNodeWithLabel(mesh, n.name, n.type, -15);
  }
  if (n.type == "daemonset") {
    // Bright sky blue ring for daemon sets
    var mesh = new THREE.Mesh(
      new THREE.TorusGeometry(8, 3),
      new THREE.MeshPhongMaterial({
        color: 0x6699ff,
        emissive: 0x112244,
        transparent: false,
        opacity: 1
    }))
    return createNodeWithLabel(mesh, n.name, n.type, -15);
  }
  if (n.type == "statefulset") {
    // Bright pink cylinder for stateful sets
    var mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 10, 16),
      new THREE.MeshPhongMaterial({
        color: 0xff6699,
        emissive: 0x441122,
        transparent: false,
        opacity: 1
    }))
    return createNodeWithLabel(mesh, n.name, n.type, -18);
  }
  if (n.type == "configmap") {
    // Bright yellow-green for config maps
    var mesh = new THREE.Mesh(
      new THREE.SphereGeometry(6),
      new THREE.MeshPhongMaterial({
        color: 0xccff66,
        emissive: 0x334411,
        transparent: false,
        opacity: 1
    }))
    return createNodeWithLabel(mesh, n.name, n.type, -12);
  }
  if (n.type == "secret") {
    // Bright red for secrets
    var mesh = new THREE.Mesh(
      new THREE.SphereGeometry(6),
      new THREE.MeshPhongMaterial({
        color: 0xff6666,
        emissive: 0x441111,
        transparent: false,
        opacity: 1
    }))
    return createNodeWithLabel(mesh, n.name, n.type, -12);
  }
  if (n.type == "persistentvolume") {
    // Bright orange for persistent volumes
    var mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(8, 8, 12),
      new THREE.MeshPhongMaterial({
        color: 0xffaa44,
        emissive: 0x442211,
        transparent: false,
        opacity: 1
    }))
    return createNodeWithLabel(mesh, n.name, n.type, -16);
  }
  if (n.type == "persistentvolumeclaim") {
    // Bright blue for persistent volume claims
    var mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 10),
      new THREE.MeshPhongMaterial({
        color: 0x44aaff,
        emissive: 0x112244,
        transparent: false,
        opacity: 1
    }))
    return createNodeWithLabel(mesh, n.name, n.type, -14);
  }
  
  // Default sphere for other types
  var mesh = new THREE.Mesh(
    new THREE.SphereGeometry(8),
    new THREE.MeshPhongMaterial({
      color: 0xffffff,
      emissive: 0x444444,
      transparent: false,
      opacity: 1
  }))
  return createNodeWithLabel(mesh, n.name, n.type, -15);
}

// Get link color based on relationship type
function getLinkColor(link) {
  switch(link.relationship) {
    case 'contains': return '#66ccff';       // Cyan for containment
    case 'instance_of': return '#44ff44';    // Green for instance relationships
    case 'depends_on': return '#ff6666';     // Red for dependencies
    case 'exposes': return '#ff66cc';        // Magenta for exposure
    case 'routes': return '#ffcc66';         // Yellow for routing
    case 'manages': return '#99ff66';        // Lime for management
    case 'runs': return '#6699ff';           // Blue for running on
    case 'accesses': return '#cc66ff';       // Purple for access
    case 'claims': return '#44aaff';         // Blue for PVC claiming PV
    default: return '#66ccff';               // Default cyan
  }
}

// Get link opacity based on relationship type
function getLinkOpacity(link) {
  switch(link.relationship) {
    case 'contains': return 0.8;     // Standard opacity for containment
    case 'instance_of': return 0.9;  // High opacity for instance relationships
    case 'depends_on': return 0.7;   // Lower opacity for dependencies
    case 'exposes': return 0.8;      // Standard opacity for exposure
    case 'routes': return 0.9;       // High opacity for routing
    case 'manages': return 0.8;      // Standard opacity for management
    case 'runs': return 0.7;         // Lower opacity for running on
    case 'accesses': return 0.9;     // High opacity for access
    case 'claims': return 0.8;       // Standard opacity for claims
    case 'binds_to': return 0.8;     // Standard opacity for binds
    default: return 0.8;             // Default opacity
  }
}

// Handle node click events
function handleNodeClick(node) {
  // Show detailed information in sidebar
  showResourceDetails(node);
  
  // Center and zoom to the clicked resource
  console.log(`Focusing on ${node.type}: ${node.name}`);
  
  // Move camera to center the node and zoom in closer
  const camera = graph.camera();
  const currentDistance = Math.hypot(
    camera.position.x - node.x,
    camera.position.y - node.y, 
    camera.position.z - node.z
  );
  
  // Calculate new camera position to center the node
  const direction = {
    x: camera.position.x - node.x,
    y: camera.position.y - node.y,
    z: camera.position.z - node.z
  };
  
  // Normalize direction
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length > 0) {
    direction.x /= length;
    direction.y /= length;
    direction.z /= length;
  }
  
  // Zoom in closer when clicking - use a smaller distance
  const zoomDistance = 150; // Closer zoom for detailed view
  const targetDistance = Math.min(currentDistance, zoomDistance);
  
  const newCameraPos = {
    x: node.x + direction.x * targetDistance,
    y: node.y + direction.y * targetDistance,
    z: node.z + direction.z * targetDistance
  };
  
  graph.cameraPosition(
    newCameraPos,
    node, // lookAt the clicked node
    1000  // ms transition duration - slightly faster for zoom
  );
}
