import * as THREE from 'three';

export class LayoutEngine {
    constructor(clusters) {
        this.clusters = clusters; // Map<path, Cluster>
        this.root = this.clusters.get('merged');
        
        // FIXED SPACING VALUES
        // These determine the visual layout of the pyramid
        // LEVEL_HEIGHT: vertical distance between layers (parent to child)
        // LEAF_SPACING: horizontal distance between sibling leaves
        
        // TIGHT spacing - clusters close together to reduce whitespace
        // With TARGET_RADIUS=30, we want clusters nearly touching
        this.LEVEL_HEIGHT = 35;   // Vertical spacing (just slightly more than cluster diameter)
        this.LEAF_SPACING = 40;   // Horizontal spacing (clusters nearly touching)
        
        console.log("=== LAYOUT ENGINE INITIALIZED ===");
        console.log(`Fixed Spacing: LEVEL_HEIGHT=${this.LEVEL_HEIGHT}, LEAF_SPACING=${this.LEAF_SPACING}`);
        console.log(`Total clusters loaded: ${clusters.size}`);
        console.log(`Root cluster found: ${this.root ? 'YES' : 'NO'}`);
    }

    computeLayout() {
        console.log("\n=== COMPUTING LAYOUT ===");
        
        if (!this.root) {
            console.error("LayoutEngine: No root 'merged' cluster found!");
            console.log("Available clusters:", Array.from(this.clusters.keys()));
            return;
        }

        // Step 1: Build the tree and find all connected nodes
        console.log("\n--- Step 1: Traversing tree from root ---");
        const visited = new Set();
        const nodeDepths = new Map();
        
        const traverse = (node, depth) => {
            visited.add(node);
            nodeDepths.set(node, depth);
            console.log(`  ${'  '.repeat(depth)}[Depth ${depth}] ${node.path} (${node.children.length} children)`);
            for (const child of node.children) {
                traverse(child, depth + 1);
            }
        };
        traverse(this.root, 0);
        
        console.log(`\nTotal nodes in tree: ${visited.size}`);

        // Step 2: Find the maximum depth
        let maxDepth = 0;
        nodeDepths.forEach((depth) => {
            if (depth > maxDepth) maxDepth = depth;
        });
        console.log(`Maximum tree depth: ${maxDepth}`);

        // Step 3: Assign X positions using post-order traversal
        console.log("\n--- Step 2: Assigning positions ---");
        
        let currentLeafX = 0;
        
        const layoutNode = (node, depth) => {
            if (node.children.length === 0) {
                // LEAF NODE: Place at next available X position
                node.slabPosition.x = currentLeafX;
                currentLeafX += this.LEAF_SPACING;
            } else {
                // PARENT NODE: First layout all children
                node.children.forEach(child => {
                    layoutNode(child, depth + 1);
                });
                
                // Then place parent at center of children
                let sumX = 0;
                node.children.forEach(child => {
                    sumX += child.slabPosition.x;
                });
                node.slabPosition.x = sumX / node.children.length;
            }
            
            // Y position: ROOT at CENTER (Y=0), leaves spread out below (negative Y)
            // This ensures the final merged cluster is always at the center
            node.slabPosition.y = -depth * this.LEVEL_HEIGHT;
            
            // Z position: Always 0 (the "thin slab" constraint)
            node.slabPosition.z = 0;
        };
        
        layoutNode(this.root, 0);

        // Step 4: Center the layout so ROOT is at (0, 0)
        // This is the KEY change - we center around the ROOT, not the geometric center
        console.log("\n--- Step 3: Centering on ROOT ---");
        
        const rootX = this.root.slabPosition.x;
        const rootY = this.root.slabPosition.y;
        
        console.log(`Root position before centering: (${rootX.toFixed(1)}, ${rootY.toFixed(1)})`);

        // Offset all nodes so root is at (0, 0)
        visited.forEach(node => {
            node.slabPosition.x -= rootX;
            node.slabPosition.y -= rootY;
            node.group.position.copy(node.slabPosition);
        });

        // Calculate bounds for camera - use NODE POSITIONS ONLY, not radii
        // This prevents inflated bounds from large bounding spheres
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        visited.forEach(node => {
            // Don't include radius - just use the center point
            minX = Math.min(minX, node.slabPosition.x);
            maxX = Math.max(maxX, node.slabPosition.x);
            minY = Math.min(minY, node.slabPosition.y);
            maxY = Math.max(maxY, node.slabPosition.y);
        });

        // Add small padding for visual comfort
        const padding = 5;
        this.bounds = {
            width: (maxX - minX) + padding * 2,
            height: (maxY - minY) + padding * 2
        };
        
        console.log(`Layout bounds (positions only): ${this.bounds.width.toFixed(1)} x ${this.bounds.height.toFixed(1)}`);
        console.log(`Root now at: (0, 0)`);

        // Log final positions
        console.log("\nFinal cluster positions:");
        visited.forEach(node => {
            const type = node.children.length === 0 ? 'LEAF' : 'NODE';
            console.log(`  [${type}] ${node.path}: (${node.slabPosition.x.toFixed(1)}, ${node.slabPosition.y.toFixed(1)})`);
        });

        // Step 5: Handle orphaned clusters
        console.log("\n--- Step 4: Handling orphans ---");
        
        let orphans = [];
        let extraX = this.bounds.width / 2 + 50;
        
        for (const [path, cluster] of this.clusters) {
            if (!visited.has(cluster)) {
                orphans.push(path);
                cluster.slabPosition.set(extraX, 0, 0);
                cluster.group.position.copy(cluster.slabPosition);
                cluster.group.visible = false;
                extraX += 30;
            }
        }
        
        if (orphans.length > 0) {
            console.warn(`Orphaned clusters (hidden): ${orphans.join(', ')}`);
        } else {
            console.log("No orphaned clusters.");
        }
        
        console.log("\n=== LAYOUT COMPLETE ===");
        console.log(`Tree structure: ${visited.size} nodes`);
        console.log(`ROOT (merged) is at CENTER (0, 0)`);
        console.log(`Leaves spread out below (negative Y)`);
    }
}
