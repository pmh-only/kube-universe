// Copyright © 2018 Andreas Fritzler
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package pkg

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	kutype "github.com/afritzler/kube-universe/pkg/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

const (
	clusterType        = "cluster"
	domainType         = "domain"
	namespaceType      = "namespace"
	podType            = "pod"
	nodeType           = "node"
	serviceType        = "service"
	ingressType        = "ingress"
	endpointSliceType  = "endpointslice"
	serviceAccountType = "serviceaccount"
	deploymentType     = "deployment"
	replicaSetType     = "replicaset"
	daemonSetType      = "daemonset"
	statefulSetType    = "statefulset"
	configMapType      = "configmap"
	secretType         = "secret"
)

// Relationship types for links
const (
	relationshipContains    = "contains"     // A contains B (namespace contains pod)
	relationshipInstanceOf  = "instance_of"  // A is instance of B (pod is instance of replicaset)
	relationshipDependsOn   = "depends_on"   // A depends on B (pod depends on configmap)
	relationshipExposes     = "exposes"      // A exposes B (service exposes pod)
	relationshipRoutes      = "routes"       // A routes to B (ingress routes to service)
	relationshipManages     = "manages"      // A manages B (deployment manages replicaset)
	relationshipRuns        = "runs"         // A runs on B (pod runs on node)
	relationshipAccesses    = "accesses"     // A accesses B (domain accesses ingress)
)

// getKubernetesConfig returns a Kubernetes config, prioritizing in-cluster config
func getKubernetesConfig(kubeconfig string) (*rest.Config, error) {
	// First, try to use in-cluster config (when running as a pod with ServiceAccount)
	if config, err := rest.InClusterConfig(); err == nil {
		fmt.Println("Using in-cluster Kubernetes configuration (ServiceAccount)")
		return config, nil
	}
	
	// If in-cluster config fails, try to use provided kubeconfig
	if kubeconfig != "" {
		fmt.Printf("Using provided kubeconfig: %s\n", kubeconfig)
		return clientcmd.BuildConfigFromFlags("", kubeconfig)
	}
	
	// If no kubeconfig provided, try default locations
	if kubeconfigPath := os.Getenv("KUBECONFIG"); kubeconfigPath != "" {
		fmt.Printf("Using KUBECONFIG environment variable: %s\n", kubeconfigPath)
		return clientcmd.BuildConfigFromFlags("", kubeconfigPath)
	}
	
	// Try default kubeconfig location
	if homeDir := os.Getenv("HOME"); homeDir != "" {
		defaultKubeconfig := homeDir + "/.kube/config"
		if _, err := os.Stat(defaultKubeconfig); err == nil {
			fmt.Printf("Using default kubeconfig: %s\n", defaultKubeconfig)
			return clientcmd.BuildConfigFromFlags("", defaultKubeconfig)
		}
	}
	
	return nil, fmt.Errorf("unable to find kubernetes configuration: not running in-cluster and no kubeconfig found")
}

