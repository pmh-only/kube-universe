package delta

import (
	"encoding/json"
	"fmt"
	"log"
	"reflect"

	kutype "github.com/afritzler/kube-universe/pkg/types"
)

// DeltaUpdate represents a delta update message
type DeltaUpdate struct {
	Type         string        `json:"type"`
	Nodes        []kutype.Node `json:"nodes,omitempty"`
	Links        []kutype.Link `json:"links,omitempty"`
	RemovedNodes []string      `json:"removed_nodes,omitempty"`
	RemovedLinks []LinkRef     `json:"removed_links,omitempty"`
}

// LinkRef represents a link reference for removal
type LinkRef struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

// DeltaTracker tracks changes between graph states
type DeltaTracker struct {
	previousNodes map[string]kutype.Node
	previousLinks map[string]kutype.Link
}

// NewDeltaTracker creates a new delta tracker
func NewDeltaTracker() *DeltaTracker {
	return &DeltaTracker{
		previousNodes: make(map[string]kutype.Node),
		previousLinks: make(map[string]kutype.Link),
	}
}

// GenerateDelta compares current graph with previous state and generates a delta
func (dt *DeltaTracker) GenerateDelta(currentGraph *kutype.Graph) (*DeltaUpdate, error) {
	if currentGraph == nil || currentGraph.Nodes == nil || currentGraph.Links == nil {
		return nil, fmt.Errorf("invalid graph data")
	}

	// If this is the first time, return full update
	if len(dt.previousNodes) == 0 && len(dt.previousLinks) == 0 {
		log.Printf("First time delta generation, sending full update with %d nodes and %d links", 
			len(*currentGraph.Nodes), len(*currentGraph.Links))
		
		// Store current state
		dt.updatePreviousState(currentGraph)
		
		return &DeltaUpdate{
			Type:  "full",
			Nodes: *currentGraph.Nodes,
			Links: *currentGraph.Links,
		}, nil
	}

	// Create maps for current state
	currentNodes := make(map[string]kutype.Node)
	currentLinks := make(map[string]kutype.Link)

	for _, node := range *currentGraph.Nodes {
		currentNodes[node.Id] = node
	}

	for _, link := range *currentGraph.Links {
		linkKey := fmt.Sprintf("%s-%s", link.Source, link.Target)
		currentLinks[linkKey] = link
	}

	// Find changes
	delta := &DeltaUpdate{Type: "delta"}
	
	// Find new or updated nodes
	for id, currentNode := range currentNodes {
		if previousNode, exists := dt.previousNodes[id]; !exists {
			// New node
			delta.Nodes = append(delta.Nodes, currentNode)
		} else if !nodesEqual(previousNode, currentNode) {
			// Updated node
			delta.Nodes = append(delta.Nodes, currentNode)
		}
	}

	// Find removed nodes
	for id := range dt.previousNodes {
		if _, exists := currentNodes[id]; !exists {
			delta.RemovedNodes = append(delta.RemovedNodes, id)
		}
	}

	// Find new links
	for linkKey, currentLink := range currentLinks {
		if _, exists := dt.previousLinks[linkKey]; !exists {
			delta.Links = append(delta.Links, currentLink)
		}
	}

	// Find removed links
	for linkKey, previousLink := range dt.previousLinks {
		if _, exists := currentLinks[linkKey]; !exists {
			delta.RemovedLinks = append(delta.RemovedLinks, LinkRef{
				Source: previousLink.Source,
				Target: previousLink.Target,
			})
		}
	}

	// Update previous state
	dt.updatePreviousState(currentGraph)

	// Check if there are any changes
	hasChanges := len(delta.Nodes) > 0 || len(delta.Links) > 0 || 
		len(delta.RemovedNodes) > 0 || len(delta.RemovedLinks) > 0

	if !hasChanges {
		return nil, nil // No changes
	}

	log.Printf("Generated delta: +%d nodes, +%d links, -%d nodes, -%d links", 
		len(delta.Nodes), len(delta.Links), len(delta.RemovedNodes), len(delta.RemovedLinks))

	return delta, nil
}

// updatePreviousState updates the stored previous state
func (dt *DeltaTracker) updatePreviousState(graph *kutype.Graph) {
	// Clear previous state
	dt.previousNodes = make(map[string]kutype.Node)
	dt.previousLinks = make(map[string]kutype.Link)

	// Store current state as previous
	for _, node := range *graph.Nodes {
		dt.previousNodes[node.Id] = node
	}

	for _, link := range *graph.Links {
		linkKey := fmt.Sprintf("%s-%s", link.Source, link.Target)
		dt.previousLinks[linkKey] = link
	}
}

