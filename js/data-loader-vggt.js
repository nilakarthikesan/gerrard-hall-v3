import * as THREE from 'three';

export class Cluster {
    constructor(path, type, childrenPaths = []) {
        this.path = path;
        this.type = type; // 'vggt' or 'merged'
        this.childrenPaths = childrenPaths;
        
        this.group = new THREE.Group();
        this.pointCloud = null;
        this.pointsCount = 0;
        
        // Layout properties
        this.slabPosition = new THREE.Vector3();
        this.originalCenter = new THREE.Vector3();
        this.radius = 0;
        this.centroid = new THREE.Vector3();
        
        // Rectangle region assigned by squareness layout
        this.rect = null; // { x, y, w, h }
        
        // Parent/Child references
        this.parent = null;
        this.children = [];
    }

    setPointCloud(geometry, material) {
        this.pointCloud = new THREE.Points(geometry, material);
        this.pointCloud.userData = { cluster: this };
        this.group.add(this.pointCloud);
        
        geometry.computeBoundingSphere();
        this.centroid.copy(geometry.boundingSphere.center);
        this.radius = geometry.boundingSphere.radius;
        this.pointsCount = geometry.attributes.position.count;
    }
}

export class VGGTDataLoader {
    constructor() {
        this.clusters = new Map();
        this.root = null;
        this.globalCenter = new THREE.Vector3();
        this.globalRadius = 0;
        this.scaleFactor = 1.0;
    }

    async load() {
        const structure = this.getStructure();
        const flatPaths = this.flattenStructure(structure);

        let loaded = 0;
        const total = flatPaths.length;

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
        
        this.computeGlobalBoundsAndNormalize();
        
        return this.clusters;
    }

    async loadPointCloud(path) {
        try {
            const fullPath = `data/gerrard-hall-vggt/results/${path}`;
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
                
                const colorAttr = new THREE.Float32BufferAttribute(colors, 3);
                geometry.setAttribute('color', colorAttr);
                
                geometry.computeBoundingSphere();
                const originalRadius = geometry.boundingSphere.radius;
                
                // Compute centroid (center of mass)
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

                const material = new THREE.PointsMaterial({
                    size: 3.0,
                    vertexColors: true,
                    sizeAttenuation: false,
                    transparent: true,
                    opacity: 1.0
                });

                const cluster = this.clusters.get(path);
                if (cluster) {
                    cluster.setPointCloud(geometry, material);
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
        
        // Use the final merged cluster's centroid as the global center
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
        } else {
            this.globalCenter.set(
                (minX + maxX) / 2,
                (minY + maxY) / 2,
                (minZ + maxZ) / 2
            );
        }
        
        const sizeX = maxX - minX;
        const sizeY = maxY - minY;
        const sizeZ = maxZ - minZ;
        this.globalRadius = Math.sqrt(sizeX*sizeX + sizeY*sizeY + sizeZ*sizeZ) / 2;
        
        const TARGET_SIZE = 300;
        this.scaleFactor = this.globalRadius > 0 ? TARGET_SIZE / this.globalRadius : 1.0;
        
        for (const [path, cluster] of this.clusters) {
            if (cluster.pointCloud && cluster.pointCloud.geometry) {
                const geometry = cluster.pointCloud.geometry;
                
                geometry.translate(
                    -this.globalCenter.x,
                    -this.globalCenter.y,
                    -this.globalCenter.z
                );
                
                geometry.scale(this.scaleFactor, this.scaleFactor, this.scaleFactor);
                
                // Rotate to show front view of Gerrard Hall right-side up
                geometry.rotateX(Math.PI);
                geometry.rotateY(Math.PI);
                
                geometry.computeBoundingSphere();
                
                // Update cluster's original center with the same transforms
                cluster.originalCenter.sub(this.globalCenter);
                cluster.originalCenter.multiplyScalar(this.scaleFactor);
                const x = cluster.originalCenter.x;
                const y = cluster.originalCenter.y;
                const z = cluster.originalCenter.z;
                cluster.originalCenter.x = -x;
                cluster.originalCenter.y = -y;
                cluster.originalCenter.z = z;
                
                cluster.radius = geometry.boundingSphere.radius;
                
                cluster.pointCloud.material.size = 2.0;
                cluster.pointCloud.material.needsUpdate = true;
            }
        }
    }

    flattenStructure(structure) {
        const flatPaths = [];
        
        const traverse = (obj, prefix = '') => {
            for (const [key, value] of Object.entries(obj)) {
                if (value && typeof value === 'object' && value.type) {
                    const path = prefix ? `${prefix}/${key}` : key;
                    flatPaths.push({
                        path,
                        type: value.type,
                        children: value.children || []
                    });
                } 
                
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
        // New VGGT pipeline structure for Gerrard Hall
        // vggt = per-cluster reconstruction (replaces ba_output)
        // merged = vggt + children's results (only for non-leaf nodes)
        // Leaf nodes: their vggt IS their final result
        return {
            // Root level vggt
            'vggt': { type: 'vggt', children: [] },
            
            // C_1: leaf cluster (no children, no merged)
            'C_1': {
                'vggt': { type: 'vggt', children: [] }
            },
            
            // C_2: has 2 children (C_2_1, C_2_2)
            'C_2': {
                'vggt': { type: 'vggt', children: [] },
                'C_2_1': {
                    'vggt': { type: 'vggt', children: [] }
                },
                'C_2_2': {
                    'vggt': { type: 'vggt', children: [] }
                },
                'merged': { type: 'merged', children: ['C_2/vggt', 'C_2/C_2_1/vggt', 'C_2/C_2_2/vggt'] }
            },
            
            // C_3: has 2 children (C_3_1, C_3_2)
            'C_3': {
                'vggt': { type: 'vggt', children: [] },
                'C_3_1': {
                    'vggt': { type: 'vggt', children: [] },
                    'C_3_1_1': {
                        'vggt': { type: 'vggt', children: [] },
                        'C_3_1_1_1': {
                            'vggt': { type: 'vggt', children: [] }
                        },
                        'C_3_1_1_2': {
                            'vggt': { type: 'vggt', children: [] }
                        },
                        'merged': { type: 'merged', children: ['C_3/C_3_1/C_3_1_1/vggt', 'C_3/C_3_1/C_3_1_1/C_3_1_1_1/vggt', 'C_3/C_3_1/C_3_1_1/C_3_1_1_2/vggt'] }
                    },
                    'C_3_1_2': {
                        'vggt': { type: 'vggt', children: [] }
                    },
                    'merged': { type: 'merged', children: ['C_3/C_3_1/vggt', 'C_3/C_3_1/C_3_1_1/merged', 'C_3/C_3_1/C_3_1_2/vggt'] }
                },
                'C_3_2': {
                    'vggt': { type: 'vggt', children: [] }
                },
                'merged': { type: 'merged', children: ['C_3/vggt', 'C_3/C_3_1/merged', 'C_3/C_3_2/vggt'] }
            },
            
            // Root merged (final reconstruction)
            'merged': { type: 'merged', children: ['vggt', 'C_1/vggt', 'C_2/merged', 'C_3/merged'] }
        };
    }
}
