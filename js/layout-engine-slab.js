import * as THREE from 'three';

/**
 * Slab Layout Engine
 * Arranges clusters on transparent "sheets of glass" stacked vertically
 * Each sheet represents a level in the merge tree
 * Leaves at bottom, root at top - matching Frank's vision
 */
export class SlabLayoutEngine {
    constructor(clusters) {
        this.clusters = clusters;
        this.rootCluster = clusters.get('merged');
        this.bounds = null;
        
        // Layout parameters
        this.SHEET_SPACING = 40;     // Vertical distance between levels (larger for clear separation)
        this.CLUSTER_SPACING = 10;   // Horizontal spacing between clusters (tight layout)
        this.SHEET_OPACITY = 0;      // Invisible sheets (conceptual layering only)
        this.SHEET_COLOR = 0x88ccff; // Light blue tint (not rendered)
        this.SHOW_SHEETS = false;    // Don't render the glass sheet meshes
        
        // Storage for sheet meshes and tree data
        this.sheetMeshes = [];       // Array of THREE.Mesh for each glass sheet
        this.treeNodes = [];         // All nodes in the tree
        this.levelNodes = new Map(); // Map of level -> array of nodes at that level
        this.maxDepth = 0;
        
        console.log("=== SLAB LAYOUT ENGINE ===");
        console.log(`Total clusters loaded: ${clusters.size}`);
        console.log(`Root cluster found: ${this.rootCluster ? 'YES' : 'NO'}`);
    }

    computeLayout() {
        if (!this.rootCluster) {
            console.error("No root cluster (merged) found!");
            return;
        }

        console.log("\n=== COMPUTING SLAB LAYOUT ===");
        console.log("Goal: Clusters on transparent glass sheets, leaves at bottom, root at top");

        // Step 1: Build tree and collect all nodes with depth info
        const visited = new Set();
        
        const traverse = (cluster, depth = 0) => {
            if (!cluster || visited.has(cluster.path)) return null;
            visited.add(cluster.path);
            
            const node = { 
                cluster, 
                depth, 
                children: [],
                x: 0,
                y: 0,
                z: 0,
                level: 0  // Will be computed after we know maxDepth
            };
            
            this.treeNodes.push(node);
            
            // Traverse children
            if (cluster.children && cluster.children.length > 0) {
                for (const child of cluster.children) {
                    if (child) {
                        const childNode = traverse(child, depth + 1);
                        if (childNode) {
                            node.children.push(childNode);
                        }
                    }
                }
            }
            
            return node;
        };
        
        const rootNode = traverse(this.rootCluster);
        
        // Step 2: Compute max depth and assign levels (inverted: leaves at bottom)
        this.maxDepth = Math.max(...this.treeNodes.map(n => n.depth));
        console.log(`Max depth: ${this.maxDepth}`);
        console.log(`Total nodes: ${this.treeNodes.length}`);
        
        // Level 0 = leaves (bottom), Level maxDepth = root (top)
        for (const node of this.treeNodes) {
            node.level = this.maxDepth - node.depth;
            
            // Group nodes by level
            if (!this.levelNodes.has(node.level)) {
                this.levelNodes.set(node.level, []);
            }
            this.levelNodes.get(node.level).push(node);
        }
        
        // Debug: Print cluster counts per level
        console.log("\n=== CLUSTERS PER LEVEL ===");
        for (let level = 0; level <= this.maxDepth; level++) {
            const clusters = this.levelNodes.get(level) || [];
            console.log(`Level ${level}: ${clusters.length} clusters`);
            clusters.forEach(n => console.log(`  - ${n.cluster.path}`));
        }
        console.log("(Level 0 = leaves/bottom, Level " + this.maxDepth + " = root/top)");
        
        // Step 3: Assign X positions using Reingold-Tilford-like algorithm
        let nextX = 0;
        
        const assignX = (node) => {
            if (node.children.length === 0) {
                // Leaf node - assign next available X
                node.x = nextX;
                nextX += this.CLUSTER_SPACING;
            } else {
                // Internal node - position at center of children
                for (const child of node.children) {
                    assignX(child);
                }
                const firstChild = node.children[0];
                const lastChild = node.children[node.children.length - 1];
                node.x = (firstChild.x + lastChild.x) / 2;
            }
        };
        
        assignX(rootNode);
        
        // Step 4: Assign Y positions based on level (vertical stacking)
        // Keep all levels close together so animation stays on screen
        // Use smaller spacing to keep everything visible
        const VISUAL_SPACING = 25; // Smaller than SHEET_SPACING for compact view
        const totalHeight = this.maxDepth * VISUAL_SPACING;
        const yOffset = -totalHeight / 2; // Center around Y=0
        
        for (const node of this.treeNodes) {
            node.y = node.level * VISUAL_SPACING + yOffset;
            node.z = 0; // Constant Z - the "thin slab"
        }
        
        // Store visual spacing for animation engine
        this.VISUAL_SPACING = VISUAL_SPACING;
        
        // Step 5: Center the layout horizontally
        const centerX = rootNode.x;
        for (const node of this.treeNodes) {
            node.x -= centerX;
        }
        
        // Step 6: Compute bounds for each level (for sheet sizing)
        const levelBounds = new Map();
        for (const [level, nodes] of this.levelNodes) {
            const xs = nodes.map(n => n.x);
            levelBounds.set(level, {
                minX: Math.min(...xs) - 15,
                maxX: Math.max(...xs) + 15,
                y: level * this.SHEET_SPACING + yOffset
            });
        }
        
        // Step 7: Create glass sheet meshes for each level
        this.createSheetMeshes(levelBounds);
        
        // Step 8: Apply positions to clusters
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        for (const node of this.treeNodes) {
            const cluster = node.cluster;
            
            // Store slab position
            cluster.slabPosition = new THREE.Vector3(node.x, node.y, node.z);
            cluster.slabLevel = node.level;
            
            // Set initial position
            cluster.group.position.copy(cluster.slabPosition);
            
            // Rotate cluster for correct orientation:
            // - 180 degrees around X-axis to flip right-side up
            // - 180 degrees around Y-axis to show front view (columned entrance)
            cluster.group.rotation.x = Math.PI;
            cluster.group.rotation.y = Math.PI;
            
            // Track bounds
            minX = Math.min(minX, node.x);
            maxX = Math.max(maxX, node.x);
            minY = Math.min(minY, node.y);
            maxY = Math.max(maxY, node.y);
            
            console.log(`  ${cluster.path}: level=${node.level}, pos=(${node.x.toFixed(1)}, ${node.y.toFixed(1)})`);
        }
        
        // Store overall bounds
        this.bounds = {
            minX, maxX, minY, maxY,
            width: maxX - minX + 40,
            height: maxY - minY + 40,
            centerY: (maxY + minY) / 2
        };
        
        console.log(`Layout bounds: ${this.bounds.width.toFixed(1)} x ${this.bounds.height.toFixed(1)}`);
        console.log(`Number of sheets: ${this.sheetMeshes.length}`);
        
        // Step 9: Handle orphan clusters (not in tree)
        for (const [path, cluster] of this.clusters) {
            if (!visited.has(path)) {
                cluster.group.visible = false;
            }
        }
        
        console.log("\n=== SLAB LAYOUT COMPLETE ===");
    }
    
