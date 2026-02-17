import * as THREE from 'three';

/**
 * Animation Engine for Squareness-Based Layout
 *
 * Timeline:
 *   Events 1-12 : Show each leaf vggt cluster (deepest first)
 *   Events 13-17: Merge events bottom-up (5 merges)
 *
 * Merge behaviour:
 *   - Currently-visible children slide toward the merged node's
 *     mergeTargetPosition, shrink and fade out.
 *   - The merged result fades in at mergeTargetPosition, scaled
 *     to fit the mergeRegion.
 */
export class SquarenessAnimationEngine {
    constructor(clusters, layoutEngine) {
        this.clusters = clusters;
        this.layoutEngine = layoutEngine;
        this.mergeEvents = [];
        this.activeAnimations = [];
        this.animationDuration = 0.8;
    }

    initTimeline() {
        const treeNodes = this.layoutEngine.treeNodes;
        if (!treeNodes || treeNodes.length === 0) {
            console.warn("No tree nodes for timeline");
            return [];
        }

        console.log("=== SQUARENESS ANIMATION ENGINE ===");

        // Separate leaves from merge nodes
        const leaves = [];
        const merges = [];
        for (const node of treeNodes) {
            if (node.children.length === 0) leaves.push(node);
            else merges.push(node);
        }

        // Sort leaves: deepest first, then by path for stability
        leaves.sort((a, b) => {
            if (b.depth !== a.depth) return b.depth - a.depth;
            return a.cluster.path.localeCompare(b.cluster.path);
        });

        // Sort merges: deepest first (bottom-up)
        merges.sort((a, b) => {
            if (b.depth !== a.depth) return b.depth - a.depth;
            return a.cluster.path.localeCompare(b.cluster.path);
        });

        // Build timeline: all leaves first, then all merges
        for (const node of leaves) {
            this.mergeEvents.push({
                path: node.cluster.path,
                cluster: node.cluster,
                isLeaf: true,
                children: [],
                depth: node.depth
            });
        }
        for (const node of merges) {
            this.mergeEvents.push({
                path: node.cluster.path,
                cluster: node.cluster,
                isLeaf: false,
                children: node.children.map(c => c.cluster.path),
                depth: node.depth
            });
        }

        console.log(`Total events: ${this.mergeEvents.length} (${leaves.length} leaves + ${merges.length} merges)`);
        this.mergeEvents.forEach((e, i) => {
            const tag = e.isLeaf ? 'LEAF ' : 'MERGE';
            console.log(`  ${i + 1}. [${tag}] ${e.path} (depth ${e.depth})`);
        });

        return this.mergeEvents;
    }

    // ----------------------------------------------------------------
    // Instant jump (no animation)
    // ----------------------------------------------------------------

    applyEventInstant(eventIndex) {
        // Reset every cluster to its home state
        for (const cluster of this.clusters.values()) {
            if (cluster.pointCloud) {
                cluster.pointCloud.visible = false;
                cluster.pointCloud.material.opacity = 1;
            }
            if (cluster.hierarchyPosition) {
                cluster.group.position.copy(cluster.hierarchyPosition);
            }
            if (cluster.fitScale) {
                cluster.group.scale.setScalar(cluster.fitScale);
            }
        }

        // Replay events 0..eventIndex
        for (let i = 0; i <= eventIndex; i++) {
            const evt = this.mergeEvents[i];
            if (!evt) continue;
            const c = evt.cluster;

            if (evt.isLeaf) {
                // Show leaf
                if (c.pointCloud) c.pointCloud.visible = true;
            } else {
                // Merge event: show the merged result, hide children
                if (c.pointCloud) c.pointCloud.visible = true;
                for (const childPath of evt.children) {
                    const child = this.clusters.get(childPath);
                    if (child && child.pointCloud) child.pointCloud.visible = false;
                }
            }
        }
    }

    // ----------------------------------------------------------------
    // Step forward / backward with animation
    // ----------------------------------------------------------------

