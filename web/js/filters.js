// Filter management functions

function filterGraphData(data) {
  // Filter nodes by resource type
  const filteredNodes = data.nodes.filter(node => !hiddenResourceTypes.has(node.type));
  const nodeIds = new Set(filteredNodes.map(node => node.id));
  
  // Debug logging for link filtering
  const allLinks = data.links || [];
  console.log('Filtering links:', {
    totalLinks: allLinks.length,
    visibleNodeIds: Array.from(nodeIds).slice(0, 5), // Show first 5 for debugging
    hiddenRelationshipTypes: Array.from(hiddenRelationshipTypes)
  });
  
  // Filter links by node visibility and relationship type
  const filteredLinks = allLinks.filter(link => {
    // Handle both string IDs and object references (3D graph converts strings to objects)
    const sourceId = typeof link.source === 'string' ? link.source : link.source?.id;
    const targetId = typeof link.target === 'string' ? link.target : link.target?.id;
    
    const sourceVisible = nodeIds.has(sourceId);
    const targetVisible = nodeIds.has(targetId);
    const relationshipVisible = !hiddenRelationshipTypes.has(link.relationship);
    
    const isVisible = sourceVisible && targetVisible && relationshipVisible;
    
    // Log first few link filtering decisions
    if (allLinks.indexOf(link) < 3) {
      console.log(`Link ${sourceId} -> ${targetId} (${link.relationship}):`, {
        sourceId,
        targetId,
        sourceVisible,
        targetVisible,
        relationshipVisible,
        isVisible
      });
    }
    
    return isVisible;
  });
  
  console.log('Link filtering result:', {
    inputLinks: allLinks.length,
    outputLinks: filteredLinks.length,
    filteredOut: allLinks.length - filteredLinks.length
  });
  
  return {
    nodes: filteredNodes,
    links: filteredLinks
  };
}

function applyFilterAndUpdate() {
  console.log('applyFilterAndUpdate called with originalData:', {
    hasOriginalData: !!originalData,
    originalNodes: originalData?.nodes?.length || 0,
    originalLinks: originalData?.links?.length || 0
  });
  
  if (!originalData) {
    console.warn('No originalData available for filtering');
    return;
  }
  
  // Show rendering dialog when filtering starts
  showRenderingDialog();
  
  // Use setTimeout to allow the dialog to render before starting the heavy filtering work
  setTimeout(() => {
    const filteredData = filterGraphData(originalData);
    
    if (!isInitialized) {
      // First time initialization
      graph.graphData(filteredData);
      currentFilteredData = JSON.parse(JSON.stringify(filteredData));
      hideRenderingDialog();
      return;
    }
    
    // For filter changes, do direct graph update (not incremental)
    // This ensures proper filtering without incremental update conflicts
    graph.graphData(filteredData);
    currentFilteredData = JSON.parse(JSON.stringify(filteredData));
    
    console.log('Filter applied:', {
      visibleNodes: filteredData.nodes.length,
      visibleLinks: filteredData.links.length,
      hiddenTypes: Array.from(hiddenResourceTypes),
      hiddenRelationships: Array.from(hiddenRelationshipTypes)
    });
    
    // Hide rendering dialog after a short delay to ensure graph has updated
    setTimeout(() => {
      hideRenderingDialog();
    }, 100);
  }, 100);
}

function toggleResourceType(type) {
  const legendItem = document.querySelector(`[data-type="${type}"]`);
  
  isUpdatingFromToggle = true;
  clearActivePreset(); // Clear active preset on manual toggle
  
  if (hiddenResourceTypes.has(type)) {
    hiddenResourceTypes.delete(type);
    legendItem.classList.remove('disabled');
  } else {
    hiddenResourceTypes.add(type);
    legendItem.classList.add('disabled');
  }
  
  // Apply filter and update graph
  applyFilterAndUpdate();
  
  // Clear any existing timeout and set a new one
  if (toggleTimeout) {
    clearTimeout(toggleTimeout);
  }
  
  // Reset flag after a delay to allow for any pending WebSocket updates
  toggleTimeout = setTimeout(() => {
    isUpdatingFromToggle = false;
    toggleTimeout = null;
  }, 150);
}

