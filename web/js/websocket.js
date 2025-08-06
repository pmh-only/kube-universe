// WebSocket functionality for live updates

function connectWebSocket() {
  updateStatus('Connecting...', '#FFC107');
  ws = new WebSocket(wsUrl);
  
  ws.onopen = function() {
    console.log('WebSocket connected');
    updateStatus('Connected (Live)', '#4CAF50');
    reconnectInterval = 1000; // Reset reconnect interval on successful connection
  };
  
  ws.onmessage = function(event) {
    try {
      const data = JSON.parse(event.data);
      const timestamp = new Date().toLocaleTimeString();
      
      // Hide loading overlay on first data received
      if (!isInitialized) {
        hideLoadingOverlay();
        isInitialized = true;
      }
      
      // Handle different message types
      if (data.type === 'delta') {
        console.log(`[${timestamp}] Received delta:`, {
          nodes: data.nodes?.length || 0,
          links: data.links?.length || 0,
          removedNodes: data.removed_nodes?.length || 0,
          removedLinks: data.removed_links?.length || 0
        });
        applyDeltaUpdate(data);
      } else {
        // Backward compatibility: treat as full update if no type specified
        console.log(`[${timestamp}] Received full data:`, data.nodes?.length, 'nodes,', data.links?.length, 'links');
        updateGraphData(data);
      }
      
      updateStatus(`Connected (Live) - ${timestamp}`, '#4CAF50');
    } catch (error) {
      console.error('Error parsing WebSocket data:', error);
      updateStatus('Data Error', '#F44336');
    }
  };
  
  ws.onclose = function() {
    console.log('WebSocket disconnected, attempting to reconnect...');
    updateStatus('Reconnecting...', '#FF9800');
    setTimeout(connectWebSocket, reconnectInterval);
    reconnectInterval = Math.min(reconnectInterval * 2, maxReconnectInterval);
  };
  
  ws.onerror = function(error) {
    console.error('WebSocket error:', error);
    updateStatus('Connection Error', '#F44336');
  };
}

function applyDeltaUpdate(deltaData) {
  const startTime = performance.now();
  
  if (!originalData) {
    console.warn('No original data available for delta update, treating as full update');
    updateGraphData({ nodes: deltaData.nodes || [], links: deltaData.links || [] });
    return;
  }
  
  // Apply delta changes to original data
  const updatedOriginalData = applyDeltaToOriginalData(deltaData);
  
  // Update resource and relationship counts
  updateResourceCounts(updatedOriginalData);
  updateRelationshipCounts(updatedOriginalData);
  
  // If we're currently updating from a toggle action, skip the graph update
  if (isUpdatingFromToggle) {
    console.log('Skipping delta graph update - toggle in progress');
    return;
  }
  
  // Apply filtering to the updated data
  const filteredData = filterGraphData(updatedOriginalData);
  
  // Apply delta changes directly to the graph
  applyDeltaToGraph(deltaData, filteredData);
  
  logUpdatePerformance('delta', startTime, {
    nodes: deltaData.nodes?.length || 0,
    links: deltaData.links?.length || 0,
    removedNodes: deltaData.removed_nodes?.length || 0,
    removedLinks: deltaData.removed_links?.length || 0,
    filteredNodes: filteredData.nodes.length,
    filteredLinks: filteredData.links.length
  });
}

function applyDeltaToOriginalData(deltaData) {
  // Create a deep copy to avoid modifying the original reference
  const updatedData = {
    nodes: [...originalData.nodes],
    links: [...originalData.links]
  };
  
  // Remove nodes
  if (deltaData.removed_nodes && deltaData.removed_nodes.length > 0) {
    const removedNodeIds = new Set(deltaData.removed_nodes.map(n => n.id || n));
    updatedData.nodes = updatedData.nodes.filter(n => !removedNodeIds.has(n.id));
    
    // Remove associated links
    updatedData.links = updatedData.links.filter(l => 
      !removedNodeIds.has(l.source) && !removedNodeIds.has(l.target)
    );
  }
  
  // Remove specific links
  if (deltaData.removed_links && deltaData.removed_links.length > 0) {
    const removedLinkKeys = new Set(deltaData.removed_links.map(l => `${l.source}-${l.target}`));
    updatedData.links = updatedData.links.filter(l => {
      const linkKey = `${l.source}-${l.target}`;
      return !removedLinkKeys.has(linkKey);
    });
  }
  
  // Add or update nodes
  if (deltaData.nodes && deltaData.nodes.length > 0) {
    const nodeMap = new Map(updatedData.nodes.map(n => [n.id, n]));
    
    deltaData.nodes.forEach(newNode => {
      const existingNode = nodeMap.get(newNode.id);
      if (existingNode) {
        // Update existing node
        Object.assign(existingNode, newNode);
      } else {
        // Add new node
        updatedData.nodes.push(newNode);
      }
    });
  }
  
  // Add new links
  if (deltaData.links && deltaData.links.length > 0) {
    const existingLinkKeys = new Set(updatedData.links.map(l => `${l.source}-${l.target}`));
    
    deltaData.links.forEach(newLink => {
      const linkKey = `${newLink.source}-${newLink.target}`;
      if (!existingLinkKeys.has(linkKey)) {
        updatedData.links.push(newLink);
      }
    });
  }
  
  // Update original data reference
  originalData = updatedData;
  return updatedData;
}

