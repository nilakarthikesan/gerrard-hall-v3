import * as THREE from 'three';

/**
 * Hierarchy Animation Engine
 * Handles animations for the tree-based hierarchy view
 */
export class HierarchyAnimationEngine {
    constructor(clusters, layoutEngine) {
        this.clusters = clusters;
        this.layoutEngine = layoutEngine;
        this.mergeEvents = [];
        this.activeAnimations = [];
        this.animationDuration = 0.8;
    }

    initTimeline() {
        // Build events from tree nodes
        const treeNodes = this.layoutEngine.treeNodes;
        if (!treeNodes || treeNodes.length === 0) {
            console.warn("No tree nodes for timeline");
            return [];
        }

        console.log("=== HIERARCHY ANIMATION ENGINE ===");
        
        // Sort by depth (deepest first = leaves first)
        const sortedNodes = [...treeNodes].sort((a, b) => b.depth - a.depth);
        
        // Create events - show leaves first, then merge up
        for (const node of sortedNodes) {
            const cluster = node.cluster;
            const isLeaf = node.children.length === 0;
            
            this.mergeEvents.push({
                path: cluster.path,
                cluster: cluster,
                isLeaf: isLeaf,
                children: node.children.map(c => c.cluster.path),
                depth: node.depth
            });
        }

        console.log(`Total events: ${this.mergeEvents.length}`);
        console.log("Event order (leaves to root):");
        this.mergeEvents.forEach((e, i) => {
            const type = e.isLeaf ? 'LEAF' : 'MERGE';
            console.log(`  ${i + 1}. [${type}] ${e.path} (depth ${e.depth})`);
        });

        return this.mergeEvents;
    }

    applyEventInstant(eventIndex) {
        // Reset all clusters
        for (const cluster of this.clusters.values()) {
            if (cluster.pointCloud) {
                cluster.pointCloud.visible = false;
                cluster.pointCloud.material.opacity = 1;
            }
        }

        // Show clusters up to this event
        for (let i = 0; i <= eventIndex; i++) {
            const event = this.mergeEvents[i];
            if (!event) continue;

            const cluster = event.cluster;
            if (cluster && cluster.pointCloud) {
                cluster.pointCloud.visible = true;
                
                // Position at hierarchy location
                if (cluster.hierarchyPosition) {
                    cluster.group.position.copy(cluster.hierarchyPosition);
                }
            }

            // If this is a merge event, hide the children
            if (!event.isLeaf && i < eventIndex) {
                for (const childPath of event.children) {
                    const child = this.clusters.get(childPath);
                    if (child && child.pointCloud) {
                        child.pointCloud.visible = false;
                    }
                }
            }
        }
    }

    playEvent(eventIndex, direction = 1) {
        const event = this.mergeEvents[eventIndex];
        if (!event) return;

        const cluster = event.cluster;
        
        if (direction > 0) {
            // Forward: Show this cluster
            if (cluster.pointCloud) {
                cluster.pointCloud.visible = true;
                
                // Animate fade in
                this.animateFadeIn(cluster);
                
                // If merge event, animate children moving to parent then hide
                if (!event.isLeaf) {
                    for (const childPath of event.children) {
                        const child = this.clusters.get(childPath);
                        if (child) {
                            this.animateMerge(child, cluster);
                        }
                    }
                }
            }
        } else {
            // Backward: Hide this cluster, show children
            if (!event.isLeaf) {
                // Show children again
                for (const childPath of event.children) {
                    const child = this.clusters.get(childPath);
                    if (child && child.pointCloud) {
                        child.pointCloud.visible = true;
                        child.group.position.copy(child.hierarchyPosition);
                    }
                }
            }
            
            if (cluster.pointCloud) {
                this.animateFadeOut(cluster);
            }
        }
    }

    animateFadeIn(cluster) {
        if (!cluster.pointCloud) return;
        
        const material = cluster.pointCloud.material;
        material.opacity = 0;
        material.transparent = true;
        
        this.activeAnimations.push({
            type: 'fadeIn',
            cluster: cluster,
            startTime: performance.now(),
            duration: this.animationDuration * 1000
        });
    }

    animateFadeOut(cluster) {
        if (!cluster.pointCloud) return;
        
        const material = cluster.pointCloud.material;
        material.transparent = true;
        
        this.activeAnimations.push({
            type: 'fadeOut',
            cluster: cluster,
            startTime: performance.now(),
            duration: this.animationDuration * 1000,
            onComplete: () => {
                cluster.pointCloud.visible = false;
                material.opacity = 1;
            }
        });
    }

    animateMerge(child, parent) {
        if (!child.pointCloud || !parent.hierarchyPosition) return;
        
        const startPos = child.group.position.clone();
        const endPos = parent.hierarchyPosition.clone();
        
        this.activeAnimations.push({
            type: 'move',
            cluster: child,
            startPos: startPos,
            endPos: endPos,
            startTime: performance.now(),
            duration: this.animationDuration * 1000,
            onComplete: () => {
                child.pointCloud.visible = false;
                child.group.position.copy(child.hierarchyPosition);
            }
        });
    }

    update(dt) {
        const now = performance.now();
        
        for (let i = this.activeAnimations.length - 1; i >= 0; i--) {
            const anim = this.activeAnimations[i];
            const elapsed = now - anim.startTime;
            const t = Math.min(elapsed / anim.duration, 1);
            const eased = this.easeInOutQuad(t);
            
            if (anim.type === 'fadeIn') {
                anim.cluster.pointCloud.material.opacity = eased;
            } else if (anim.type === 'fadeOut') {
                anim.cluster.pointCloud.material.opacity = 1 - eased;
            } else if (anim.type === 'move') {
                anim.cluster.group.position.lerpVectors(anim.startPos, anim.endPos, eased);
            }
            
            if (t >= 1) {
                if (anim.onComplete) anim.onComplete();
                this.activeAnimations.splice(i, 1);
            }
        }
    }

    easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }
}