function showAllResourceTypes() {
  isUpdatingFromToggle = true;
  clearActivePreset(); // Clear active preset
  showRenderingDialog();
  
  setTimeout(() => {
    hiddenResourceTypes.clear();
    hiddenRelationshipTypes.clear(); // Also show all relationships
    document.querySelectorAll('.legend-item').forEach(item => {
      item.classList.remove('disabled');
    });
    applyFilterAndUpdate();
    
    if (toggleTimeout) {
      clearTimeout(toggleTimeout);
    }
    toggleTimeout = setTimeout(() => {
      isUpdatingFromToggle = false;
      toggleTimeout = null;
    }, 150);
  }, 10);
}

function hideAllResourceTypes() {
  isUpdatingFromToggle = true;
  clearActivePreset(); // Clear active preset
  showRenderingDialog();
  
  setTimeout(() => {
    document.querySelectorAll('.legend-item[data-type]').forEach(item => {
      const type = item.getAttribute('data-type');
      hiddenResourceTypes.add(type);
      item.classList.add('disabled');
    });
    
    // For hide all, we can directly set empty data since it's a complete clear
    currentFilteredData = { nodes: [], links: [] };
    graph.graphData({ nodes: [], links: [] });
    
    // Hide rendering dialog after clearing
    setTimeout(() => {
      hideRenderingDialog();
    }, 100);
    
    if (toggleTimeout) {
      clearTimeout(toggleTimeout);
    }
    toggleTimeout = setTimeout(() => {
      isUpdatingFromToggle = false;
      toggleTimeout = null;
    }, 150);
  }, 100);
}

function toggleRelationshipType(relationship) {
  const legendItem = document.querySelector(`[data-relationship="${relationship}"]`);
  
  isUpdatingFromToggle = true;
  clearActivePreset(); // Clear active preset on manual toggle
  
  if (hiddenRelationshipTypes.has(relationship)) {
    hiddenRelationshipTypes.delete(relationship);
    legendItem.classList.remove('disabled');
  } else {
    hiddenRelationshipTypes.add(relationship);
    legendItem.classList.add('disabled');
  }
  
  // Apply filter and update graph
  applyFilterAndUpdate();
  
  // Clear any existing timeout and set a new one
  if (toggleTimeout) {
    clearTimeout(toggleTimeout);
  }
  
  // Reset flag after a delay to allow for any pending WebSocket updates
  toggleTimeout = setTimeout(() => {
    isUpdatingFromToggle = false;
    toggleTimeout = null;
  }, 150);
}

function applyFilterPreset(presetKey) {
  const preset = filterPresets[presetKey];
  if (!preset) return;

  isUpdatingFromToggle = true;
  showRenderingDialog();

  setTimeout(() => {
    // Clear all current filters
    hiddenResourceTypes.clear();
    hiddenRelationshipTypes.clear();

    // Get all available resource types and relationship types
    const allResourceTypes = new Set();
    const allRelationshipTypes = new Set();
    
    if (originalData) {
      originalData.nodes.forEach(node => allResourceTypes.add(node.type));
      originalData.links.forEach(link => allRelationshipTypes.add(link.relationship));
    }

    // Hide resource types not in the preset
    allResourceTypes.forEach(type => {
      if (!preset.resourceTypes.includes(type)) {
        hiddenResourceTypes.add(type);
      }
    });

    // Hide relationship types not in the preset
    allRelationshipTypes.forEach(relationship => {
      if (!preset.relationshipTypes.includes(relationship)) {
        hiddenRelationshipTypes.add(relationship);
      }
    });

    // Update legend UI
    document.querySelectorAll('.legend-item[data-type]').forEach(item => {
      const type = item.getAttribute('data-type');
      if (hiddenResourceTypes.has(type)) {
        item.classList.add('disabled');
      } else {
        item.classList.remove('disabled');
      }
    });

    document.querySelectorAll('.legend-item[data-relationship]').forEach(item => {
      const relationship = item.getAttribute('data-relationship');
      if (hiddenRelationshipTypes.has(relationship)) {
        item.classList.add('disabled');
      } else {
        item.classList.remove('disabled');
      }
    });

    // Update preset button states
    document.querySelectorAll('.preset-button').forEach(btn => {
      btn.classList.remove('active');
    });
    document.getElementById(`preset-${presetKey}`).classList.add('active');
    activePreset = presetKey;

    // Apply the filter
    applyFilterAndUpdate();

    if (toggleTimeout) {
      clearTimeout(toggleTimeout);
    }
    toggleTimeout = setTimeout(() => {
      isUpdatingFromToggle = false;
      toggleTimeout = null;
    }, 150);

    console.log(`Applied ${preset.name} preset:`, {
      visibleResourceTypes: preset.resourceTypes,
      visibleRelationshipTypes: preset.relationshipTypes
    });
  }, 10);
}

