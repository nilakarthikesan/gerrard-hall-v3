import * as THREE from 'three';

export class AnimationEngine {
    constructor(clusters) {
        this.clusters = clusters;
        this.activeTweens = [];
        this.mergeEvents = [];
    }

    initTimeline() {
        // Replicate the v2 logic to build a timeline, but robustly
        const processedPaths = new Set();
        this.mergeEvents = [];

        const addEventsForPath = (path) => {
            if (processedPaths.has(path)) return;
            
            const cluster = this.clusters.get(path);
            if (!cluster) return;
            
            // Process children first (post-order)
            if (cluster.children && cluster.children.length > 0) {
                for (const child of cluster.children) {
                    addEventsForPath(child.path);
                }
            }
            
            // Identify what gets hidden when this cluster appears
            // In v2 logic: if type is 'merged', we hide its children.
            const hiddenPaths = cluster.type === 'merged' ? cluster.childrenPaths : [];
            
            this.mergeEvents.push({
                path: path,
                hide: hiddenPaths
            });
            
            processedPaths.add(path);
        };

        // Roots from v2
        const roots = ['ba_gt', 'ba_input', 'ba_output'];
        roots.forEach(r => { if (this.clusters.has(r)) addEventsForPath(r); });
        
        const clusterGroups = ['C_1', 'C_2', 'C_3', 'C_4'];
        clusterGroups.forEach(c => {
            addEventsForPath(`${c}/ba_output`);
            addEventsForPath(`${c}/merged`);
        });
        
        addEventsForPath('merged');
        
        return this.mergeEvents;
    }

    // Jump to a specific event index instantly (for initialization/reset)
    applyEventInstant(index) {
        // Reset all
        for (const cluster of this.clusters.values()) {
            if (cluster.pointCloud) {
                cluster.pointCloud.visible = false;
                cluster.pointCloud.material.opacity = 1;
                cluster.group.position.copy(cluster.slabPosition); // Reset position
                cluster.group.visible = false; // Hide group too
            }
        }

        // Replay history up to index
        for (let i = 0; i <= index; i++) {
            const event = this.mergeEvents[i];
            const cluster = this.clusters.get(event.path);
            
            if (cluster && cluster.pointCloud) {
                cluster.group.visible = true;
                cluster.pointCloud.visible = true;
                cluster.pointCloud.material.opacity = 1;
                cluster.group.position.copy(cluster.slabPosition);
            }
            
            if (event.hide) {
                event.hide.forEach(childPath => {
                    const child = this.clusters.get(childPath);
                    if (child && child.pointCloud) {
                        child.group.visible = false;
                        child.pointCloud.visible = false;
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
            // FORWARD: Merge children into parent
            // 1. Parent Fades In (starts at opacity 0)
            if (parent && parent.pointCloud) {
                parent.group.visible = true;
                parent.pointCloud.visible = true;
                parent.pointCloud.material.opacity = 0;
                parent.group.position.copy(parent.slabPosition); // Ensure parent is in place

                this.addTween({
                    target: parent.pointCloud.material,
                    property: 'opacity',
                    to: 1,
                    duration: 1.0,
                    ease: this.easeQuadOut
                });
            }

            // 2. Children Move to Parent & Fade Out
            children.forEach(child => {
                if (!child.pointCloud || !child.group.visible) return;

                // Calculate a mid-point for the Bezier curve
                // Lift 'y' slightly to create an arc, or 'z' if we want depth-arcing.
                // Since we are in a 2D slab (x,y), let's arc in Y or Z.
                // Design doc suggests: "mid.y += 0.3 * medianRadius; // small lift arc"
                const start = child.group.position.clone();
                const end = parent.slabPosition.clone();
                const mid = start.clone().lerp(end, 0.5);
                
                // In layout: Root is at Y=0, Children at Y=-LEVEL_HEIGHT.
                // So Children move UP (+Y) to Parent.
                // Let's arc slightly "out" (Z) but much less than before.
                mid.z += 2.0; // Reduced from 5.0. Subtle "pop" forward.

                this.addTween({
                    type: 'bezier', // Mark as bezier
                    target: child.group.position,
                    start: start,
                    end: end,
                    control: mid,
                    duration: 1.5, // Slower merge for better visibility
                    ease: this.easeInOutCubic
                });

                this.addTween({
                    target: child.pointCloud.material,
                    property: 'opacity',
                    to: 0,
                    duration: 1.5,
                    ease: this.easeQuadIn,
                    onComplete: () => {
                        child.group.visible = false;
                        child.pointCloud.visible = false;
                    }
                });
            });

        } else {
            // BACKWARD: Unmerge (Parent hides, Children appear and move back)
            
            // 1. Parent Fades Out
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

            // 2. Children Fade In & Move Back to Original Slab Pos
            children.forEach(child => {
                if (!child.pointCloud) return;
                
                child.group.visible = true;
                child.pointCloud.visible = true;
                // Start at Parent Position (where they merged to)
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
        // params: { target, property (opt), to (val or vec3), duration, ease, onComplete, type, start, end, control }
        this.activeTweens.push({
            ...params,
            elapsed: 0,
            // If it's not a bezier, assume standard linear/prop tween
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
                // Quadratic Bezier: (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
                const t = progress;
                const invT = 1 - t;
                
                // We need to calculate this manually for the vector
                const p0 = tween.start;
                const p1 = tween.control;
                const p2 = tween.end;
                
                // Fix: Ensure target is a Vector3 before assigning properties
                if (tween.target && typeof tween.target.x !== 'undefined') {
                    tween.target.x = (invT * invT * p0.x) + (2 * invT * t * p1.x) + (t * t * p2.x);
                    tween.target.y = (invT * invT * p0.y) + (2 * invT * t * p1.y) + (t * t * p2.y);
                    tween.target.z = (invT * invT * p0.z) + (2 * invT * t * p1.z) + (t * t * p2.z);
                }
                
            } else if (tween.property) {
                // Scalar tween
                tween.target[tween.property] = tween.start + (tween.to - tween.start) * progress;
            } else {
                // Vector3 tween (linear)
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
