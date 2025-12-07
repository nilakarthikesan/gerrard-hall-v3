import * as THREE from 'three';

/**
 * Timeline Animation Engine
 * Handles the 4 animation types for the 38-event timeline:
 * - Type A: fade_in (Events 1-19)
 * - Type B: leaf_promotion (Events 20-30)  
 * - Type C: parent_merge (Events 31-37)
 * - Type D: final_merge (Event 38)
 */
export class TimelineAnimationEngine {
    constructor(clusters, eventEngine) {
        this.clusters = clusters;
        this.eventEngine = eventEngine;
        this.activeAnimations = [];
        
        // Animation timing (ms)
        this.FADE_IN_DURATION = 500;
        this.PROMOTION_DURATION = 1000;
        this.MERGE_DURATION = 1500;
        this.FINAL_MERGE_DURATION = 2500;
        
        // Camera reference (set by main app)
        this.camera = null;
        this.orbitControls = null;
        this.cameraDistance = 100;
        
        // Layout spacing
        this.LEVEL_SPACING = 30;
        this.CLUSTER_SPACING = 20;
        
        // Track current state
        this.visibleClusters = new Set();
        this.clusterPositions = new Map(); // Store Y positions
    }
    
    setCamera(camera, orbitControls, distance) {
        this.camera = camera;
        this.orbitControls = orbitControls;
        this.cameraDistance = distance;
    }
    
    /**
     * Initialize cluster positions based on hierarchy depth
     */
    initializePositions() {
        // Calculate depth for each cluster
        const depths = new Map();
        
        const calculateDepth = (path) => {
            if (depths.has(path)) return depths.get(path);
            
            const cluster = this.clusters.get(path);
            if (!cluster) return 0;
            
            // Root merged is at max depth
            if (path === 'merged') {
                // Find max child depth
                let maxChildDepth = 0;
                for (const childPath of cluster.childrenPaths) {
                    maxChildDepth = Math.max(maxChildDepth, calculateDepth(childPath));
                }
                depths.set(path, maxChildDepth + 1);
                return maxChildDepth + 1;
            }
            
            // ba_output is at depth 0
            if (cluster.type === 'ba_output') {
                depths.set(path, 0);
                return 0;
            }
            
            // merged at depth = max(child depth) + 1
            let maxChildDepth = 0;
            for (const childPath of cluster.childrenPaths) {
                maxChildDepth = Math.max(maxChildDepth, calculateDepth(childPath));
            }
            depths.set(path, maxChildDepth + 1);
            return maxChildDepth + 1;
        };
        
        // Calculate all depths
        for (const path of this.clusters.keys()) {
            calculateDepth(path);
        }
        
        // Find max depth
        let maxDepth = 0;
        for (const d of depths.values()) {
            maxDepth = Math.max(maxDepth, d);
        }
        
        // Assign Y positions based on depth
        // Depth 0 (ba_output) at bottom, max depth (root merged) at top
        const yOffset = -(maxDepth * this.LEVEL_SPACING) / 2;
        
        for (const [path, depth] of depths) {
            const y = depth * this.LEVEL_SPACING + yOffset;
            this.clusterPositions.set(path, { depth, y });
        }
        
        // Position clusters in X based on their position in hierarchy
        this.assignXPositions();
        
        console.log(`Initialized positions for ${this.clusters.size} clusters, max depth: ${maxDepth}`);
    }
    
    /**
     * Assign X positions using tree layout
     */
    assignXPositions() {
        // Group clusters by depth
        const byDepth = new Map();
        for (const [path, pos] of this.clusterPositions) {
            const depth = pos.depth;
            if (!byDepth.has(depth)) byDepth.set(depth, []);
            byDepth.get(depth).push(path);
        }
        
        // Assign X positions within each level
        for (const [depth, paths] of byDepth) {
            const count = paths.length;
            const totalWidth = (count - 1) * this.CLUSTER_SPACING;
            const startX = -totalWidth / 2;
            
            paths.forEach((path, i) => {
                const pos = this.clusterPositions.get(path);
                pos.x = startX + i * this.CLUSTER_SPACING;
            });
        }
    }
    