function clearActivePreset() {
  if (activePreset) {
    document.querySelectorAll('.preset-button').forEach(btn => {
      btn.classList.remove('active');
    });
    activePreset = null;
  }
}

function initializeFilters() {
  // Add event listeners for legend interactions (with touch support)
  document.querySelectorAll('.legend-item[data-type]').forEach(item => {
    // Add both click and touch events for mobile compatibility
    const handleToggle = () => {
      const type = item.getAttribute('data-type');
      toggleResourceType(type);
    };
    
    item.addEventListener('click', handleToggle);
    item.addEventListener('touchend', (e) => {
      e.preventDefault(); // Prevent double-tap zoom
      handleToggle();
    });
  });

  // Add touch support for legend buttons
  const showAllBtn = document.getElementById('show-all');
  const hideAllBtn = document.getElementById('hide-all');
  
  showAllBtn.addEventListener('click', showAllResourceTypes);
  showAllBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    showAllResourceTypes();
  });
  
  hideAllBtn.addEventListener('click', hideAllResourceTypes);
  hideAllBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    hideAllResourceTypes();
  });

  // Add event listeners for relationship legend interactions (with touch support)
  document.querySelectorAll('.legend-item[data-relationship]').forEach(item => {
    const handleToggle = () => {
      const relationship = item.getAttribute('data-relationship');
      toggleRelationshipType(relationship);
    };
    
    item.addEventListener('click', handleToggle);
    item.addEventListener('touchend', (e) => {
      e.preventDefault(); // Prevent double-tap zoom
      handleToggle();
    });
  });

  // Add event listeners for preset buttons
  document.getElementById('preset-network').addEventListener('click', () => applyFilterPreset('network'));
  document.getElementById('preset-namespace').addEventListener('click', () => applyFilterPreset('namespace'));
  document.getElementById('preset-workload').addEventListener('click', () => applyFilterPreset('workload'));
  document.getElementById('preset-storage').addEventListener('click', () => applyFilterPreset('storage'));

  // Add touch support for preset buttons
  document.querySelectorAll('.preset-button').forEach(btn => {
    const presetKey = btn.id.replace('preset-', '');
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      applyFilterPreset(presetKey);
    });
  });
}

function initializeKeyboardShortcuts() {
  // Keyboard shortcuts
  document.addEventListener('keydown', (event) => {
    // Only handle shortcuts when not typing in an input field
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      return;
    }
    
    switch(event.key.toLowerCase()) {
      case 'a':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          showAllResourceTypes();
        }
        break;
      case 'h':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          hideAllResourceTypes();
        }
        break;
      case 'p':
        toggleResourceType('pod');
        break;
      case 's':
        toggleResourceType('service');
        break;
      case 'd':
        toggleResourceType('deployment');
        break;
      case 'n':
        toggleResourceType('node');
        break;
      case 'i':
        toggleResourceType('ingress');
        break;
      case 'c':
        toggleResourceType('configmap');
        break;
      case 'o':
        toggleResourceType('domain');
        break;
      case 'v':
        toggleResourceType('persistentvolume');
        break;
      case 'b':
        toggleResourceType('persistentvolumeclaim');
        break;
      case '1':
        applyFilterPreset('network');
        break;
      case '2':
        applyFilterPreset('namespace');
        break;
      case '3':
        applyFilterPreset('workload');
        break;
      case '4':
        applyFilterPreset('storage');
        break;
    }
  });
}
