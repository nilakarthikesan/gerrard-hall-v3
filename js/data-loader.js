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
        this.slabPosition = new THREE.Vector3();  // Position in the layout
        this.originalCenter = new THREE.Vector3(); // Original center in world coords (for puzzle effect)
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
        this.globalCenter = new THREE.Vector3();
        this.globalRadius = 0;
        this.scaleFactor = 1.0;
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

        // Load geometry - KEEP ORIGINAL COORDINATES
        const promises = flatPaths.map(async (item) => {
            await this.loadPointCloud(item.path);
            loaded++;
            if (this.onProgress) this.onProgress(loaded, total);
        });

        await Promise.all(promises);
        
        // After all clusters loaded, compute global bounds and normalize
        this.computeGlobalBoundsAndNormalize();
        
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
                
                // Compute bounding sphere for radius
                geometry.computeBoundingSphere();
                const originalRadius = geometry.boundingSphere.radius;
                
                // Compute CENTROID (center of mass) - this is where this cluster belongs in the building
                // The centroid is more accurate than bounding sphere center for asymmetric point clouds
                const posAttr = geometry.attributes.position;
                let sumX = 0, sumY = 0, sumZ = 0;
                for (let i = 0; i < posAttr.count; i++) {
                    sumX += posAttr.getX(i);
                    sumY += posAttr.getY(i);
                    sumZ += posAttr.getZ(i);
                }
                const originalCenter = new THREE.Vector3(
                    sumX / posAttr.count,
                    sumY / posAttr.count,
                    sumZ / posAttr.count
                );

                // Simple point material - small crisp points, no texture
                const material = new THREE.PointsMaterial({
                    size: 1.5,  // Small pixel size
                    vertexColors: true,
                    sizeAttenuation: false,  // Fixed pixel size regardless of distance
                    transparent: false,
                    opacity: 1.0
                });

                const cluster = this.clusters.get(path);
                if (cluster) {
                    cluster.setPointCloud(geometry, material);
                    // Store the original center for puzzle assembly effect
                    cluster.originalCenter.copy(originalCenter);
                    cluster.centroid.copy(originalCenter);
                    cluster.radius = originalRadius;
                }
            }
        } catch (e) {
            console.warn(`Error loading ${path}:`, e);
        }
    }
    
    computeGlobalBoundsAndNormalize() {
        // Find the global bounding box of ALL clusters
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        for (const [path, cluster] of this.clusters) {
            if (cluster.pointCloud && cluster.pointCloud.geometry) {
                const pos = cluster.pointCloud.geometry.attributes.position;
                for (let i = 0; i < pos.count; i++) {
                    const x = pos.getX(i);
                    const y = pos.getY(i);
                    const z = pos.getZ(i);
                    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
                    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
                }
            }
        }
        
        // Use the MERGED cluster's CENTROID (center of mass) as the global center
        // This ensures the final building is visually centered at (0,0,0)
        const mergedCluster = this.clusters.get('merged');
        if (mergedCluster && mergedCluster.pointCloud && mergedCluster.pointCloud.geometry) {
            const geom = mergedCluster.pointCloud.geometry;
            const pos = geom.attributes.position;
            let sumX = 0, sumY = 0, sumZ = 0;
            for (let i = 0; i < pos.count; i++) {
                sumX += pos.getX(i);
                sumY += pos.getY(i);
                sumZ += pos.getZ(i);
            }
            this.globalCenter.set(
                sumX / pos.count,
                sumY / pos.count,
                sumZ / pos.count
            );
            console.log("Using merged cluster CENTROID for global centering");
        } else {
            // Fallback to bounding box center
            this.globalCenter.set(
                (minX + maxX) / 2,
                (minY + maxY) / 2,
                (minZ + maxZ) / 2
            );
            console.log("Using bounding box center for global centering");
        }
        
        const sizeX = maxX - minX;
        const sizeY = maxY - minY;
        const sizeZ = maxZ - minZ;
        this.globalRadius = Math.sqrt(sizeX*sizeX + sizeY*sizeY + sizeZ*sizeZ) / 2;
        
        console.log("=== GLOBAL BOUNDS ===");
        console.log(`Center: (${this.globalCenter.x.toFixed(2)}, ${this.globalCenter.y.toFixed(2)}, ${this.globalCenter.z.toFixed(2)})`);
        console.log(`Size: ${sizeX.toFixed(2)} x ${sizeY.toFixed(2)} x ${sizeZ.toFixed(2)}`);
        console.log(`Radius: ${this.globalRadius.toFixed(2)}`);
        
        // Scale factor to make the building fill a good portion of the screen
        // Target size of ~150 units for better visibility
        const TARGET_SIZE = 150;
        this.scaleFactor = this.globalRadius > 0 ? TARGET_SIZE / this.globalRadius : 1.0;
        
        console.log(`Scale factor: ${this.scaleFactor.toFixed(2)}`);
        
        // Now normalize all clusters:
        // 1. Center them around (0,0,0)
        // 2. Scale them uniformly
        for (const [path, cluster] of this.clusters) {
            if (cluster.pointCloud && cluster.pointCloud.geometry) {
                const geometry = cluster.pointCloud.geometry;
                
                // Translate to center around global origin
                geometry.translate(
                    -this.globalCenter.x,
                    -this.globalCenter.y,
                    -this.globalCenter.z
                );
                
                // Scale uniformly
                geometry.scale(this.scaleFactor, this.scaleFactor, this.scaleFactor);
                
                // Update bounding sphere
                geometry.computeBoundingSphere();
                
                // Update cluster's original center (also needs to be transformed)
                cluster.originalCenter.sub(this.globalCenter);
                cluster.originalCenter.multiplyScalar(this.scaleFactor);
                
                // Update radius
                cluster.radius = geometry.boundingSphere.radius;
                
                // Update point size - balanced for visibility without being blocky
                cluster.pointCloud.material.size = 0.6;  // Smaller points for finer detail
            }
        }
        
        console.log("\nCluster original centers (normalized):");
        for (const [path, cluster] of this.clusters) {
            if (cluster.originalCenter) {
                console.log(`  ${path}: (${cluster.originalCenter.x.toFixed(1)}, ${cluster.originalCenter.y.toFixed(1)}, ${cluster.originalCenter.z.toFixed(1)})`);
            }
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
            'merged': { type: 'merged', children: ['ba_output', 'C_1/merged', 'C_2/merged', 'C_3/merged', 'C_4/merged'] }
        };
    }
}
