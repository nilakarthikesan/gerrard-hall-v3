import * as THREE from 'three';

export class Cluster {
    constructor(path, type, childrenPaths = []) {
        this.path = path;
        this.type = type; // 'ba_output' or 'merged'
        this.childrenPaths = childrenPaths;
        
        this.group = new THREE.Group();
        this.pointCloud = null;
        this.pointsCount = 0;
        
        // Layout properties
        this.slabPosition = new THREE.Vector3();
        this.radius = 0;
        this.centroid = new THREE.Vector3();
        
        // Parent/Child references
        this.parent = null;
        this.children = [];
    }

    setPointCloud(geometry, material) {
        this.pointCloud = new THREE.Points(geometry, material);
        // Ensure the point cloud is selectable/interactive if needed
        this.pointCloud.userData = { cluster: this };
        this.group.add(this.pointCloud);
        
        // Compute centroid and radius
        geometry.computeBoundingSphere();
        this.centroid.copy(geometry.boundingSphere.center);
        this.radius = geometry.boundingSphere.radius;
        this.pointsCount = geometry.attributes.position.count;
    }
}

export class DataLoader {
    constructor() {
        this.clusters = new Map(); // path -> Cluster
        this.root = null;
    }

    async load() {
        // 1. Define Structure
        const structure = this.getStructure();
        const flatPaths = this.flattenStructure(structure);

        // 2. Load all Reconstructions
        let loaded = 0;
        const total = flatPaths.length;

        // Create Cluster objects first
        for (const item of flatPaths) {
            const cluster = new Cluster(item.path, item.type, item.children);
            this.clusters.set(item.path, cluster);
        }

        // Link parents/children
        for (const [path, cluster] of this.clusters) {
            for (const childPath of cluster.childrenPaths) {
                const child = this.clusters.get(childPath);
                if (child) {
                    cluster.children.push(child);
                    child.parent = cluster;
                }
            }
        }

        // Load geometry
        const promises = flatPaths.map(async (item) => {
            await this.loadPointCloud(item.path);
            loaded++;
            if (this.onProgress) this.onProgress(loaded, total);
        });

        await Promise.all(promises);
        
        return this.clusters;
    }

    async loadPointCloud(path) {
        try {
            const fullPath = `data/gerrard-hall/results/${path}`;
            const response = await fetch(`${fullPath}/points3D.txt`);
            if (!response.ok) throw new Error(`Failed to fetch ${fullPath}`);
            const text = await response.text();

            const positions = [];
            const colors = [];
            
            const lines = text.split('\n');
            for (let line of lines) {
                if (line.startsWith('#') || line.trim() === '') continue;
                
                const parts = line.trim().split(/\s+/);
                if (parts.length < 8) continue;
                
                const x = parseFloat(parts[1]);
                const y = parseFloat(parts[2]);
                const z = parseFloat(parts[3]);
                const r = parseInt(parts[4]) / 255;
                const g = parseInt(parts[5]) / 255;
                const b = parseInt(parts[6]) / 255;
                
                positions.push(x, y, z);
                colors.push(r, g, b);
            }

            if (positions.length > 0) {
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
                
                // Compute initial bounding sphere to find centroid
                geometry.computeBoundingSphere();
                const center = geometry.boundingSphere.center;
                const originalRadius = geometry.boundingSphere.radius;
                
                // Center the geometry so the group's origin is the center of mass
                geometry.translate(-center.x, -center.y, -center.z);
                
                // SCALE the geometry to fit in a normalized space
                // Larger TARGET_RADIUS = bigger clusters on screen
                const TARGET_RADIUS = 30.0;  // Very large clusters for maximum visibility
                const scaleFactor = originalRadius > 0 ? TARGET_RADIUS / originalRadius : 1.0;
                geometry.scale(scaleFactor, scaleFactor, scaleFactor);
                
                // Update bounding sphere after transformations
                geometry.computeBoundingSphere();

                // The robust radius is now much smaller due to scaling
                const posAttr = geometry.attributes.position;
                let totalDist = 0;
                let count = 0;
                const step = 1; 
                for (let i = 0; i < posAttr.count; i += step) {
                    const x = posAttr.getX(i);
                    const y = posAttr.getY(i);
                    const z = posAttr.getZ(i);
                    totalDist += Math.sqrt(x*x + y*y + z*z);
                    count++;
                }
                const avgRadius = count > 0 ? totalDist / count : 0;
                
                // Use a multiplier for visual bounding
                const robustRadius = avgRadius * 2.0; 

                const material = new THREE.PointsMaterial({
                    size: 0.12,  // Fine points (not chunky)
                    vertexColors: true,
                    sizeAttenuation: true,
                    transparent: true,
                    opacity: 1.0
                });

                const cluster = this.clusters.get(path);
                if (cluster) {
                    cluster.setPointCloud(geometry, material);
                    // Store the original centroid offset if we ever need to recover absolute coords
                    cluster.centroid.copy(center);
                    
                    // Use our robust radius instead of the bounding sphere radius
                    cluster.radius = robustRadius; 
                }
            }
        } catch (e) {
            console.warn(`Error loading ${path}:`, e);
        }
    }

