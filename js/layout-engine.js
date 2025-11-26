import * as THREE from 'three';

export class LayoutEngine {
    constructor(clusters) {
        this.clusters = clusters; // Map<path, Cluster>
        this.root = this.clusters.get('merged');
        
        // Explode factor - how much to spread clusters apart initially
        this.EXPLODE_FACTOR = 2.5;  // Multiplier for spreading clusters apart
        
        console.log("=== LAYOUT ENGINE INITIALIZED ===");
        console.log(`Total clusters loaded: ${clusters.size}`);
        console.log(`Root cluster found: ${this.root ? 'YES' : 'NO'}`);
        console.log(`Explode factor: ${this.EXPLODE_FACTOR}`);
    }

    computeLayout() {
        console.log("\n=== COMPUTING PUZZLE LAYOUT ===");
        console.log("Goal: Exploded view that assembles into final building");
        
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
            for (const child of node.children) {
                traverse(child, depth + 1);
            }
        };
        traverse(this.root, 0);
        
        console.log(`Total nodes in tree: ${visited.size}`);

        // Step 2: For each cluster, compute its "exploded" position
        // The exploded position is the original center pushed outward from the global center
        console.log("\n--- Step 2: Computing exploded positions ---");
        
        let maxDepth = 0;
        nodeDepths.forEach((depth) => {
            if (depth > maxDepth) maxDepth = depth;
        });
        
        visited.forEach(node => {
            // The original center is where this cluster belongs in the final building
            // For the exploded view, we push it outward
            const originalCenter = node.originalCenter.clone();
            
            // Direction from center (0,0,0) to this cluster's original position
            const direction = originalCenter.clone();
            const distance = direction.length();
            
            if (distance > 0.001) {
                direction.normalize();
            } else {
                // If at center, push in a random direction based on path hash
                const hash = this.hashString(node.path);
                direction.set(
                    Math.cos(hash * 6.28),
                    Math.sin(hash * 6.28),
                    0
                );
            }
            
            // Exploded position = original position * explode factor
            // Plus additional spread based on depth (deeper = further out)
            const depth = nodeDepths.get(node);
            const depthMultiplier = 1 + (depth / maxDepth) * 0.5; // Leaves spread more
            
            const explodedPos = originalCenter.clone().multiplyScalar(this.EXPLODE_FACTOR * depthMultiplier);
            
            // Store both positions
            node.slabPosition.copy(explodedPos);  // Start position (exploded)
            node.assembledPosition = originalCenter.clone();  // End position (assembled)
            
            // Set initial position
            node.group.position.copy(node.slabPosition);
        });

        // Step 3: Calculate bounds for camera
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        visited.forEach(node => {
            const r = node.radius || 10;
            const pos = node.slabPosition;
            minX = Math.min(minX, pos.x - r);
            maxX = Math.max(maxX, pos.x + r);
            minY = Math.min(minY, pos.y - r);
            maxY = Math.max(maxY, pos.y + r);
            minZ = Math.min(minZ, pos.z - r);
            maxZ = Math.max(maxZ, pos.z + r);
        });

        this.bounds = {
            width: maxX - minX,
            height: maxY - minY,
            depth: maxZ - minZ,
            minX, maxX, minY, maxY, minZ, maxZ
        };
        
        console.log(`Layout bounds: ${this.bounds.width.toFixed(1)} x ${this.bounds.height.toFixed(1)} x ${this.bounds.depth.toFixed(1)}`);

        // Log positions
        console.log("\nCluster positions (exploded -> assembled):");
        visited.forEach(node => {
            const type = node.children.length === 0 ? 'LEAF' : 'NODE';
            const exp = node.slabPosition;
            const asm = node.assembledPosition;
            console.log(`  [${type}] ${node.path}:`);
            console.log(`    Exploded: (${exp.x.toFixed(1)}, ${exp.y.toFixed(1)}, ${exp.z.toFixed(1)})`);
            console.log(`    Assembled: (${asm.x.toFixed(1)}, ${asm.y.toFixed(1)}, ${asm.z.toFixed(1)})`);
        });

        // Step 4: Handle orphaned clusters (hide them)
        console.log("\n--- Step 3: Handling orphans ---");
        
        let orphans = [];
        for (const [path, cluster] of this.clusters) {
            if (!visited.has(cluster)) {
                orphans.push(path);
                cluster.group.visible = false;
            }
        }
        
        if (orphans.length > 0) {
            console.warn(`Orphaned clusters (hidden): ${orphans.join(', ')}`);
        } else {
            console.log("No orphaned clusters.");
        }
        
        console.log("\n=== LAYOUT COMPLETE ===");
        console.log(`Clusters start EXPLODED and will ASSEMBLE into final building`);
    }
    
    // Simple hash function for consistent "random" directions
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return (hash % 1000) / 1000;
    }
}