    playEvent(eventIndex, direction = 1) {
        const evt = this.mergeEvents[eventIndex];
        if (!evt) return;
        const cluster = evt.cluster;

        if (direction > 0) {
            // ---- FORWARD ----
            if (evt.isLeaf) {
                // Show leaf with fade-in
                if (cluster.pointCloud) {
                    cluster.pointCloud.visible = true;
                    this.animateFadeIn(cluster);
                }
            } else {
                // Merge event
                // 1) Show merged result with fade-in
                if (cluster.pointCloud) {
                    cluster.pointCloud.visible = true;
                    this.animateFadeIn(cluster);
                }
                // 2) Slide visible children toward merge target, then hide
                const target = cluster.mergeTargetPosition || cluster.hierarchyPosition;
                for (const childPath of evt.children) {
                    const child = this.clusters.get(childPath);
                    if (child && child.pointCloud && child.pointCloud.visible) {
                        this.animateMergeChild(child, target);
                    }
                }
            }
        } else {
            // ---- BACKWARD ----
            if (evt.isLeaf) {
                // Hide this leaf
                if (cluster.pointCloud) this.animateFadeOut(cluster);
            } else {
                // Un-merge: hide merged, restore children
                if (cluster.pointCloud) this.animateFadeOut(cluster);
                for (const childPath of evt.children) {
                    const child = this.clusters.get(childPath);
                    if (child && child.pointCloud) {
                        child.pointCloud.visible = true;
                        child.pointCloud.material.opacity = 1;
                        child.group.position.copy(child.hierarchyPosition);
                        if (child.fitScale) child.group.scale.setScalar(child.fitScale);
                    }
                }
            }
        }
    }

    // ----------------------------------------------------------------
    // Animation primitives
    // ----------------------------------------------------------------

    animateFadeIn(cluster) {
        if (!cluster.pointCloud) return;
        cluster.pointCloud.material.opacity = 0;
        cluster.pointCloud.material.transparent = true;
        this.activeAnimations.push({
            type: 'fadeIn', cluster,
            startTime: performance.now(),
            duration: this.animationDuration * 1000
        });
    }

    animateFadeOut(cluster) {
        if (!cluster.pointCloud) return;
        cluster.pointCloud.material.transparent = true;
        this.activeAnimations.push({
            type: 'fadeOut', cluster,
            startTime: performance.now(),
            duration: this.animationDuration * 1000,
            onComplete: () => {
                cluster.pointCloud.visible = false;
                cluster.pointCloud.material.opacity = 1;
            }
        });
    }

    animateMergeChild(child, targetPos) {
        if (!child.pointCloud || !targetPos) return;
        const startPos = child.group.position.clone();
        const endPos = targetPos.clone();
        const startScale = child.group.scale.x;

        this.activeAnimations.push({
            type: 'mergeChild', cluster: child,
            startPos, endPos, startScale,
            startTime: performance.now(),
            duration: this.animationDuration * 1000,
            onComplete: () => {
                child.pointCloud.visible = false;
                child.pointCloud.material.opacity = 1;
                child.group.position.copy(child.hierarchyPosition);
                child.group.scale.setScalar(startScale);
            }
        });
    }

    // ----------------------------------------------------------------
    // Per-frame update
    // ----------------------------------------------------------------

    update(dt) {
        const now = performance.now();
        for (let i = this.activeAnimations.length - 1; i >= 0; i--) {
            const a = this.activeAnimations[i];
            const t = Math.min((now - a.startTime) / a.duration, 1);
            const e = this.ease(t);

            switch (a.type) {
                case 'fadeIn':
                    a.cluster.pointCloud.material.opacity = e;
                    break;
                case 'fadeOut':
                    a.cluster.pointCloud.material.opacity = 1 - e;
                    break;
                case 'mergeChild':
                    a.cluster.group.position.lerpVectors(a.startPos, a.endPos, e);
                    a.cluster.group.scale.setScalar(a.startScale * (1 - e * 0.5));
                    a.cluster.pointCloud.material.opacity = 1 - e * 0.85;
                    break;
            }

            if (t >= 1) {
                if (a.onComplete) a.onComplete();
                this.activeAnimations.splice(i, 1);
            }
        }
    }

    ease(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }
}