function applyDeltaToGraph(deltaData, filteredData) {
  const currentGraphData = graph.graphData();
  const currentNodes = [...currentGraphData.nodes];
  const currentLinks = [...currentGraphData.links];
  
  let graphChanged = false;
  
  // Remove nodes from graph (and their links)
  if (deltaData.removed_nodes && deltaData.removed_nodes.length > 0) {
    const removedNodeIds = new Set(deltaData.removed_nodes.map(n => n.id || n));
    
    // Remove nodes
    for (let i = currentNodes.length - 1; i >= 0; i--) {
      if (removedNodeIds.has(currentNodes[i].id)) {
        currentNodes.splice(i, 1);
        graphChanged = true;
      }
    }
    
    // Remove associated links
    for (let i = currentLinks.length - 1; i >= 0; i--) {
      const link = currentLinks[i];
      const sourceId = link.source.id || link.source;
      const targetId = link.target.id || link.target;
      if (removedNodeIds.has(sourceId) || removedNodeIds.has(targetId)) {
        currentLinks.splice(i, 1);
        graphChanged = true;
      }
    }
  }
  
  // Remove specific links
  if (deltaData.removed_links && deltaData.removed_links.length > 0) {
    const removedLinkKeys = new Set(deltaData.removed_links.map(l => `${l.source}-${l.target}`));
    
    for (let i = currentLinks.length - 1; i >= 0; i--) {
      const link = currentLinks[i];
      const sourceId = link.source.id || link.source;
      const targetId = link.target.id || link.target;
      const linkKey = `${sourceId}-${targetId}`;
      
      if (removedLinkKeys.has(linkKey)) {
        currentLinks.splice(i, 1);
        graphChanged = true;
      }
    }
  }
  
  // Add or update nodes (only if they pass the filter)
  if (deltaData.nodes && deltaData.nodes.length > 0) {
    const filteredNodeIds = new Set(filteredData.nodes.map(n => n.id));
    const currentNodeMap = new Map(currentNodes.map(n => [n.id, n]));
    
    deltaData.nodes.forEach(newNode => {
      // Only add/update if the node passes the current filter
      if (filteredNodeIds.has(newNode.id)) {
        const existingNode = currentNodeMap.get(newNode.id);
        if (existingNode) {
          // Update existing node properties
          Object.assign(existingNode, newNode);
        } else {
          // Add new node
          currentNodes.push(newNode);
          graphChanged = true;
        }
      }
    });
  }
  
  // Add new links (only if both nodes are visible)
  if (deltaData.links && deltaData.links.length > 0) {
    const visibleNodeIds = new Set(currentNodes.map(n => n.id));
    const existingLinkKeys = new Set(currentLinks.map(l => {
      const sourceId = l.source.id || l.source;
      const targetId = l.target.id || l.target;
      return `${sourceId}-${targetId}`;
    }));
    
    deltaData.links.forEach(newLink => {
      const linkKey = `${newLink.source}-${newLink.target}`;
      
      // Only add if both nodes are visible and link doesn't exist
      if (visibleNodeIds.has(newLink.source) && 
          visibleNodeIds.has(newLink.target) && 
          !existingLinkKeys.has(linkKey) &&
          !hiddenRelationshipTypes.has(newLink.relationship)) {
        currentLinks.push(newLink);
        graphChanged = true;
      }
    });
  }
  
  // Update graph if changes were made
  if (graphChanged) {
    graph.graphData({
      nodes: currentNodes,
      links: currentLinks
    });
    
    // Update cached filtered data
    currentFilteredData = {
      nodes: [...currentNodes],
      links: [...currentLinks]
    };
  }
}

function updateGraphData(newData) {
  // Quick check if data is identical to avoid unnecessary processing
  if (originalData && JSON.stringify(originalData) === JSON.stringify(newData)) {
    console.log('Identical data received, skipping update');
    return;
  }
  
  // Store original data for filtering
  originalData = JSON.parse(JSON.stringify(newData));
  
  // Update resource and relationship counts (this is always safe to do)
  updateResourceCounts(newData);
  updateRelationshipCounts(newData);
  
  // If we're currently updating from a toggle action, skip the graph update
  // to prevent the flash. The toggle function has already updated the graph.
  if (isUpdatingFromToggle) {
    console.log('Skipping graph update - toggle in progress');
    return;
  }
  
  const filteredData = filterGraphData(newData);
  
  if (!isInitialized) {
    // Show rendering dialog for initial graph load
    showRenderingDialog();
    
    // Use setTimeout to allow rendering dialog to show before heavy graph rendering
    setTimeout(() => {
      // First time - load filtered data
      const startTime = performance.now();
      graph.graphData(filteredData);
      currentFilteredData = JSON.parse(JSON.stringify(filteredData));
      isInitialized = true;
      
      // Hide both loading overlay and rendering dialog
      hideLoadingOverlay();
      setTimeout(() => {
        hideRenderingDialog();
      }, 200); // Small delay to ensure graph has rendered
      
      logUpdatePerformance('full-initial', startTime, {
        totalNodes: filteredData.nodes.length,
        totalLinks: filteredData.links.length
      });
    }, 50);
    return;
  }

  // Perform incremental update using the current graph data
  performIncrementalUpdate(filteredData);
}