    /**
     * Apply event state instantly (for jumping/scrubbing)
     */
    applyEventInstant(eventIndex) {
        // Clear animations
        this.activeAnimations = [];
        
        // Hide all clusters
        for (const cluster of this.clusters.values()) {
            if (cluster.pointCloud) {
                cluster.pointCloud.visible = false;
                cluster.pointCloud.material.opacity = 1;
                cluster.pointCloud.material.transparent = false;
            }
        }
        
        // Get visible clusters for this event
        const visible = this.eventEngine.getVisibleClustersAfterEvent(eventIndex);
        this.visibleClusters = new Set(visible);
        
        // Show and position visible clusters
        for (const path of visible) {
            const cluster = this.clusters.get(path);
            if (cluster && cluster.pointCloud) {
                cluster.pointCloud.visible = true;
                
                // Position based on stored position
                const pos = this.clusterPositions.get(path);
                if (pos) {
                    cluster.group.position.set(pos.x || 0, pos.y || 0, 0);
                }
            }
        }
        
        console.log(`Applied event ${eventIndex + 1}: ${visible.length} clusters visible`);
    }
    
    /**
     * Play an event with animation
     */
    playEvent(eventIndex, direction = 1) {
        if (direction < 0) {
            // Going backward - apply previous state
            this.applyEventInstant(eventIndex - 1 >= 0 ? eventIndex - 1 : 0);
            return;
        }
        
        const event = this.eventEngine.getEvent(eventIndex);
        if (!event) return;
        
        console.log(`Playing Event ${event.number} [${event.type}]: ${event.description}`);
        
        switch (event.type) {
            case 'fade_in':
                this.animateFadeIn(event);
                break;
            case 'leaf_promotion':
                this.animateLeafPromotion(event);
                break;
            case 'parent_merge':
                this.animateParentMerge(event);
                break;
            case 'final_merge':
                this.animateFinalMerge(event);
                break;
        }
    }
    
    /**
     * Type A: Fade In Animation
     * ba_output cluster appears at bottom level
     */
    animateFadeIn(event) {
        const cluster = this.clusters.get(event.path);
        if (!cluster || !cluster.pointCloud) return;
        
        // Position at bottom level
        const pos = this.clusterPositions.get(event.path);
        cluster.group.position.set(pos?.x || 0, pos?.y || 0, 0);
        
        // Setup fade in
        cluster.pointCloud.visible = true;
        cluster.pointCloud.material.transparent = true;
        cluster.pointCloud.material.opacity = 0;
        
        this.activeAnimations.push({
            type: 'fadeIn',
            target: cluster.pointCloud,
            startOpacity: 0,
            endOpacity: 1,
            startTime: performance.now(),
            duration: this.FADE_IN_DURATION,
            onComplete: () => {
                cluster.pointCloud.material.opacity = 1;
                cluster.pointCloud.material.transparent = false;
                this.visibleClusters.add(event.path);
            }
        });
    }
    
    /**
     * Type B: Leaf Promotion Animation
     * Single ba_output rises and transforms into merged
     */
    animateLeafPromotion(event) {
        const mergedCluster = this.clusters.get(event.path);
        if (!mergedCluster || !mergedCluster.pointCloud) return;
        
        // Find the ba_output input
        const baOutputPath = event.inputs.find(p => p.endsWith('ba_output') || p === 'ba_output');
        const baOutputCluster = baOutputPath ? this.clusters.get(baOutputPath) : null;
        
        const mergedPos = this.clusterPositions.get(event.path);
        
        if (baOutputCluster && baOutputCluster.pointCloud) {
            const baPos = this.clusterPositions.get(baOutputPath);
            
            // Animate ba_output rising
            const startY = baPos?.y || 0;
            const endY = mergedPos?.y || startY + this.LEVEL_SPACING;
            
            baOutputCluster.pointCloud.material.transparent = true;
            
            this.activeAnimations.push({
                type: 'promotion',
                cluster: baOutputCluster,
                startY: startY,
                endY: endY,
                startTime: performance.now(),
                duration: this.PROMOTION_DURATION,
                onComplete: () => {
                    // Hide ba_output
                    baOutputCluster.pointCloud.visible = false;
                    baOutputCluster.pointCloud.material.opacity = 1;
                    this.visibleClusters.delete(baOutputPath);
                }
            });
        }
        
        // Fade in merged cluster after delay
        setTimeout(() => {
            mergedCluster.group.position.set(mergedPos?.x || 0, mergedPos?.y || 0, 0);
            mergedCluster.pointCloud.visible = true;
            mergedCluster.pointCloud.material.transparent = true;
            mergedCluster.pointCloud.material.opacity = 0;
            
            this.activeAnimations.push({
                type: 'fadeIn',
                target: mergedCluster.pointCloud,
                startOpacity: 0,
                endOpacity: 1,
                startTime: performance.now(),
                duration: 400,
                onComplete: () => {
                    mergedCluster.pointCloud.material.opacity = 1;
                    mergedCluster.pointCloud.material.transparent = false;
                    this.visibleClusters.add(event.path);
                }
            });
        }, this.PROMOTION_DURATION * 0.6);
    }
    
