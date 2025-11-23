import * as THREE from 'three';

export class LayoutEngine {
    constructor(clusters) {
        this.clusters = clusters; // Map<path, Cluster>
        this.root = this.clusters.get('merged');
        
        // Layout Constants
        this.LEVEL_HEIGHT = 3.0; // Vertical distance between parent and child
        this.LEAF_SPACING = 4.0; // Horizontal distance between leaves
    }

    computeLayout() {
        if (!this.root) {
            console.warn("LayoutEngine: No root 'merged' cluster found.");
            return;
        }

        // 1. Identify all nodes in the tree (BFS/DFS from root)
        // This excludes disconnected nodes like 'ba_gt' if they aren't linked.
        const visited = new Set();
        const traverse = (node) => {
            visited.add(node);
            for (const child of node.children) {
                traverse(child);
            }
        };
        traverse(this.root);

        // 2. Compute X/Y using a simple tree layout
        // We place leaves at the bottom (or top).
        // Let's put Root at (0,0), children below it.
        // Actually, Frank's vision implies a "Slab". 
        // Usually merge trees are drawn with leaves at the bottom merging UP to the root.
        // But standard tree layouts often put root at top.
        // Let's put Root at Top (Y=0), Children at Y < 0.
        
        // We'll use a "Reingold-Tilford" style but simplified:
        // Post-order traversal: Compute width of subtrees.
        // We essentially want to stack leaves side-by-side.
        
        let currentLeafX = 0;
        
        const layoutNode = (node, depth) => {
            // If leaf (of the tree structure, i.e. no children in the merge tree)
            if (node.children.length === 0) {
                node.slabPosition.x = currentLeafX;
                node.slabPosition.y = -depth * this.LEVEL_HEIGHT;
                node.slabPosition.z = 0;
                currentLeafX += this.LEAF_SPACING;
            } else {
                // Process children first
                let childrenXSum = 0;
                node.children.forEach(child => {
                    layoutNode(child, depth + 1);
                    childrenXSum += child.slabPosition.x;
                });
                
                // Center parent over children
                node.slabPosition.x = childrenXSum / node.children.length;
                node.slabPosition.y = -depth * this.LEVEL_HEIGHT;
                node.slabPosition.z = 0;
            }
            
            // Also, assign this position to the actual Three.js group
            node.group.position.copy(node.slabPosition);
        };

        // Reset leaf counter
        // We want the tree centered around X=0 roughly.
        // We'll center it after computing.
        currentLeafX = 0;
        
        layoutNode(this.root, 0);

        // 3. Center the layout
        // Find bounds
        let minX = Infinity, maxX = -Infinity;
        visited.forEach(node => {
            minX = Math.min(minX, node.slabPosition.x);
            maxX = Math.max(maxX, node.slabPosition.x);
        });
        
        const centerOffset = (minX + maxX) / 2;
        visited.forEach(node => {
            node.slabPosition.x -= centerOffset;
            node.group.position.x = node.slabPosition.x;
        });

        // 4. Handle isolated clusters (ba_gt, ba_input)
        // Just place them to the side or hide them for now.
        // Let's place them far left/right so they don't overlap.
        let extraX = (maxX - minX) / 2 + 10;
        for (const [path, cluster] of this.clusters) {
            if (!visited.has(cluster)) {
                cluster.slabPosition.set(extraX, 0, 0);
                cluster.group.position.copy(cluster.slabPosition);
                extraX += 5.0;
            }
        }
        
        console.log("Layout computed.");
    }
}