function performIncrementalUpdate(newFilteredData) {
  const startTime = performance.now();
  
  // Get current graph data directly from the graph instance
  const currentGraphData = graph.graphData();
  const currentNodes = currentGraphData.nodes || [];
  const currentLinks = currentGraphData.links || [];
  const newNodes = newFilteredData.nodes || [];
  const newLinks = newFilteredData.links || [];

  // Create maps for efficient lookups
  const currentNodeMap = new Map(currentNodes.map(n => [n.id, n]));
  const newNodeMap = new Map(newNodes.map(n => [n.id, n]));
  const currentLinkMap = new Map(currentLinks.map(l => [`${l.source.id || l.source}-${l.target.id || l.target}`, l]));
  const newLinkMap = new Map(newLinks.map(l => [`${l.source}-${l.target}`, l]));

  // Track changes
  const nodesToAdd = [];
  const nodesToUpdate = [];
  const nodesToRemove = [];
  const linksToAdd = [];
  const linksToRemove = [];

  // Find nodes to add or update
  newNodes.forEach(newNode => {
    const currentNode = currentNodeMap.get(newNode.id);
    if (!currentNode) {
      nodesToAdd.push(newNode);
    } else if (!nodeEquals(currentNode, newNode)) {
      // Update existing node properties in place
      Object.assign(currentNode, newNode);
      nodesToUpdate.push(currentNode);
    }
  });

  // Find nodes to remove
  currentNodes.forEach(currentNode => {
    if (!newNodeMap.has(currentNode.id)) {
      nodesToRemove.push(currentNode);
    }
  });

  // Find links to add
  newLinks.forEach(newLink => {
    const linkKey = `${newLink.source}-${newLink.target}`;
    if (!currentLinkMap.has(linkKey)) {
      linksToAdd.push(newLink);
    }
  });

  // Find links to remove
  currentLinks.forEach(currentLink => {
    const sourceId = currentLink.source.id || currentLink.source;
    const targetId = currentLink.target.id || currentLink.target;
    const linkKey = `${sourceId}-${targetId}`;
    if (!newLinkMap.has(linkKey)) {
      linksToRemove.push(currentLink);
    }
  });

  // Apply incremental changes
  let hasStructuralChanges = nodesToAdd.length > 0 || nodesToRemove.length > 0 || 
                           linksToAdd.length > 0 || linksToRemove.length > 0;
  let hasPropertyChanges = nodesToUpdate.length > 0;

  const changeDetails = {
    nodesToAdd: nodesToAdd.length,
    nodesToUpdate: nodesToUpdate.length,
    nodesToRemove: nodesToRemove.length,
    linksToAdd: linksToAdd.length,
    linksToRemove: linksToRemove.length,
    totalNodes: newNodes.length,
    totalLinks: newLinks.length
  };

  if (hasStructuralChanges || hasPropertyChanges) {
    if (hasStructuralChanges) {
      // For structural changes, we need to update the entire graph data
      // but the 3d-force-graph library will handle incremental rendering internally
      const updatedNodes = [...currentNodes];
      const updatedLinks = [...currentLinks];

      // Remove nodes and their associated links
      nodesToRemove.forEach(nodeToRemove => {
        const nodeIndex = updatedNodes.findIndex(n => n.id === nodeToRemove.id);
        if (nodeIndex !== -1) {
          updatedNodes.splice(nodeIndex, 1);
        }
      });

      // Remove links
      linksToRemove.forEach(linkToRemove => {
        const sourceId = linkToRemove.source.id || linkToRemove.source;
        const targetId = linkToRemove.target.id || linkToRemove.target;
        const linkIndex = updatedLinks.findIndex(l => {
          const lSourceId = l.source.id || l.source;
          const lTargetId = l.target.id || l.target;
          return lSourceId === sourceId && lTargetId === targetId;
        });
        if (linkIndex !== -1) {
          updatedLinks.splice(linkIndex, 1);
        }
      });

      // Add new nodes
      updatedNodes.push(...nodesToAdd);

      // Add new links
      updatedLinks.push(...linksToAdd);

      // Update graph with new structure
      graph.graphData({
        nodes: updatedNodes,
        links: updatedLinks
      });
      
      logUpdatePerformance('incremental-structural', startTime, changeDetails);
    } else if (hasPropertyChanges) {
      // For property-only changes, trigger a refresh without changing structure
      // The node properties have already been updated in place above
      graph.refresh();
      
      logUpdatePerformance('incremental-properties', startTime, changeDetails);
    }

    // Update our cached filtered data
    currentFilteredData = JSON.parse(JSON.stringify(newFilteredData));
  } else {
    logUpdatePerformance('incremental-no-changes', startTime, changeDetails);
  }
}
