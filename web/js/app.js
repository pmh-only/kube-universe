// Global variables
let hiddenResourceTypes = new Set(['namespace', 'configmap', 'secret', 'serviceaccount']); // Hide namespaces by default
let hiddenRelationshipTypes = new Set(); // Track hidden relationship types
let originalData = { nodes: [], links: [] };
let currentFilteredData = { nodes: [], links: [] };
let isUpdatingFromToggle = false;
let toggleTimeout = null;
let isInitialized = false;

// WebSocket variables
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}/ws`;
const statusDiv = document.getElementById('connection-status');
let ws;
let reconnectInterval = 1000;
const maxReconnectInterval = 30000;
let currentData = { nodes: [], links: [] };

// Performance monitoring
let updateStats = {
  totalUpdates: 0,
  incrementalUpdates: 0,
  fullUpdates: 0,
  deltaUpdates: 0,
  lastUpdateTime: 0
};

// Filter presets
const filterPresets = {
  network: {
    name: 'Network Constellation View',
    resourceTypes: ['domain', 'pod', 'service', 'ingress', 'endpointslice', 'namespace'],
    relationshipTypes: ['exposes', 'routes', 'depends_on', 'contains', 'accesses']
  },
  namespace: {
    name: 'Namespace Bulbs',
    resourceTypes: ['namespace', 'pod', 'deployment', 'replicaset', 'daemonset', 'statefulset'],
    relationshipTypes: ['contains', 'manages', 'instance_of']
  },
  workload: {
    name: 'Workload View',
    resourceTypes: ['pod', 'deployment', 'replicaset', 'daemonset', 'statefulset', 'node'],
    relationshipTypes: ['manages', 'instance_of', 'runs']
  },
  storage: {
    name: 'Storage & Config View',
    resourceTypes: ['pod', 'configmap', 'secret', 'serviceaccount', 'persistentvolume', 'persistentvolumeclaim'],
    relationshipTypes: ['accesses', 'depends_on', 'claims', 'binds_to']
  }
};

let activePreset = null;

// Utility functions
function updateStatus(status, color) {
  statusDiv.textContent = status;
  statusDiv.style.backgroundColor = color;
  statusDiv.style.color = color === '#4CAF50' ? 'white' : 'black';
}

function nodeEquals(a, b) {
  return a.id === b.id && 
         a.name === b.name && 
         a.type === b.type && 
         a.namespace === b.namespace && 
         a.status === b.status && 
         a.statusmessage === b.statusmessage;
}

function linkEquals(a, b) {
  return a.source === b.source && 
         a.target === b.target && 
         a.value === b.value;
}

function hideLoadingOverlay() {
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay && !loadingOverlay.classList.contains('hidden')) {
    loadingOverlay.classList.add('hidden');
    console.log('Loading overlay hidden - graph data received');
  }
}

function showRenderingDialog() {
  const renderingDialog = document.getElementById('rendering-dialog');
  if (renderingDialog) {
    renderingDialog.classList.add('visible');
  }
}

function hideRenderingDialog() {
  const renderingDialog = document.getElementById('rendering-dialog');
  if (renderingDialog) {
    renderingDialog.classList.remove('visible');
  }
}

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
         (window.innerWidth <= 768);
}

// Resource and relationship count functions
function updateResourceCounts(data) {
  const counts = {};
  data.nodes.forEach(node => {
    counts[node.type] = (counts[node.type] || 0) + 1;
  });
  
  Object.keys(counts).forEach(type => {
    const countElement = document.getElementById(`count-${type}`);
    if (countElement) {
      countElement.textContent = counts[type];
    }
  });
  
  // Reset counts for types not present
  document.querySelectorAll('.resource-count').forEach(el => {
    const type = el.id.replace('count-', '');
    if (!counts[type]) {
      el.textContent = '0';
    }
  });
}

function updateRelationshipCounts(data) {
  const relationshipCounts = {};
  data.links.forEach(link => {
    const rel = link.relationship || 'unknown';
    relationshipCounts[rel] = (relationshipCounts[rel] || 0) + 1;
  });
  
  Object.keys(relationshipCounts).forEach(rel => {
    const countElement = document.getElementById(`count-${rel}`);
    if (countElement) {
      countElement.textContent = relationshipCounts[rel];
    }
  });
  
  // Reset counts for relationships not present
  document.querySelectorAll('.relationship-count').forEach(el => {
    const rel = el.id.replace('count-', '');
    if (!relationshipCounts[rel]) {
      el.textContent = '0';
    }
  });
}

// Performance monitoring
function logUpdatePerformance(updateType, startTime, details = {}) {
  const duration = performance.now() - startTime;
  updateStats.totalUpdates++;
  updateStats.lastUpdateTime = duration;
  
  if (updateType === 'delta') {
    updateStats.deltaUpdates++;
  } else if (updateType.startsWith('incremental')) {
    updateStats.incrementalUpdates++;
  } else {
    updateStats.fullUpdates++;
  }
  
  console.log(`${updateType} update completed in ${duration.toFixed(2)}ms`, details);
  
  // Log stats every 10 updates
  if (updateStats.totalUpdates % 10 === 0) {
    console.log('Update performance stats:', {
      total: updateStats.totalUpdates,
      delta: updateStats.deltaUpdates,
      incremental: updateStats.incrementalUpdates,
      full: updateStats.fullUpdates,
      deltaRatio: `${((updateStats.deltaUpdates / updateStats.totalUpdates) * 100).toFixed(1)}%`,
      avgLastUpdateTime: `${updateStats.lastUpdateTime.toFixed(2)}ms`
    });
  }
}

// Sidebar functionality
function showResourceDetails(node) {
  const sidebar = document.getElementById('sidebar');
  const resourceName = document.getElementById('sidebar-resource-name');
  const resourceType = document.getElementById('sidebar-resource-type');
  const sidebarContent = document.getElementById('sidebar-content');
  
  // Update header
  resourceName.textContent = node.name;
  resourceType.textContent = `${node.type.charAt(0).toUpperCase() + node.type.slice(1)} Resource`;
  
  // Build detailed content
  let content = '';
  
  // Basic Information Section
  content += '<div class="sidebar-section">';
  content += '<div class="sidebar-section-title">Basic Information</div>';
  content += `<div class="sidebar-item"><span class="sidebar-label">Name:</span><span class="sidebar-value">${node.name}</span></div>`;
  content += `<div class="sidebar-item"><span class="sidebar-label">Type:</span><span class="sidebar-value">${node.type}</span></div>`;
  if (node.namespace) {
    content += `<div class="sidebar-item"><span class="sidebar-label">Namespace:</span><span class="sidebar-value">${node.namespace}</span></div>`;
  }
  if (node.age) {
    content += `<div class="sidebar-item"><span class="sidebar-label">Age:</span><span class="sidebar-value">${node.age}</span></div>`;
  }
  if (node.creationtime) {
    const date = new Date(node.creationtime);
    content += `<div class="sidebar-item"><span class="sidebar-label">Created:</span><span class="sidebar-value">${date.toLocaleString()}</span></div>`;
  }
  content += '</div>';
  
  // Status Section
  if (node.status || node.statusmessage) {
    content += '<div class="sidebar-section">';
    content += '<div class="sidebar-section-title">Status</div>';
    if (node.status) {
      const statusClass = node.status === 'Running' || node.status.includes('Ready') ? 'status-running' : 
                         node.status === 'Failed' || node.status.includes('Error') ? 'status-failed' : 
                         node.status.includes('Pending') ? 'status-pending' : 'status-default';
      content += `<div class="sidebar-item"><span class="sidebar-label">Status:</span><span class="sidebar-status ${statusClass}">${node.status}</span></div>`;
    }
    if (node.statusmessage) {
      content += `<div class="sidebar-item"><span class="sidebar-label">Message:</span><span class="sidebar-value">${node.statusmessage}</span></div>`;
    }
    content += '</div>';
  }
  
  // Resource-specific Information
  if (node.resourceinfo && Object.keys(node.resourceinfo).length > 0) {
    content += '<div class="sidebar-section">';
    content += '<div class="sidebar-section-title">Resource Details</div>';
    
    Object.entries(node.resourceinfo).forEach(([key, value]) => {
      if (key === 'key_names' && Array.isArray(value)) {
        content += `<div class="sidebar-item"><span class="sidebar-label">${formatLabel(key)}:</span><div class="sidebar-labels">`;
        value.forEach(keyName => {
          content += `<span class="sidebar-label-item">${keyName}</span>`;
        });
        content += '</div></div>';
      } else if (key === 'conditions' && Array.isArray(value)) {
        content += `<div class="sidebar-item"><span class="sidebar-label">${formatLabel(key)}:</span><div class="sidebar-labels">`;
        value.forEach(condition => {
          content += `<span class="sidebar-label-item">${condition}</span>`;
        });
        content += '</div></div>';
      } else if (key === 'port_details' && Array.isArray(value)) {
        content += `<div class="sidebar-item"><span class="sidebar-label">Ports:</span></div>`;
        value.forEach(port => {
          content += `<div class="sidebar-item" style="margin-left: 20px;">`;
          content += `<span class="sidebar-value">${port.name || 'unnamed'}: ${port.port}`;
          if (port.target_port) content += ` → ${port.target_port}`;
          if (port.protocol) content += ` (${port.protocol})`;
          if (port.node_port) content += ` [NodePort: ${port.node_port}]`;
          content += `</span></div>`;
        });
      } else if (typeof value === 'object' && value !== null) {
        content += `<div class="sidebar-item"><span class="sidebar-label">${formatLabel(key)}:</span><span class="sidebar-value">${JSON.stringify(value)}</span></div>`;
      } else {
        content += `<div class="sidebar-item"><span class="sidebar-label">${formatLabel(key)}:</span><span class="sidebar-value">${value}</span></div>`;
      }
    });
    content += '</div>';
  }
  
  // Labels Section
  if (node.labels && Object.keys(node.labels).length > 0) {
    content += '<div class="sidebar-section">';
    content += '<div class="sidebar-section-title">Labels</div>';
    content += '<div class="sidebar-labels">';
    Object.entries(node.labels).forEach(([key, value]) => {
      content += `<span class="sidebar-label-item">${key}: ${value}</span>`;
    });
    content += '</div>';
    content += '</div>';
  }
  
  // Annotations Section (show first few)
  if (node.annotations && Object.keys(node.annotations).length > 0) {
    content += '<div class="sidebar-section">';
    content += '<div class="sidebar-section-title">Annotations</div>';
    const annotationEntries = Object.entries(node.annotations).slice(0, 5);
    annotationEntries.forEach(([key, value]) => {
      const truncatedValue = value.length > 100 ? value.substring(0, 100) + '...' : value;
      content += `<div class="sidebar-item"><span class="sidebar-label">${key}:</span><span class="sidebar-value">${truncatedValue}</span></div>`;
    });
    if (Object.keys(node.annotations).length > 5) {
      content += `<div class="sidebar-item"><span class="sidebar-value" style="color: #666;">... and ${Object.keys(node.annotations).length - 5} more annotations</span></div>`;
    }
    content += '</div>';
  }
  
  sidebarContent.innerHTML = content;
  sidebar.classList.add('open');
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.remove('open');
  
  // Zoom out while maintaining current viewing angle
  const camera = graph.camera();
  const currentPos = camera.position;
  
  // Calculate center of all nodes to determine what we're looking at
  const graphData = graph.graphData();
  if (graphData.nodes && graphData.nodes.length > 0) {
    let centerX = 0, centerY = 0, centerZ = 0;
    let nodeCount = 0;
    
    graphData.nodes.forEach(node => {
      if (node.x !== undefined && node.y !== undefined && node.z !== undefined) {
        centerX += node.x;
        centerY += node.y;
        centerZ += node.z;
        nodeCount++;
      }
    });
    
    if (nodeCount > 0) {
      centerX /= nodeCount;
      centerY /= nodeCount;
      centerZ /= nodeCount;
      
      // Calculate current direction from center to camera
      const direction = {
        x: currentPos.x - centerX,
        y: currentPos.y - centerY,
        z: currentPos.z - centerZ
      };
      
      // Normalize direction to maintain viewing angle
      const currentDistance = Math.hypot(direction.x, direction.y, direction.z);
      if (currentDistance > 0) {
        direction.x /= currentDistance;
        direction.y /= currentDistance;
        direction.z /= currentDistance;
      }
      
      // Zoom out to a comfortable overview distance while keeping the same angle
      const zoomOutDistance = Math.max(currentDistance * 1.8, 1000); // Zoom out by 80% or minimum 250 units
      
      const newCameraPos = {
        x: centerX + direction.x * zoomOutDistance,
        y: centerY + direction.y * zoomOutDistance,
        z: centerZ + direction.z * zoomOutDistance
      };
      
      graph.cameraPosition(
        newCameraPos,
        { x: centerX, y: centerY, z: centerZ }, // Still look at center
        1200 // ms transition duration - slightly faster
      );
    }
  }
}

function formatLabel(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// Mobile legend functionality
const legendToggle = document.getElementById('legend-toggle');
const legend = document.getElementById('legend');
let legendOpen = false;

function toggleMobileLegend() {
  legendOpen = !legendOpen;
  if (legendOpen) {
    legend.classList.add('mobile-open');
    legendToggle.textContent = '✕ Close';
  } else {
    legend.classList.remove('mobile-open');
    legendToggle.textContent = '☰ Controls';
  }
}

// Initialize event listeners
function initializeEventListeners() {
  // Sidebar close button
  const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
  sidebarCloseBtn.addEventListener('click', closeSidebar);
  sidebarCloseBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    closeSidebar();
  });

  // Mobile legend toggle
  legendToggle.addEventListener('click', toggleMobileLegend);
  legendToggle.addEventListener('touchend', (e) => {
    e.preventDefault();
    toggleMobileLegend();
  });

  // Close sidebar when clicking/touching outside
  function handleOutsideInteraction(event) {
    const sidebar = document.getElementById('sidebar');
    const isInsideSidebar = sidebar.contains(event.target);
    const isOnResource = event.target.closest('#3d-graph');
    
    if (!isInsideSidebar && !isOnResource && sidebar.classList.contains('open')) {
      closeSidebar();
    }
  }
  
  document.addEventListener('click', handleOutsideInteraction);
  document.addEventListener('touchend', handleOutsideInteraction);

  // Close mobile legend when clicking outside
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && legendOpen && 
        !legend.contains(e.target) && 
        !legendToggle.contains(e.target)) {
      toggleMobileLegend();
    }
  });

  // Window resize handler
  let resizeTimeout;
  function handleResize() {
    if (resizeTimeout) {
      clearTimeout(resizeTimeout);
    }
    
    resizeTimeout = setTimeout(() => {
      graph.width(window.innerWidth).height(window.innerHeight);
      console.log(`Graph resized to: ${window.innerWidth}x${window.innerHeight}`);
      
      if (window.innerWidth > 768 && legendOpen) {
        legend.classList.remove('mobile-open');
        legendOpen = false;
        legendToggle.textContent = '☰ Controls';
      }
      
      resizeTimeout = null;
    }, 100);
  }

  window.addEventListener('resize', handleResize);
}

// Initialize the application
function initializeApp() {
  initializeEventListeners();
  initializeGraph();
  initializeFilters();
  initializeKeyboardShortcuts();
  connectWebSocket();
  
  // Set initial graph size
  graph.width(window.innerWidth).height(window.innerHeight);
}

// Debug functions
window.restartPhysics = function() {
  graph.d3ReheatSimulation();
  console.log('Physics engine restarted manually');
};

window.getPhysicsStatus = function() {
  const simulation = graph.d3Force('center');
  if (simulation && simulation.alpha) {
    const alpha = simulation.alpha();
    const status = {
      alpha: alpha,
      isRunning: alpha > 0.005,
      nodes: graph.graphData().nodes.length,
      links: graph.graphData().links.length
    };
    console.log('Physics Status:', status);
    return status;
  }
  return { error: 'Physics engine not available' };
};

// Start the application when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);