    createSheetMeshes(levelBounds) {
        // Skip creating visible sheet meshes if SHOW_SHEETS is false
        if (!this.SHOW_SHEETS) {
            console.log("Sheet meshes disabled - using conceptual layering only");
            return;
        }
        
        // Find the widest level to use as sheet width
        let maxWidth = 0;
        for (const [level, bounds] of levelBounds) {
            const width = bounds.maxX - bounds.minX;
            maxWidth = Math.max(maxWidth, width);
        }
        
        // Add padding to sheet size
        const sheetWidth = maxWidth + 60;
        const sheetDepth = 30; // Thin depth for the "slab" feel
        
        // Calculate Y offset for centering
        const totalHeight = this.maxDepth * this.SHEET_SPACING;
        const yOffset = -totalHeight / 2;
        
        // Create a sheet for each level
        for (let level = 0; level <= this.maxDepth; level++) {
            const geometry = new THREE.PlaneGeometry(sheetWidth, sheetDepth);
            const material = new THREE.MeshBasicMaterial({
                color: this.SHEET_COLOR,
                transparent: true,
                opacity: this.SHEET_OPACITY,
                side: THREE.DoubleSide,
                depthWrite: false  // Proper transparency layering
            });
            
            const sheet = new THREE.Mesh(geometry, material);
            const sheetY = level * this.SHEET_SPACING + yOffset;
            sheet.position.set(0, sheetY, 0);
            sheet.rotation.x = -Math.PI / 2;  // Horizontal orientation
            
            // Store level info on the mesh
            sheet.userData.level = level;
            sheet.userData.originalOpacity = this.SHEET_OPACITY;
            
            this.sheetMeshes.push(sheet);
            
            console.log(`Created sheet for level ${level} at Y=${sheetY}`);
        }
    }
    
    /**
     * Get all sheet meshes to add to scene
     */
    getSheetMeshes() {
        return this.sheetMeshes;
    }
    
    /**
     * Get sheet mesh for a specific level
     */
    getSheetAtLevel(level) {
        return this.sheetMeshes.find(s => s.userData.level === level);
    }
    
    /**
     * Get all clusters at a specific level
     */
    getClustersAtLevel(level) {
        const nodes = this.levelNodes.get(level) || [];
        return nodes.map(n => n.cluster);
    }
    
    /**
     * Get the number of levels (sheets)
     */
    getNumLevels() {
        return this.maxDepth + 1;
    }
}