// GetGraph returns the rendered dependency graph
func GetGraph(kubeconfig string) ([]byte, error) {
	ctx := context.Background()
	
	// Try to get Kubernetes config - prioritize in-cluster config if available
	config, err := getKubernetesConfig(kubeconfig)
	if err != nil {
		return nil, fmt.Errorf("failed to load kubernetes config: %s", err)
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create clientset for kubeconfig: %s", err)
	}

	nodes := make(map[string]*kutype.Node)
	links := make([]kutype.Link, 0)

	// Get namespaces
	namespaces, err := clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get namespaces: %s", err)
	}
	for _, n := range namespaces.Items {
		key := fmt.Sprintf("%s-%s", namespaceType, n.Name)
		resourceInfo := make(map[string]interface{})
		resourceInfo["phase"] = string(n.Status.Phase)
		
		nodes[key] = &kutype.Node{
			Id:           key,
			Name:         n.Name,
			Type:         namespaceType,
			Namespace:    n.Namespace,
			CreationTime: n.CreationTimestamp.Format(time.RFC3339),
			Age:          calculateAge(n.CreationTimestamp),
			Labels:       n.Labels,
			Annotations:  n.Annotations,
			ResourceInfo: resourceInfo,
		}
	}

	// Get cluster nodes
	clusterNodes, err := clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get nodes: %s", err)
	}
	for _, n := range clusterNodes.Items {
		key := fmt.Sprintf("%s-%s", nodeType, n.Name)
		resourceInfo := make(map[string]interface{})
		
		// Node capacity and allocatable resources
		if cpu := n.Status.Capacity["cpu"]; cpu.String() != "" {
			resourceInfo["cpu_capacity"] = cpu.String()
		}
		if memory := n.Status.Capacity["memory"]; memory.String() != "" {
			resourceInfo["memory_capacity"] = memory.String()
		}
		if storage := n.Status.Capacity["ephemeral-storage"]; storage.String() != "" {
			resourceInfo["storage_capacity"] = storage.String()
		}
		
		// Node conditions
		conditions := make([]string, 0)
		for _, condition := range n.Status.Conditions {
			if condition.Status == "True" {
				conditions = append(conditions, string(condition.Type))
			}
		}
		resourceInfo["conditions"] = conditions
		resourceInfo["kernel_version"] = n.Status.NodeInfo.KernelVersion
		resourceInfo["os_image"] = n.Status.NodeInfo.OSImage
		resourceInfo["container_runtime"] = n.Status.NodeInfo.ContainerRuntimeVersion
		
		nodes[key] = &kutype.Node{
			Id:           key,
			Name:         n.Name,
			Type:         nodeType,
			Namespace:    n.Namespace,
			Status:       string(n.Status.Phase),
			CreationTime: n.CreationTimestamp.Format(time.RFC3339),
			Age:          calculateAge(n.CreationTimestamp),
			Labels:       n.Labels,
			Annotations:  n.Annotations,
			ResourceInfo: resourceInfo,
		}
	}

	// Get pods
	pods, err := clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pods: %s", err)
	}
	for _, p := range pods.Items {
		podKey := fmt.Sprintf("%s-%s-%s", podType, p.Namespace, p.Name)
		namespaceKey := fmt.Sprintf("%s-%s", namespaceType, p.Namespace)
		nodeKey := fmt.Sprintf("%s-%s", nodeType, p.Spec.NodeName)
		
		resourceInfo := make(map[string]interface{})
		resourceInfo["containers"] = len(p.Spec.Containers)
		resourceInfo["restart_count"] = 0
		resourceInfo["node_name"] = p.Spec.NodeName
		resourceInfo["service_account"] = p.Spec.ServiceAccountName
		resourceInfo["host_network"] = p.Spec.HostNetwork
		resourceInfo["dns_policy"] = string(p.Spec.DNSPolicy)
		
		// Calculate total restart count
		totalRestarts := int32(0)
		for _, containerStatus := range p.Status.ContainerStatuses {
			totalRestarts += containerStatus.RestartCount
		}
		resourceInfo["restart_count"] = totalRestarts
		
		// Pod IP and Host IP
		if p.Status.PodIP != "" {
			resourceInfo["pod_ip"] = p.Status.PodIP
		}
		if p.Status.HostIP != "" {
			resourceInfo["host_ip"] = p.Status.HostIP
		}
		
		// QoS Class
		resourceInfo["qos_class"] = string(p.Status.QOSClass)
		
		nodes[podKey] = &kutype.Node{
			Id:            podKey,
			Name:          p.Name,
			Type:          podType,
			Namespace:     p.Namespace,
			Status:        string(p.Status.Phase),
			StatusMessage: p.Status.Message,
			CreationTime:  p.CreationTimestamp.Format(time.RFC3339),
			Age:           calculateAge(p.CreationTimestamp),
			Labels:        p.Labels,
			Annotations:   p.Annotations,
			ResourceInfo:  resourceInfo,
		}
		links = append(links, kutype.Link{Source: namespaceKey, Target: podKey, Value: 0, Relationship: relationshipContains})
		if p.Spec.NodeName != "" {
			links = append(links, kutype.Link{Source: podKey, Target: nodeKey, Value: 0, Relationship: relationshipRuns})
		}
	}

	// Get services
	services, err := clientset.CoreV1().Services("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get services: %s", err)
	}
	for _, s := range services.Items {
		serviceKey := fmt.Sprintf("%s-%s-%s", serviceType, s.Namespace, s.Name)
		namespaceKey := fmt.Sprintf("%s-%s", namespaceType, s.Namespace)
		
		resourceInfo := make(map[string]interface{})
		resourceInfo["service_type"] = string(s.Spec.Type)
		resourceInfo["cluster_ip"] = s.Spec.ClusterIP
		resourceInfo["ports"] = len(s.Spec.Ports)
		resourceInfo["session_affinity"] = string(s.Spec.SessionAffinity)
		
		// External IPs
		if len(s.Spec.ExternalIPs) > 0 {
			resourceInfo["external_ips"] = s.Spec.ExternalIPs
		}
		
		// Load balancer info
		if s.Spec.Type == "LoadBalancer" {
			if len(s.Status.LoadBalancer.Ingress) > 0 {
				ingress := s.Status.LoadBalancer.Ingress[0]
				if ingress.IP != "" {
					resourceInfo["load_balancer_ip"] = ingress.IP
				}
				if ingress.Hostname != "" {
					resourceInfo["load_balancer_hostname"] = ingress.Hostname
				}
			}
		}
		
		// Port details
		portDetails := make([]map[string]interface{}, 0)
		for _, port := range s.Spec.Ports {
			portInfo := map[string]interface{}{
				"name":        port.Name,
				"port":        port.Port,
				"target_port": port.TargetPort.String(),
				"protocol":    string(port.Protocol),
			}
			if port.NodePort != 0 {
				portInfo["node_port"] = port.NodePort
			}
			portDetails = append(portDetails, portInfo)
		}
		resourceInfo["port_details"] = portDetails
		
		nodes[serviceKey] = &kutype.Node{
			Id:           serviceKey,
			Name:         s.Name,
			Type:         serviceType,
			Namespace:    s.Namespace,
			Status:       string(s.Spec.Type),
			CreationTime: s.CreationTimestamp.Format(time.RFC3339),
			Age:          calculateAge(s.CreationTimestamp),
			Labels:       s.Labels,
			Annotations:  s.Annotations,
			ResourceInfo: resourceInfo,
		}
		links = append(links, kutype.Link{Source: namespaceKey, Target: serviceKey, Value: 0, Relationship: relationshipContains})
	}

	// Get ingresses
	ingresses, err := clientset.NetworkingV1().Ingresses("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get ingresses: %s", err)
	}
	for _, ing := range ingresses.Items {
		ingressKey := fmt.Sprintf("%s-%s-%s", ingressType, ing.Namespace, ing.Name)
		namespaceKey := fmt.Sprintf("%s-%s", namespaceType, ing.Namespace)
		
		resourceInfo := make(map[string]interface{})
		resourceInfo["rules"] = len(ing.Spec.Rules)
		resourceInfo["tls"] = len(ing.Spec.TLS)
		
		// Ingress class
		if ing.Spec.IngressClassName != nil {
			resourceInfo["ingress_class"] = *ing.Spec.IngressClassName
		}
		
		// Load balancer info
		if len(ing.Status.LoadBalancer.Ingress) > 0 {
			lbIngress := ing.Status.LoadBalancer.Ingress[0]
			if lbIngress.IP != "" {
				resourceInfo["load_balancer_ip"] = lbIngress.IP
			}
			if lbIngress.Hostname != "" {
				resourceInfo["load_balancer_hostname"] = lbIngress.Hostname
			}
		}
		
		nodes[ingressKey] = &kutype.Node{
			Id:           ingressKey,
			Name:         ing.Name,
			Type:         ingressType,
			Namespace:    ing.Namespace,
			CreationTime: ing.CreationTimestamp.Format(time.RFC3339),
			Age:          calculateAge(ing.CreationTimestamp),
			Labels:       ing.Labels,
			Annotations:  ing.Annotations,
			ResourceInfo: resourceInfo,
		}
		links = append(links, kutype.Link{Source: namespaceKey, Target: ingressKey, Value: 0, Relationship: relationshipContains})

		// Create domain nodes for each host and link ingresses to services
		for _, rule := range ing.Spec.Rules {
			// Create domain node for each host
			if rule.Host != "" {
				domainKey := fmt.Sprintf("%s-%s", domainType, rule.Host)
				
				// Only create domain node if it doesn't exist yet
				if _, exists := nodes[domainKey]; !exists {
					domainResourceInfo := make(map[string]interface{})
					domainResourceInfo["hostname"] = rule.Host
					domainResourceInfo["type"] = "external_domain"
					domainResourceInfo["description"] = fmt.Sprintf("External domain: %s", rule.Host)
					
					nodes[domainKey] = &kutype.Node{
						Id:           domainKey,
						Name:         rule.Host,
						Type:         domainType,
						Namespace:    "", // Domains are cluster-wide
						CreationTime: time.Now().Format(time.RFC3339),
						Age:          "N/A",
						Labels:       make(map[string]string),
						Annotations:  make(map[string]string),
						ResourceInfo: domainResourceInfo,
					}
				}
				
				// Link domain to ingress
				links = append(links, kutype.Link{Source: domainKey, Target: ingressKey, Value: 0, Relationship: relationshipAccesses})
			}
			
			// Link ingresses to services
			if rule.HTTP != nil {
				for _, path := range rule.HTTP.Paths {
					if path.Backend.Service != nil {
						serviceKey := fmt.Sprintf("%s-%s-%s", serviceType, ing.Namespace, path.Backend.Service.Name)
						if _, exists := nodes[serviceKey]; exists {
							links = append(links, kutype.Link{Source: ingressKey, Target: serviceKey, Value: 0, Relationship: relationshipRoutes})
						}
					}
				}
			}
		}
	}

	// Get endpoint slices
	endpointSlices, err := clientset.DiscoveryV1().EndpointSlices("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get endpoint slices: %s", err)
	}
	for _, es := range endpointSlices.Items {
		esKey := fmt.Sprintf("%s-%s-%s", endpointSliceType, es.Namespace, es.Name)
		namespaceKey := fmt.Sprintf("%s-%s", namespaceType, es.Namespace)
		
		resourceInfo := make(map[string]interface{})
		resourceInfo["address_type"] = string(es.AddressType)
		resourceInfo["endpoints"] = len(es.Endpoints)
		resourceInfo["ports"] = len(es.Ports)
		
		nodes[esKey] = &kutype.Node{
			Id:           esKey,
			Name:         es.Name,
			Type:         endpointSliceType,
			Namespace:    es.Namespace,
			CreationTime: es.CreationTimestamp.Format(time.RFC3339),
			Age:          calculateAge(es.CreationTimestamp),
			Labels:       es.Labels,
			Annotations:  es.Annotations,
			ResourceInfo: resourceInfo,
		}
		links = append(links, kutype.Link{Source: namespaceKey, Target: esKey, Value: 0, Relationship: relationshipContains})

		// Link endpoint slices to services
		if serviceName, ok := es.Labels["kubernetes.io/service-name"]; ok {
			serviceKey := fmt.Sprintf("%s-%s-%s", serviceType, es.Namespace, serviceName)
			if _, exists := nodes[serviceKey]; exists {
				links = append(links, kutype.Link{Source: serviceKey, Target: esKey, Value: 0, Relationship: relationshipExposes})
			}
		}
		
		// Link endpoint slices to pods
		for _, endpoint := range es.Endpoints {
			if endpoint.TargetRef != nil && endpoint.TargetRef.Kind == "Pod" {
				podKey := fmt.Sprintf("%s-%s-%s", podType, es.Namespace, endpoint.TargetRef.Name)
				if _, exists := nodes[podKey]; exists {
					links = append(links, kutype.Link{Source: esKey, Target: podKey, Value: 0, Relationship: relationshipExposes})
				}
			}
		}
	}

	// Get service accounts
	serviceAccounts, err := clientset.CoreV1().ServiceAccounts("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get service accounts: %s", err)
	}
	for _, sa := range serviceAccounts.Items {
		saKey := fmt.Sprintf("%s-%s-%s", serviceAccountType, sa.Namespace, sa.Name)
		namespaceKey := fmt.Sprintf("%s-%s", namespaceType, sa.Namespace)
		
		resourceInfo := make(map[string]interface{})
		resourceInfo["secrets"] = len(sa.Secrets)
		resourceInfo["image_pull_secrets"] = len(sa.ImagePullSecrets)
		resourceInfo["automount_service_account_token"] = true
		if sa.AutomountServiceAccountToken != nil {
			resourceInfo["automount_service_account_token"] = *sa.AutomountServiceAccountToken
		}
		
		nodes[saKey] = &kutype.Node{
			Id:           saKey,
			Name:         sa.Name,
			Type:         serviceAccountType,
			Namespace:    sa.Namespace,
			CreationTime: sa.CreationTimestamp.Format(time.RFC3339),
			Age:          calculateAge(sa.CreationTimestamp),
			Labels:       sa.Labels,
			Annotations:  sa.Annotations,
			ResourceInfo: resourceInfo,
		}
		links = append(links, kutype.Link{Source: namespaceKey, Target: saKey, Value: 0, Relationship: relationshipContains})
	}

	// Get deployments
	deployments, err := clientset.AppsV1().Deployments("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get deployments: %s", err)
	}
	for _, d := range deployments.Items {
		deploymentKey := fmt.Sprintf("%s-%s-%s", deploymentType, d.Namespace, d.Name)
		namespaceKey := fmt.Sprintf("%s-%s", namespaceType, d.Namespace)
		status := fmt.Sprintf("%d/%d", d.Status.ReadyReplicas, d.Status.Replicas)
		
		resourceInfo := make(map[string]interface{})
		resourceInfo["replicas"] = d.Status.Replicas
		resourceInfo["ready_replicas"] = d.Status.ReadyReplicas
		resourceInfo["available_replicas"] = d.Status.AvailableReplicas
		resourceInfo["unavailable_replicas"] = d.Status.UnavailableReplicas
		resourceInfo["updated_replicas"] = d.Status.UpdatedReplicas
		resourceInfo["strategy_type"] = string(d.Spec.Strategy.Type)
		
		if d.Spec.Replicas != nil {
			resourceInfo["desired_replicas"] = *d.Spec.Replicas
		}
		
		// Deployment conditions
		conditions := make([]string, 0)
		for _, condition := range d.Status.Conditions {
			if condition.Status == "True" {
				conditions = append(conditions, string(condition.Type))
			}
		}
		resourceInfo["conditions"] = conditions
		
		nodes[deploymentKey] = &kutype.Node{
			Id:           deploymentKey,
			Name:         d.Name,
			Type:         deploymentType,
			Namespace:    d.Namespace,
			Status:       status,
			CreationTime: d.CreationTimestamp.Format(time.RFC3339),
			Age:          calculateAge(d.CreationTimestamp),
			Labels:       d.Labels,
			Annotations:  d.Annotations,
			ResourceInfo: resourceInfo,
		}
		links = append(links, kutype.Link{Source: namespaceKey, Target: deploymentKey, Value: 0, Relationship: relationshipContains})
	}

	// Get replica sets
	replicaSets, err := clientset.AppsV1().ReplicaSets("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get replica sets: %s", err)
	}
	for _, rs := range replicaSets.Items {
		rsKey := fmt.Sprintf("%s-%s-%s", replicaSetType, rs.Namespace, rs.Name)
		namespaceKey := fmt.Sprintf("%s-%s", namespaceType, rs.Namespace)
		status := fmt.Sprintf("%d/%d", rs.Status.ReadyReplicas, rs.Status.Replicas)
		
		resourceInfo := make(map[string]interface{})
		resourceInfo["replicas"] = rs.Status.Replicas
		resourceInfo["ready_replicas"] = rs.Status.ReadyReplicas
		resourceInfo["available_replicas"] = rs.Status.AvailableReplicas
		resourceInfo["fully_labeled_replicas"] = rs.Status.FullyLabeledReplicas
		if rs.Spec.Replicas != nil {
			resourceInfo["desired_replicas"] = *rs.Spec.Replicas
		}
		
		nodes[rsKey] = &kutype.Node{
			Id:           rsKey,
			Name:         rs.Name,
			Type:         replicaSetType,
			Namespace:    rs.Namespace,
			Status:       status,
			CreationTime: rs.CreationTimestamp.Format(time.RFC3339),
			Age:          calculateAge(rs.CreationTimestamp),
			Labels:       rs.Labels,
			Annotations:  rs.Annotations,
			ResourceInfo: resourceInfo,
		}
		links = append(links, kutype.Link{Source: namespaceKey, Target: rsKey, Value: 0, Relationship: relationshipContains})

		// Link replica sets to deployments
		for _, owner := range rs.OwnerReferences {
			if owner.Kind == "Deployment" {
				deploymentKey := fmt.Sprintf("%s-%s-%s", deploymentType, rs.Namespace, owner.Name)
				if _, exists := nodes[deploymentKey]; exists {
					links = append(links, kutype.Link{Source: deploymentKey, Target: rsKey, Value: 0, Relationship: relationshipManages})
				}
			}
		}
	}

	// Get daemon sets
	daemonSets, err := clientset.AppsV1().DaemonSets("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get daemon sets: %s", err)
	}
	for _, ds := range daemonSets.Items {
		dsKey := fmt.Sprintf("%s-%s-%s", daemonSetType, ds.Namespace, ds.Name)
		namespaceKey := fmt.Sprintf("%s-%s", namespaceType, ds.Namespace)
		status := fmt.Sprintf("%d/%d", ds.Status.NumberReady, ds.Status.DesiredNumberScheduled)
		
		resourceInfo := make(map[string]interface{})
		resourceInfo["desired_number_scheduled"] = ds.Status.DesiredNumberScheduled
		resourceInfo["current_number_scheduled"] = ds.Status.CurrentNumberScheduled
		resourceInfo["number_ready"] = ds.Status.NumberReady
		resourceInfo["number_available"] = ds.Status.NumberAvailable
		resourceInfo["number_unavailable"] = ds.Status.NumberUnavailable
		resourceInfo["number_misscheduled"] = ds.Status.NumberMisscheduled
		resourceInfo["update_strategy"] = string(ds.Spec.UpdateStrategy.Type)
		
		nodes[dsKey] = &kutype.Node{
			Id:           dsKey,
			Name:         ds.Name,
			Type:         daemonSetType,
			Namespace:    ds.Namespace,
			Status:       status,
			CreationTime: ds.CreationTimestamp.Format(time.RFC3339),
			Age:          calculateAge(ds.CreationTimestamp),
			Labels:       ds.Labels,
			Annotations:  ds.Annotations,
			ResourceInfo: resourceInfo,
		}
		links = append(links, kutype.Link{Source: namespaceKey, Target: dsKey, Value: 0, Relationship: relationshipContains})
	}

	// Get stateful sets
	statefulSets, err := clientset.AppsV1().StatefulSets("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get stateful sets: %s", err)
	}
	for _, ss := range statefulSets.Items {
		ssKey := fmt.Sprintf("%s-%s-%s", statefulSetType, ss.Namespace, ss.Name)
		namespaceKey := fmt.Sprintf("%s-%s", namespaceType, ss.Namespace)
		status := fmt.Sprintf("%d/%d", ss.Status.ReadyReplicas, ss.Status.Replicas)
		
		resourceInfo := make(map[string]interface{})
		resourceInfo["replicas"] = ss.Status.Replicas
		resourceInfo["ready_replicas"] = ss.Status.ReadyReplicas
		resourceInfo["current_replicas"] = ss.Status.CurrentReplicas
		resourceInfo["updated_replicas"] = ss.Status.UpdatedReplicas
		resourceInfo["current_revision"] = ss.Status.CurrentRevision
		resourceInfo["update_revision"] = ss.Status.UpdateRevision
		resourceInfo["update_strategy"] = string(ss.Spec.UpdateStrategy.Type)
		if ss.Spec.Replicas != nil {
			resourceInfo["desired_replicas"] = *ss.Spec.Replicas
		}
		
		nodes[ssKey] = &kutype.Node{
			Id:           ssKey,
			Name:         ss.Name,
			Type:         statefulSetType,
			Namespace:    ss.Namespace,
			Status:       status,
			CreationTime: ss.CreationTimestamp.Format(time.RFC3339),
			Age:          calculateAge(ss.CreationTimestamp),
			Labels:       ss.Labels,
			Annotations:  ss.Annotations,
			ResourceInfo: resourceInfo,
		}
		links = append(links, kutype.Link{Source: namespaceKey, Target: ssKey, Value: 0, Relationship: relationshipContains})
	}

	// Get config maps
	configMaps, err := clientset.CoreV1().ConfigMaps("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get config maps: %s", err)
	}
	for _, cm := range configMaps.Items {
		cmKey := fmt.Sprintf("%s-%s-%s", configMapType, cm.Namespace, cm.Name)
		namespaceKey := fmt.Sprintf("%s-%s", namespaceType, cm.Namespace)
		
		resourceInfo := make(map[string]interface{})
		resourceInfo["data_keys"] = len(cm.Data)
		resourceInfo["binary_data_keys"] = len(cm.BinaryData)
		resourceInfo["total_keys"] = len(cm.Data) + len(cm.BinaryData)
		
		// Calculate total data size (approximate)
		totalSize := 0
		for _, value := range cm.Data {
			totalSize += len(value)
		}
		for _, value := range cm.BinaryData {
			totalSize += len(value)
		}
		resourceInfo["total_size_bytes"] = totalSize
		
		// List key names (limit to first 10 for display)
		keyNames := make([]string, 0)
		for key := range cm.Data {
			keyNames = append(keyNames, key)
			if len(keyNames) >= 10 {
				break
			}
		}
		for key := range cm.BinaryData {
			if len(keyNames) < 10 {
				keyNames = append(keyNames, key+" (binary)")
			}
		}
		resourceInfo["key_names"] = keyNames
		
		nodes[cmKey] = &kutype.Node{
			Id:           cmKey,
			Name:         cm.Name,
			Type:         configMapType,
			Namespace:    cm.Namespace,
			CreationTime: cm.CreationTimestamp.Format(time.RFC3339),
			Age:          calculateAge(cm.CreationTimestamp),
			Labels:       cm.Labels,
			Annotations:  cm.Annotations,
			ResourceInfo: resourceInfo,
		}
		links = append(links, kutype.Link{Source: namespaceKey, Target: cmKey, Value: 0, Relationship: relationshipContains})
	}

	// Get secrets
	secrets, err := clientset.CoreV1().Secrets("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get secrets: %s", err)
	}
	for _, secret := range secrets.Items {
		secretKey := fmt.Sprintf("%s-%s-%s", secretType, secret.Namespace, secret.Name)
		namespaceKey := fmt.Sprintf("%s-%s", namespaceType, secret.Namespace)
		
		resourceInfo := make(map[string]interface{})
		resourceInfo["secret_type"] = string(secret.Type)
		resourceInfo["data_keys"] = len(secret.Data)
		resourceInfo["string_data_keys"] = len(secret.StringData)
		resourceInfo["total_keys"] = len(secret.Data) + len(secret.StringData)
		
		// Calculate total data size (approximate)
		totalSize := 0
		for _, value := range secret.Data {
			totalSize += len(value)
		}
		for _, value := range secret.StringData {
			totalSize += len(value)
		}
		resourceInfo["total_size_bytes"] = totalSize
		
		// List key names (limit to first 10 for display, don't show values for security)
		keyNames := make([]string, 0)
		for key := range secret.Data {
			keyNames = append(keyNames, key)
			if len(keyNames) >= 10 {
				break
			}
		}
		for key := range secret.StringData {
			if len(keyNames) < 10 {
				keyNames = append(keyNames, key)
			}
		}
		resourceInfo["key_names"] = keyNames
		
		nodes[secretKey] = &kutype.Node{
			Id:           secretKey,
			Name:         secret.Name,
			Type:         secretType,
			Namespace:    secret.Namespace,
			Status:       string(secret.Type),
			CreationTime: secret.CreationTimestamp.Format(time.RFC3339),
			Age:          calculateAge(secret.CreationTimestamp),
			Labels:       secret.Labels,
			Annotations:  secret.Annotations,
			ResourceInfo: resourceInfo,
		}
		links = append(links, kutype.Link{Source: namespaceKey, Target: secretKey, Value: 0, Relationship: relationshipContains})
	}

	// Link pods to their controllers (deployments, daemonsets, statefulsets via replicasets)
	for _, p := range pods.Items {
		podKey := fmt.Sprintf("%s-%s-%s", podType, p.Namespace, p.Name)
		for _, owner := range p.OwnerReferences {
			var controllerKey string
			switch owner.Kind {
			case "ReplicaSet":
				controllerKey = fmt.Sprintf("%s-%s-%s", replicaSetType, p.Namespace, owner.Name)
			case "DaemonSet":
				controllerKey = fmt.Sprintf("%s-%s-%s", daemonSetType, p.Namespace, owner.Name)
			case "StatefulSet":
				controllerKey = fmt.Sprintf("%s-%s-%s", statefulSetType, p.Namespace, owner.Name)
			}
			if controllerKey != "" {
				if _, exists := nodes[controllerKey]; exists {
					links = append(links, kutype.Link{Source: controllerKey, Target: podKey, Value: 0, Relationship: relationshipInstanceOf})
				}
			}
		}

		// Link pods to service accounts
		if p.Spec.ServiceAccountName != "" {
			saKey := fmt.Sprintf("%s-%s-%s", serviceAccountType, p.Namespace, p.Spec.ServiceAccountName)
			if _, exists := nodes[saKey]; exists {
				links = append(links, kutype.Link{Source: saKey, Target: podKey, Value: 0, Relationship: relationshipDependsOn})
			}
		}

		// Link pods to config maps and secrets
		for _, volume := range p.Spec.Volumes {
			if volume.ConfigMap != nil {
				cmKey := fmt.Sprintf("%s-%s-%s", configMapType, p.Namespace, volume.ConfigMap.Name)
				if _, exists := nodes[cmKey]; exists {
					links = append(links, kutype.Link{Source: cmKey, Target: podKey, Value: 0, Relationship: relationshipDependsOn})
				}
			}
			if volume.Secret != nil {
				secretKey := fmt.Sprintf("%s-%s-%s", secretType, p.Namespace, volume.Secret.SecretName)
				if _, exists := nodes[secretKey]; exists {
					links = append(links, kutype.Link{Source: secretKey, Target: podKey, Value: 0, Relationship: relationshipDependsOn})
				}
			}
		}
	}

	data, err := json.MarshalIndent(kutype.Graph{Nodes: values(nodes), Links: &links}, "", "	")
	if err != nil {
		return nil, fmt.Errorf("JSON marshaling failed: %s", err)
	}
	return data, nil
}