// nodesEqual compares two nodes for equality
func nodesEqual(a, b kutype.Node) bool {
	// Compare basic fields
	if a.Id != b.Id || a.Name != b.Name || a.Type != b.Type || 
		a.Namespace != b.Namespace || a.Status != b.Status || 
		a.StatusMessage != b.StatusMessage || a.CreationTime != b.CreationTime || 
		a.Age != b.Age {
		return false
	}

	// Compare labels
	if !mapsEqual(a.Labels, b.Labels) {
		return false
	}

	// Compare annotations
	if !mapsEqual(a.Annotations, b.Annotations) {
		return false
	}

	// Compare resource info with smart array comparison
	if !resourceInfoEqual(a.ResourceInfo, b.ResourceInfo) {
		return false
	}

	return true
}

// mapsEqual compares two string maps
func mapsEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	
	return true
}

// resourceInfoEqual compares resource info maps with smart array handling
func resourceInfoEqual(a, b map[string]interface{}) bool {
	if len(a) != len(b) {
		return false
	}
	
	// Fields where array order should be ignored
	orderIgnoredArrayFields := map[string]bool{
		"key_names":           true,  // ConfigMap/Secret keys
		"conditions":          true,  // Node/Pod conditions
		"external_ips":        true,  // Service external IPs
		"image_pull_secrets":  true,  // Pod image pull secrets
		"volumes":             true,  // Pod volumes (when represented as arrays)
		"containers":          true,  // Pod containers (when represented as name arrays)
		"ports":               true,  // Service ports (when represented as arrays)
		"rules":               true,  // Ingress rules (when represented as arrays)
		"hosts":               true,  // Ingress hosts
		"secrets":             true,  // ServiceAccount secrets
	}
	
	for key, valueA := range a {
		valueB, exists := b[key]
		if !exists {
			return false
		}
		
		// Special handling for arrays where order doesn't matter
		if orderIgnoredArrayFields[key] {
			if !arraysEqualIgnoreOrder(valueA, valueB) {
				return false
			}
		} else {
			// Use deep equal for other fields
			if !reflect.DeepEqual(valueA, valueB) {
				return false
			}
		}
	}
	
	return true
}

// arraysEqualIgnoreOrder compares two arrays ignoring order
func arraysEqualIgnoreOrder(a, b interface{}) bool {
	// Convert to slices of strings (most common case)
	sliceA, okA := a.([]string)
	sliceB, okB := b.([]string)
	
	if okA && okB {
		return stringSlicesEqualIgnoreOrder(sliceA, sliceB)
	}
	
	// Handle interface{} slices
	ifaceSliceA, okA := a.([]interface{})
	ifaceSliceB, okB := b.([]interface{})
	
	if okA && okB {
		return interfaceSlicesEqualIgnoreOrder(ifaceSliceA, ifaceSliceB)
	}
	
	// Fallback to deep equal if not slices
	return reflect.DeepEqual(a, b)
}

// stringSlicesEqualIgnoreOrder compares string slices ignoring order
func stringSlicesEqualIgnoreOrder(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	
	// Create frequency maps
	freqA := make(map[string]int)
	freqB := make(map[string]int)
	
	for _, item := range a {
		freqA[item]++
	}
	
	for _, item := range b {
		freqB[item]++
	}
	
	// Compare frequency maps
	return reflect.DeepEqual(freqA, freqB)
}

// interfaceSlicesEqualIgnoreOrder compares interface{} slices ignoring order
func interfaceSlicesEqualIgnoreOrder(a, b []interface{}) bool {
	if len(a) != len(b) {
		return false
	}
	
	// Convert to strings for comparison
	stringsA := make([]string, len(a))
	stringsB := make([]string, len(b))
	
	for i, item := range a {
		stringsA[i] = fmt.Sprintf("%v", item)
	}
	
	for i, item := range b {
		stringsB[i] = fmt.Sprintf("%v", item)
	}
	
	return stringSlicesEqualIgnoreOrder(stringsA, stringsB)
}

// ToJSON converts delta update to JSON bytes
func (du *DeltaUpdate) ToJSON() ([]byte, error) {
	return json.Marshal(du)
}

// Reset clears the delta tracker state (useful for testing or reset scenarios)
func (dt *DeltaTracker) Reset() {
	dt.previousNodes = make(map[string]kutype.Node)
	dt.previousLinks = make(map[string]kutype.Link)
}

// GetStats returns statistics about the current state
func (dt *DeltaTracker) GetStats() map[string]int {
	return map[string]int{
		"previous_nodes": len(dt.previousNodes),
		"previous_links": len(dt.previousLinks),
	}
}
