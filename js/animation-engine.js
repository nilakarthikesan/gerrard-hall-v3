import * as THREE from 'three';

export class AnimationEngine {
    constructor(clusters, layoutEngine) {
        this.clusters = clusters;
        this.layoutEngine = layoutEngine; // Reference to know which clusters are in the tree
        this.activeTweens = [];
        this.mergeEvents = [];
    }

    initTimeline() {
        // Build timeline ONLY from clusters that are part of the merge tree
        // This means we skip orphans like ba_gt, ba_input
        
        const processedPaths = new Set();
        this.mergeEvents = [];

        // Get the root and traverse only connected nodes
        const root = this.clusters.get('merged');
        if (!root) {
            console.error("AnimationEngine: No 'merged' root found!");
            return this.mergeEvents;
        }

        // Collect all nodes in the merge tree (same logic as LayoutEngine)
        const treeNodes = new Set();
        const collectTreeNodes = (node) => {
            treeNodes.add(node.path);
            for (const child of node.children) {
                collectTreeNodes(child);
            }
        };
        collectTreeNodes(root);
        
        console.log("=== ANIMATION ENGINE ===");
        console.log(`Clusters in merge tree: ${treeNodes.size}`);
        console.log("Tree nodes:", Array.from(treeNodes));
            
        // Build events using POST-ORDER traversal
        // This means: children appear BEFORE parents
        // Leaves appear first, then their parents, then grandparents, etc.
        
        const addEventsPostOrder = (node) => {
            if (processedPaths.has(node.path)) return;
            
            // First, process all children (so they appear first)
            for (const child of node.children) {
                addEventsPostOrder(child);
            }
            
            // Then add this node's event
            // When this node appears, its children get hidden (they merge INTO this node)
            const hiddenPaths = node.children.map(c => c.path);
            
            this.mergeEvents.push({
                path: node.path,
                hide: hiddenPaths,
                isLeaf: node.children.length === 0
            });
            
            processedPaths.add(node.path);
        };

        addEventsPostOrder(root);
        
        console.log(`Total events: ${this.mergeEvents.length}`);
        console.log("Event order:");
        this.mergeEvents.forEach((e, i) => {
            const type = e.isLeaf ? 'LEAF' : 'MERGE';
            console.log(`  ${i+1}. [${type}] ${e.path} ${e.hide.length > 0 ? `(hides: ${e.hide.join(', ')})` : ''}`);
        });
        
        return this.mergeEvents;
    }

    // Jump to a specific event index instantly (for initialization/reset)
    applyEventInstant(index) {
        // Reset all clusters to hidden and at their EXPLODED positions
        for (const cluster of this.clusters.values()) {
            if (cluster.pointCloud) {
                cluster.pointCloud.visible = false;
                cluster.pointCloud.material.opacity = 1;
                // Start at exploded position (slabPosition)
                cluster.group.position.copy(cluster.slabPosition);
            }
            cluster.group.visible = false;
        }

        // Replay history up to index
        // As we progress, clusters move toward their ASSEMBLED positions
        for (let i = 0; i <= index; i++) {
            const event = this.mergeEvents[i];
            if (!event) continue;
            
            const cluster = this.clusters.get(event.path);
            
            if (cluster && cluster.pointCloud) {
                cluster.group.visible = true;
                cluster.pointCloud.visible = true;
                cluster.pointCloud.material.opacity = 1;
                
                // Position at assembled position (final building position)
                // This creates the "puzzle coming together" effect
                if (cluster.assembledPosition) {
                    cluster.group.position.copy(cluster.assembledPosition);
                } else {
                cluster.group.position.copy(cluster.slabPosition);
                }
            }
            
            // Hide children that merged into this cluster
            if (event.hide) {
                event.hide.forEach(childPath => {
                    const child = this.clusters.get(childPath);
                    if (child) {
                        child.group.visible = false;
                        if (child.pointCloud) child.pointCloud.visible = false;
                    }
                });
            }
        }
        
        this.activeTweens = [];
    }

