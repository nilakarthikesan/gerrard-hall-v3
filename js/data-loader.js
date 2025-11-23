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
            const fullPath = `../data/gerrard-hall/results/${path}`;
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
                
                const material = new THREE.PointsMaterial({
                    size: 0.025,
                    vertexColors: true,
                    sizeAttenuation: true,
                    transparent: true,
                    opacity: 1.0
                });

                const cluster = this.clusters.get(path);
                if (cluster) {
                    cluster.setPointCloud(geometry, material);
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
                if (typeof value === 'object' && value.type) {
                    const path = prefix ? `${prefix}/${key}` : key;
                    flatPaths.push({
                        path,
                        type: value.type,
                        children: value.children || []
                    });
                    // If it has nested objects that aren't just type/children defs
                    // We need to traverse them too. In the provided structure, children are keys alongside type.
                    for (const [subKey, subValue] of Object.entries(value)) {
                        if (subKey !== 'type' && subKey !== 'children' && typeof subValue === 'object') {
                             // This is a nested node like 'C_1_1' inside 'C_1'
                             // But wait, the structure in v2 was: 'C_1': { 'ba_output': ..., 'C_1_1': ... }
                             // So we recurse on the value itself
                        }
                    }
                    
                    // Actually, looking at v2 traverse logic:
                    /*
                    if (typeof value === 'object' && value.type) {
                        // It's a leaf or merged node definition
                        ... push ...
                        // Check for nested objects
                        if (typeof value === 'object' && !value.type) { ... } -> this logic in v2 was slightly weird/redundant?
                    }
                    */
                   // Let's stick to the exact structure object and traverse it carefully.
                   // The structure object mixes keys that are paths parts (C_1) and keys that are properties (type).
                   // Actually, looking at v2: 
                   // 'C_1': { 'ba_output': {type...}, 'C_1_1': {...} }
                   // So we traverse keys. If a key value has a 'type', it's a path node.
                   // But 'C_1' itself isn't a path node in the flattened list? 
                   // No, v2 flatPaths pushed 'C_1/ba_output' and 'C_1/merged'.
                   // It didn't push 'C_1' itself.
                }
            }
        };
        
        // Let's replicate v2 logic exactly but cleaned up
        const traverseV2 = (obj, prefix = '') => {
            for (const [key, value] of Object.entries(obj)) {
                // If value has a 'type', it is a concrete node (e.g. ba_output or merged)
                if (value && typeof value === 'object' && value.type) {
                    const path = prefix ? `${prefix}/${key}` : key;
                    flatPaths.push({
                        path,
                        type: value.type,
                        children: value.children || []
                    });
                    // But wait, does it have children nodes inside it?
                    // In v2 structure:
                    // 'C_1_1': { 'ba_output': {type...}, 'merged': {type...} }
                    // Here 'C_1_1' does NOT have a type. It's a container.
                    // 'ba_output' HAS a type.
                } 
                
                // Recurse if it's an object (container or node with children)
                if (value && typeof value === 'object') {
                     // If it has a type, it's a node, but might contain nothing else relevant to traverse 
                     // (in v2 structure, leaf nodes like ba_output don't have sub-keys except children array)
                     // BUT container nodes like 'C_1' don't have type, so they fall here.
                     
                     // The recursion path:
                     const path = prefix ? `${prefix}/${key}` : key;
                     
                     // If this node was a typed node (e.g. 'merged'), we shouldn't recurse *inside* it for more nodes 
                     // unless the structure implies it. 
                     // In v2, 'merged' nodes don't contain other nodes.
                     // 'C_1' contains 'ba_output' and 'merged'.
                     
                     if (!value.type) {
                         traverseV2(value, path);
                     }
                }
            }
        };
        
        traverseV2(this.getStructure());
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
                    'merged': { type: 'merged', children: ['C_1_1/ba_output'] }
                },
                'C_1_2': {
                    'ba_output': { type: 'ba_output', children: [] },
                    'merged': { type: 'merged', children: ['C_1_2/ba_output'] }
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
