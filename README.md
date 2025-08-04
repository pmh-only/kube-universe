> [!NOTE]  
> This is the fork of [kube-universe by afritzler](https://github.com/afritzler/kube-universe). see original repository for more information.

# kube-universe

![kube universe logo](images/logo_small.png)

---

![demo](images/demo.png)

## Overview

Kube-Universe renders a Kubernetes cluster into a dynamic 3D graph. An example landscape visualization can be found [here](images/universe.png).

A __Live Demo Version__ is available [here](https://afritzler.github.io/kube-universe/web/demo/)

## Features

* 3D cluster overview with comprehensive Kubernetes resource visualization
* Real-time updates via WebSocket connection
* Identify pods with errors and status information
* Visual representation of resource relationships and dependencies

## Supported Resource Types

* **Core Resources**: Namespaces, Pods, Nodes, Services, ConfigMaps, Secrets, ServiceAccounts
* **Workload Resources**: Deployments, ReplicaSets, DaemonSets, StatefulSets
* **Network Resources**: Ingresses, EndpointSlices
* **Visual Indicators**: Different shapes and colors for each resource type
* **Status Information**: Pod status, deployment replica counts, and more

## Installation and Usage

Try `kube-universe` with Kubernetes Manifest file

```yaml
# TODO
```

## Development

To build and run `kube-universe` from source

```bash
statik -f -src=./web/
go run *.go serve --kubeconfig=PATH_TO_MY_KUBECONFIG
```

## Acknowledgements

Kube universe is using [3d-force-graph](https://github.com/vasturiano/3d-force-graph) for rendering.