    // Animate transition from index-1 to index (Forward)
    // Or index to index-1 (Backward)
    playEvent(index, direction) {
        const event = this.mergeEvents[index];
        if (!event) return;

        const parent = this.clusters.get(event.path);
        const children = event.hide ? event.hide.map(p => this.clusters.get(p)).filter(c => c) : [];

        if (direction > 0) {
            // FORWARD: Show this cluster at its assembled position
            // Children animate from their positions to the parent's assembled position, then fade out
            
            const parentAssembledPos = parent && parent.assembledPosition ? parent.assembledPosition : parent.slabPosition;
            
            // 1. Parent appears at its ASSEMBLED position (where it belongs in the building)
            if (parent && parent.pointCloud) {
                parent.group.visible = true;
                parent.pointCloud.visible = true;
                parent.pointCloud.material.opacity = 0;
                
                // Start at exploded, animate to assembled
                parent.group.position.copy(parent.slabPosition);
                
                // Animate position from exploded to assembled
                this.addTween({
                    target: parent.group.position,
                    to: parentAssembledPos.clone(),
                    duration: 1.0,
                    ease: this.easeInOutCubic
                });

                this.addTween({
                    target: parent.pointCloud.material,
                    property: 'opacity',
                    to: 1,
                    duration: 1.0,
                    ease: this.easeQuadOut
                });
            }

            // 2. Children Move to their ASSEMBLED positions & Fade Out
            // This creates the "puzzle pieces coming together" effect
            children.forEach(child => {
                if (!child.pointCloud || !child.group.visible) return;

                const start = child.group.position.clone();
                // Children move to their assembled position (where they fit in the building)
                const childAssembledPos = child.assembledPosition || child.slabPosition;
                const end = childAssembledPos.clone();
                const mid = start.clone().lerp(end, 0.5);
                
                // Arc slightly in Z for visual interest
                mid.z += 5.0;
                
                this.addTween({
                    type: 'bezier',
                    target: child.group.position,
                    start: start,
                    end: end,
                    control: mid,
                    duration: 1.2,
                    ease: this.easeInOutCubic
                });

                this.addTween({
                    target: child.pointCloud.material,
                    property: 'opacity',
                    to: 0,
                    duration: 1.2,
                    ease: this.easeQuadIn,
                    onComplete: () => {
                        child.group.visible = false;
                        child.pointCloud.visible = false;
                    }
                });
            });

        } else {
            // BACKWARD: Unmerge (Parent hides, Children appear and move back)
            
            if (parent && parent.pointCloud) {
                this.addTween({
                    target: parent.pointCloud.material,
                    property: 'opacity',
                    to: 0,
                    duration: 1.0,
                    ease: this.easeQuadOut,
                    onComplete: () => {
                        parent.group.visible = false;
                        parent.pointCloud.visible = false;
                    }
                });
            }

            children.forEach(child => {
                if (!child.pointCloud) return;
                
                child.group.visible = true;
                child.pointCloud.visible = true;
                child.group.position.copy(parent ? parent.slabPosition : child.slabPosition);
                child.pointCloud.material.opacity = 0;

                this.addTween({
                    target: child.group.position,
                    to: child.slabPosition.clone(),
                    duration: 1.0,
                    ease: this.easeInOutCubic
                });

                this.addTween({
                    target: child.pointCloud.material,
                    property: 'opacity',
                    to: 1,
                    duration: 1.0,
                    ease: this.easeQuadOut
                });
            });
        }
    }

    addTween(params) {
        this.activeTweens.push({
            ...params,
            elapsed: 0,
            start: params.type === 'bezier' ? params.start : (params.property ? params.target[params.property] : params.target.clone())
        });
    }

    update(dt) {
        for (let i = this.activeTweens.length - 1; i >= 0; i--) {
            const tween = this.activeTweens[i];
            tween.elapsed += dt;
            let progress = Math.min(tween.elapsed / tween.duration, 1);
            
            if (tween.ease) progress = tween.ease(progress);
            
            if (tween.type === 'bezier') {
                const t = progress;
                const invT = 1 - t;
                const p0 = tween.start;
                const p1 = tween.control;
                const p2 = tween.end;
                
                if (tween.target && typeof tween.target.x !== 'undefined') {
                    tween.target.x = (invT * invT * p0.x) + (2 * invT * t * p1.x) + (t * t * p2.x);
                    tween.target.y = (invT * invT * p0.y) + (2 * invT * t * p1.y) + (t * t * p2.y);
                    tween.target.z = (invT * invT * p0.z) + (2 * invT * t * p1.z) + (t * t * p2.z);
                }
                
            } else if (tween.property) {
                tween.target[tween.property] = tween.start + (tween.to - tween.start) * progress;
            } else {
                tween.target.lerpVectors(tween.start, tween.to, progress);
            }

            if (progress >= 1) {
                if (tween.onComplete) tween.onComplete();
                this.activeTweens.splice(i, 1);
            }
        }
    }

    // Easing functions
    easeQuadOut(t) { return t * (2 - t); }
    easeQuadIn(t) { return t * t; }
    easeInOutCubic(t) { return t < .5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1; }
}