    /**
     * Type C: Parent Merge Animation
     * Multiple clusters rise and converge into merged result
     */
    animateParentMerge(event) {
        const mergedCluster = this.clusters.get(event.path);
        if (!mergedCluster || !mergedCluster.pointCloud) return;
        
        const mergedPos = this.clusterPositions.get(event.path);
        const targetX = mergedPos?.x || 0;
        const targetY = mergedPos?.y || 0;
        
        // Animate all inputs rising and converging
        for (const inputPath of event.inputs) {
            const inputCluster = this.clusters.get(inputPath);
            if (!inputCluster || !inputCluster.pointCloud) continue;
            
            const inputPos = this.clusterPositions.get(inputPath);
            const startX = inputCluster.group.position.x;
            const startY = inputCluster.group.position.y;
            
            inputCluster.pointCloud.material.transparent = true;
            
            this.activeAnimations.push({
                type: 'mergeRise',
                cluster: inputCluster,
                startX: startX,
                startY: startY,
                endX: targetX,
                endY: targetY,
                startTime: performance.now(),
                duration: this.MERGE_DURATION,
                onComplete: () => {
                    inputCluster.pointCloud.visible = false;
                    inputCluster.pointCloud.material.opacity = 1;
                    this.visibleClusters.delete(inputPath);
                }
            });
        }
        
        // Fade in merged result after delay
        setTimeout(() => {
            mergedCluster.group.position.set(targetX, targetY, 0);
            mergedCluster.pointCloud.visible = true;
            mergedCluster.pointCloud.material.transparent = true;
            mergedCluster.pointCloud.material.opacity = 0;
            
            this.activeAnimations.push({
                type: 'fadeIn',
                target: mergedCluster.pointCloud,
                startOpacity: 0,
                endOpacity: 1,
                startTime: performance.now(),
                duration: 600,
                onComplete: () => {
                    mergedCluster.pointCloud.material.opacity = 1;
                    mergedCluster.pointCloud.material.transparent = false;
                    this.visibleClusters.add(event.path);
                }
            });
        }, this.MERGE_DURATION * 0.7);
    }
    
    /**
     * Type D: Final Merge Animation
     * Grand finale - all top-level clusters merge into complete building
     */
    animateFinalMerge(event) {
        const mergedCluster = this.clusters.get('merged');
        if (!mergedCluster || !mergedCluster.pointCloud) return;
        
        const mergedPos = this.clusterPositions.get('merged');
        const targetX = mergedPos?.x || 0;
        const targetY = mergedPos?.y || 0;
        
        // Animate all 5 inputs with dramatic timing
        event.inputs.forEach((inputPath, i) => {
            const inputCluster = this.clusters.get(inputPath);
            if (!inputCluster || !inputCluster.pointCloud) return;
            
            const startX = inputCluster.group.position.x;
            const startY = inputCluster.group.position.y;
            
            inputCluster.pointCloud.material.transparent = true;
            
            // Stagger the animations slightly
            const delay = i * 100;
            
            setTimeout(() => {
                this.activeAnimations.push({
                    type: 'finalMergeRise',
                    cluster: inputCluster,
                    startX: startX,
                    startY: startY,
                    endX: targetX,
                    endY: targetY,
                    startTime: performance.now(),
                    duration: this.FINAL_MERGE_DURATION - delay,
                    onComplete: () => {
                        inputCluster.pointCloud.visible = false;
                        inputCluster.pointCloud.material.opacity = 1;
                        this.visibleClusters.delete(inputPath);
                    }
                });
            }, delay);
        });
        
        // Show final merged building
        setTimeout(() => {
            mergedCluster.group.position.set(targetX, targetY, 0);
            mergedCluster.pointCloud.visible = true;
            mergedCluster.pointCloud.material.transparent = true;
            mergedCluster.pointCloud.material.opacity = 0;
            
            // Dramatic fade in
            this.activeAnimations.push({
                type: 'fadeIn',
                target: mergedCluster.pointCloud,
                startOpacity: 0,
                endOpacity: 1,
                startTime: performance.now(),
                duration: 1000,
                onComplete: () => {
                    mergedCluster.pointCloud.material.opacity = 1;
                    mergedCluster.pointCloud.material.transparent = false;
                    this.visibleClusters.add('merged');
                    
                    // Zoom camera to final view
                    this.zoomToFinal();
                }
            });
        }, this.FINAL_MERGE_DURATION * 0.8);
    }
    
