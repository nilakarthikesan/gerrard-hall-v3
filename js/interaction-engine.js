import * as THREE from 'three';

export class InteractionEngine {
    constructor(camera, domElement, clusters, globalControls) {
        this.camera = camera;
        this.domElement = domElement;
        this.clusters = clusters; // Map<path, Cluster>
        this.globalControls = globalControls; // OrbitControls instance

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.selectedCluster = null;
        this.isDragging = false;
        this.previousMousePosition = { x: 0, y: 0 };
        
        this.highlightColor = new THREE.Color(0xffaa00); // Orange glow
        this.originalMaterials = new Map(); // path -> original material params

        this.initEvents();
    }

    initEvents() {
        this.domElement.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.domElement.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.domElement.addEventListener('mouseup', this.onMouseUp.bind(this));
        // Also handle mouse leaving the window
        this.domElement.addEventListener('mouseleave', this.onMouseUp.bind(this));
    }

    getClusterMeshes() {
        // Collect all visible point clouds for raycasting
        const meshes = [];
        for (const cluster of this.clusters.values()) {
            if (cluster.pointCloud && cluster.pointCloud.visible) {
                meshes.push(cluster.pointCloud);
            }
        }
        return meshes;
    }

    onMouseDown(event) {
        event.preventDefault();
        
        // Calculate mouse position in normalized device coordinates (-1 to +1)
        const rect = this.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Slightly larger threshold for points
        this.raycaster.params.Points.threshold = 0.1; 
        
        const intersects = this.raycaster.intersectObjects(this.getClusterMeshes(), false);

        if (intersects.length > 0) {
            const hit = intersects[0];
            const cluster = hit.object.userData.cluster;
            
            if (cluster) {
                this.selectCluster(cluster);
                this.isDragging = true;
                this.previousMousePosition = { x: event.clientX, y: event.clientY };
                
                // Disable global controls so we don't rotate the camera while rotating the cluster
                if (this.globalControls) {
                    this.globalControls.enabled = false;
                }
            }
        } else {
            // Clicked empty space -> Deselect
            this.deselectCluster();
        }
    }

    onMouseMove(event) {
        if (this.isDragging && this.selectedCluster) {
            const deltaMove = {
                x: event.clientX - this.previousMousePosition.x,
                y: event.clientY - this.previousMousePosition.y
            };

            // Apply rotation to the cluster group
            // Axis of rotation should be relative to camera? 
            // For now, simple local X/Y rotation is usually enough for "spinning it around"
            // Rotating around Y axis (horizontal drag)
            // Rotating around X axis (vertical drag)
            
            const rotationSpeed = 0.005;
            
            // We rotate the group. 
            // Note: This rotates it in its local space. 
            this.selectedCluster.group.rotation.y += deltaMove.x * rotationSpeed;
            this.selectedCluster.group.rotation.x += deltaMove.y * rotationSpeed;

            this.previousMousePosition = { x: event.clientX, y: event.clientY };
        }
        
        // Optional: Hover effects could be added here
    }

    onMouseUp(event) {
        this.isDragging = false;
        
        // Re-enable global controls
        if (this.globalControls) {
            this.globalControls.enabled = true;
        }
    }

    selectCluster(cluster) {
        if (this.selectedCluster === cluster) return;
        
        // Deselect previous
        this.deselectCluster();
        
        this.selectedCluster = cluster;
        
        // Apply highlight
        if (cluster.pointCloud) {
            // Clone material to avoid affecting others if shared (though we create unique mats in loader)
            // Increase size and opacity to make it pop
            const mat = cluster.pointCloud.material;
            this.originalMaterials.set(cluster.path, {
                size: mat.size,
                opacity: mat.opacity,
                color: mat.color.clone() // if we used color tinting
            });
            
            mat.size = 0.04; // Bigger points
            mat.opacity = 1.0;
            // mat.color.set(this.highlightColor); // Optional tint
        }
        
        // Update UI label if available
        const label = document.getElementById('event-label');
        if (label) label.textContent = `Selected: ${cluster.path}`;
    }

    deselectCluster() {
        if (this.selectedCluster) {
            // Restore material
            const cluster = this.selectedCluster;
            const originals = this.originalMaterials.get(cluster.path);
            
            if (originals && cluster.pointCloud) {
                const mat = cluster.pointCloud.material;
                mat.size = originals.size;
                mat.opacity = originals.opacity;
                // mat.color.copy(originals.color);
            }
            
            this.selectedCluster = null;
            
            // Update UI label
            const label = document.getElementById('event-label');
            if (label) label.textContent = `Interactive View`;
        }
    }
}