    flattenStructure(structure) {
        const flatPaths = [];
        
        const traverse = (obj, prefix = '') => {
            for (const [key, value] of Object.entries(obj)) {
                // If value has a 'type', it is a concrete node (e.g. ba_output or merged)
                if (value && typeof value === 'object' && value.type) {
                    const path = prefix ? `${prefix}/${key}` : key;
                    flatPaths.push({
                        path,
                        type: value.type,
                        children: value.children || []
                    });
                } 
                
                // Recurse if it's an object (container or node with children)
                if (value && typeof value === 'object') {
                     // If it doesn't have a type, it's a container like C_1, so we definitely recurse.
                     // If it DOES have a type (like 'merged'), we generally don't expect children NODES inside it
                     // in this structure definition (children are property, not nested keys).
                     // The nested keys are usually siblings or inside containers.
                     // But our structure uses keys for path construction.
                     
                     const path = prefix ? `${prefix}/${key}` : key;
                     
                     if (!value.type) {
                         traverse(value, path);
                     }
                }
            }
        };
        
        traverse(structure);
        return flatPaths;
    }

    getStructure() {
        return {
            'ba_gt': { type: 'ba_output', children: [] },
            'ba_input': { type: 'ba_output', children: [] },
            'ba_output': { type: 'ba_output', children: [] },
            'C_1': {
                'ba_output': { type: 'ba_output', children: [] },
                'C_1_1': {
                    'ba_output': { type: 'ba_output', children: [] },
                    'merged': { type: 'merged', children: ['C_1/C_1_1/ba_output'] }
                },
                'C_1_2': {
                    'ba_output': { type: 'ba_output', children: [] },
                    'merged': { type: 'merged', children: ['C_1/C_1_2/ba_output'] }
                },
                'merged': { type: 'merged', children: ['C_1/ba_output', 'C_1/C_1_1/merged', 'C_1/C_1_2/merged'] }
            },
            'C_2': {
                'ba_output': { type: 'ba_output', children: [] },
                'merged': { type: 'merged', children: ['C_2/ba_output'] }
            },
            'C_3': {
                'ba_output': { type: 'ba_output', children: [] },
                'merged': { type: 'merged', children: ['C_3/ba_output'] }
            },
            'C_4': {
                'ba_output': { type: 'ba_output', children: [] },
                'C_4_1': {
                    'ba_output': { type: 'ba_output', children: [] },
                    'C_4_1_1': {
                        'ba_output': { type: 'ba_output', children: [] },
                        'merged': { type: 'merged', children: ['C_4/C_4_1/C_4_1_1/ba_output'] }
                    },
                    'C_4_1_2': {
                        'ba_output': { type: 'ba_output', children: [] },
                        'merged': { type: 'merged', children: ['C_4/C_4_1/C_4_1_2/ba_output'] }
                    },
                    'merged': { type: 'merged', children: ['C_4/C_4_1/ba_output', 'C_4/C_4_1/C_4_1_1/merged', 'C_4/C_4_1/C_4_1_2/merged'] }
                },
                'C_4_2': {
                    'ba_output': { type: 'ba_output', children: [] },
                    'C_4_2_1': {
                        'ba_output': { type: 'ba_output', children: [] },
                        'merged': { type: 'merged', children: ['C_4/C_4_2/C_4_2_1/ba_output'] }
                    },
                    'C_4_2_2': {
                        'ba_output': { type: 'ba_output', children: [] },
                        'merged': { type: 'merged', children: ['C_4/C_4_2/C_4_2_2/ba_output'] }
                    },
                    'merged': { type: 'merged', children: ['C_4/C_4_2/ba_output', 'C_4/C_4_2/C_4_2_1/merged', 'C_4/C_4_2/C_4_2_2/merged'] }
                },
                'merged': { type: 'merged', children: ['C_4/ba_output', 'C_4/C_4_1/merged', 'C_4/C_4_2/merged'] }
            },
            'merged':