func values(nodes map[string]*kutype.Node) *[]kutype.Node {
	array := []kutype.Node{}
	for _, n := range nodes {
		array = append(array, *n)
	}
	return &array
}

// calculateAge returns a human-readable age string
func calculateAge(creationTime metav1.Time) string {
	if creationTime.IsZero() {
		return "Unknown"
	}
	
	duration := time.Since(creationTime.Time)
	
	if duration < time.Minute {
		return fmt.Sprintf("%.0fs", duration.Seconds())
	} else if duration < time.Hour {
		return fmt.Sprintf("%.0fm", duration.Minutes())
	} else if duration < 24*time.Hour {
		return fmt.Sprintf("%.0fh", duration.Hours())
	} else {
		return fmt.Sprintf("%.0fd", duration.Hours()/24)
	}
}

// formatResourceRequests formats CPU and memory requests/limits
func formatResourceRequests(containers []interface{}) map[string]interface{} {
	info := make(map[string]interface{})
	
	// This is a simplified version - in a real implementation you'd parse the resource requirements
	// For now, we'll just return container count
	info["containers"] = len(containers)
	info["cpu_requests"] = "N/A"
	info["memory_requests"] = "N/A"
	info["cpu_limits"] = "N/A"
	info["memory_limits"] = "N/A"
	
	return info
}
