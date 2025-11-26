import * as THREE from 'three';

/**
 * Hierarchy Layout Engine
 * Arranges clusters in a tree structure showing parent-child relationships
 * Uses a "thin slab" layout where clusters are arranged in layers by depth
 */
export class HierarchyLayoutEngine {
    constructor(clusters) {
        this.clusters = clusters;
        this.rootCluster = clusters.get('merged');
        this.bounds = null;
        
        // Layout parameters - VERY COMPACT spacing for maximum visibility
        // These control how close clusters are to each other
        this.LEVEL_HEIGHT = 12;  // Vertical spacing between levels (tighter pyramid)
        this.LEAF_SPACING = 12;  // Horizontal spacing between leaf nodes (tighter grouping)
        
        console.log("=== HIERARCHY LAYOUT ENGINE ===");
        console.log(`Total clusters loaded: ${clusters.size}`);
        console.log(`Root cluster found: ${this.rootCluster ? 'YES' : 'NO'}`);
        console.log(`Layout spacing: LEVEL_HEIGHT=${this.LEVEL_HEIGHT}, LEAF_SPACING=${this.LEAF_SPACING}`);
    }

    computeLayout() {
        if (!this.rootCluster) {
            console.error("No root cluster (merged) found!");
            return;
        }

        console.log("\n=== COMPUTING HIERARCHY LAYOUT ===");
        console.log("Goal: Tree structure with parent-child relationships");

        // Step 1: Build tree and collect all nodes
        const treeNodes = [];
        const visited = new Set();
        
        const traverse = (cluster, depth = 0) => {
            if (!cluster || visited.has(cluster.path)) return;
            visited.add(cluster.path);
            
            treeNodes.push({ cluster, depth, children: [] });
            const currentNode = treeNodes[treeNodes.length - 1];
            
            // cluster.children is an array of Cluster objects (not paths)
            if (cluster.children && cluster.children.length > 0) {
                for (const child of cluster.children) {
                    if (child) {
                        const childNode = traverse(child, depth + 1);
                        if (childNode) {
                            currentNode.children.push(childNode);
                        }
                    }
                }
            }
            
            return currentNode;
        };
        
        const rootNode = traverse(this.rootCluster);
        console.log(`Total nodes in tree: ${treeNodes.length}`);
        
        // Step 2: Assign X positions using Reingold-Tilford-like algorithm
        let nextX = 0;
        
        const assignX = (node) => {
            if (node.children.length === 0) {
                // Leaf node
                node.x = nextX;
                nextX += this.LEAF_SPACING;
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
        
        // Step 3: Assign Y positions based on depth (root at top)
        const maxDepth = Math.max(...treeNodes.map(n => n.depth));
        
        for (const node of treeNodes) {
            // Root at top (Y = positive), leaves at bottom
            node.y = (maxDepth - node.depth) * this.LEVEL_HEIGHT;
            node.z = 0; // Flat "thin slab"
        }
        
        // Step 4: Center the layout
        const centerX = rootNode.x;
        for (const node of treeNodes) {
            node.x -= centerX;
        }
        
        // Step 5: Apply positions to clusters
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        for (const node of treeNodes) {
            const cluster = node.cluster;
            
            // Store hierarchy position
            cluster.hierarchyPosition = new THREE.Vector3(node.x, node.y, node.z);
            
            // Set initial position
            cluster.group.position.copy(cluster.hierarchyPosition);
            
            // Rotate cluster 180 degrees around X-axis to flip right-side up
            cluster.group.rotation.x = Math.PI;
            
            // Track bounds
            minX = Math.min(minX, node.x);
            maxX = Math.max(maxX, node.x);
            minY = Math.min(minY, node.y);
            maxY = Math.max(maxY, node.y);
            
            console.log(`  ${cluster.path}: depth=${node.depth}, pos=(${node.x.toFixed(1)}, ${node.y.toFixed(1)})`);
        }
        
        // Store bounds for camera - minimal padding for tighter view
        this.bounds = {
            minX, maxX, minY, maxY,
            width: maxX - minX + 20,  // Minimal padding
            height: maxY - minY + 20
        };
        
        console.log(`Layout bounds: ${this.bounds.width.toFixed(1)} x ${this.bounds.height.toFixed(1)}`);
        
        // Step 6: Handle orphan clusters (not in tree)
        const orphanPaths = [];
        for (const [path, cluster] of this.clusters) {
            if (!visited.has(path)) {
                cluster.group.visible = false;
                orphanPaths.push(path);
            }
        }
        if (orphanPaths.length > 0) {
            console.warn(`Orphaned clusters (hidden): ${orphanPaths.join(', ')}`);
        }
        
        // Store tree nodes for animation
        this.treeNodes = treeNodes;
        
        console.log("\n=== HIERARCHY LAYOUT COMPLETE ===");
    }
}

