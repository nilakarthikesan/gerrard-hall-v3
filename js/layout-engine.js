import * as THREE from 'three';

export class LayoutEngine {
    constructor(clusters) {
        this.clusters = clusters; // Map<path, Cluster>
        this.root = this.clusters.get('merged');
        
        // Layout Constants
        // Calculate dynamic spacing based on median cluster size
        let radii = [];
        for (const c of clusters.values()) {
            if (c.radius > 0) radii.push(c.radius);
        }
        // If no radii (empty clusters), fallback to 1.0
        const medianRadius = radii.length > 0 ? radii.sort((a,b) => a-b)[Math.floor(radii.length/2)] : 1.0;
        
        // Scale spacing: k ~ 1.0 times radius or even tighter
        // If "too small" (too much whitespace), we need TIGHTER packing.
        // Let's go aggressive: overlapping allowed slightly, or minimal gap.
        this.LEVEL_HEIGHT = medianRadius * 0.5; // Reduced from 0.8
        this.LEAF_SPACING = medianRadius * 0.2; // Reduced from 0.6 - almost overlapping on purpose to close gaps 
        
        console.log(`Layout Spacing: Level=${this.LEVEL_HEIGHT.toFixed(2)}, Leaf=${this.LEAF_SPACING.toFixed(2)}, MedianR=${medianRadius.toFixed(2)}`);
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
                // Use POSITIVE Y for depth to stack UPWARDS or DOWNWARDS consistently
                // Let's go "Up" visually: Root at top (highest Y), children below.
                // So depth 0 (root) = Y=0. Depth 1 = Y = -LEVEL_HEIGHT.
                node.slabPosition.y = -depth * this.LEVEL_HEIGHT;
                node.slabPosition.z = 0;
                currentLeafX += this.LEAF_SPACING;
            } else {
                // Process children first to determine width
                node.children.forEach(child => {
                    layoutNode(child, depth + 1);
                });
                
                // Calculate average X of children for parent placement
                let childrenXSum = 0;
                node.children.forEach(child => {
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
        // Find bounds INCLUDING cluster radii
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        visited.forEach(node => {
            const r = node.radius || 0;
            minX = Math.min(minX, node.slabPosition.x - r);
            maxX = Math.max(maxX, node.slabPosition.x + r);
            minY = Math.min(minY, node.slabPosition.y - r);
            maxY = Math.max(maxY, node.slabPosition.y + r);
        });
        
        // If layout is empty or something went wrong
        if (minX === Infinity) { minX = -10; maxX = 10; minY = -10; maxY = 10; }

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        visited.forEach(node => {
            node.slabPosition.x -= centerX;
            node.slabPosition.y -= centerY;
            node.group.position.copy(node.slabPosition);
        });

        // Calculate full bounds for camera fitting
        this.bounds = {
            minX: minX - centerX,
            maxX: maxX - centerX,
            minY: minY - centerY,
            maxY: maxY - centerY,
            width: (maxX - minX), // Removed whitespace scaling - keep it tight
            height: (maxY - minY)
        };

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