    /**
     * Zoom camera to final building view
     */
    zoomToFinal() {
        if (!this.camera || !this.orbitControls) return;
        
        const mergedPos = this.clusterPositions.get('merged');
        const targetX = mergedPos?.x || 0;
        const targetY = mergedPos?.y || 0;
        
        const startPos = this.camera.position.clone();
        const startTarget = this.orbitControls.target.clone();
        
        // Zoom in close
        const endPos = new THREE.Vector3(targetX, targetY, this.cameraDistance * 0.15);
        const endTarget = new THREE.Vector3(targetX, targetY, 0);
        
        this.activeAnimations.push({
            type: 'cameraZoom',
            startPos: startPos,
            endPos: endPos,
            startTarget: startTarget,
            endTarget: endTarget,
            startTime: performance.now(),
            duration: 2000
        });
    }
    
    /**
     * Update all active animations (called every frame)
     */
    update(dt) {
        const now = performance.now();
        
        for (let i = this.activeAnimations.length - 1; i >= 0; i--) {
            const anim = this.activeAnimations[i];
            const elapsed = now - anim.startTime;
            const t = Math.min(elapsed / anim.duration, 1);
            const eased = this.easeInOutCubic(t);
            
            switch (anim.type) {
                case 'fadeIn':
                    if (anim.target && anim.target.material) {
                        anim.target.material.opacity = anim.startOpacity + (anim.endOpacity - anim.startOpacity) * eased;
                    }
                    break;
                    
                case 'promotion':
                    if (anim.cluster && anim.cluster.group) {
                        // Rise up
                        const y = anim.startY + (anim.endY - anim.startY) * eased;
                        anim.cluster.group.position.y = y;
                        
                        // Fade out in last 40%
                        if (t > 0.6 && anim.cluster.pointCloud) {
                            const fadeT = (t - 0.6) / 0.4;
                            anim.cluster.pointCloud.material.opacity = 1 - fadeT;
                        }
                    }
                    break;
                    
                case 'mergeRise':
                case 'finalMergeRise':
                    if (anim.cluster && anim.cluster.group) {
                        // Move toward target
                        const x = anim.startX + (anim.endX - anim.startX) * eased;
                        const y = anim.startY + (anim.endY - anim.startY) * eased;
                        anim.cluster.group.position.set(x, y, 0);
                        
                        // Fade out in last 40%
                        if (t > 0.6 && anim.cluster.pointCloud) {
                            const fadeT = (t - 0.6) / 0.4;
                            anim.cluster.pointCloud.material.opacity = 1 - fadeT;
                        }
                    }
                    break;
                    
                case 'cameraZoom':
                    if (this.camera && this.orbitControls) {
                        this.camera.position.lerpVectors(anim.startPos, anim.endPos, eased);
                        this.orbitControls.target.lerpVectors(anim.startTarget, anim.endTarget, eased);
                        this.orbitControls.update();
                    }
                    break;
            }
            
            // Remove completed animations
            if (t >= 1) {
                if (anim.onComplete) anim.onComplete();
                this.activeAnimations.splice(i, 1);
            }
        }
    }
    
    /**
     * Easing function
     */
    easeInOutCubic(t) {
        return t < 0.5 
            ? 4 * t * t * t 
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
}

