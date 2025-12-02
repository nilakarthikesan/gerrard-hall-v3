import * as THREE from 'three';

/**
 * Slab Animation Engine v2
 * Simplified timeline with visual merge animations
 * Camera stays still during merges so user can see upward movement
 */
export class SlabAnimationEngine {
    constructor(clusters, layoutEngine) {
        this.clusters = clusters;
        this.layoutEngine = layoutEngine;
        this.mergeEvents = [];
        this.activeAnimations = [];
        
        // Animation timing (in ms)
        this.MERGE_DURATION = 2500;    // How long clusters take to rise and merge
        this.CAMERA_DELAY = 2000;      // When camera starts moving (after merge mostly done)
        this.CAMERA_DURATION = 800;    // How long camera takes to pan
        
        // Camera reference (set by main app)
        this.camera = null;
        this.orbitControls = null;
        this.cameraDistance = 60;
        
        // State tracking
        this.currentLevel = 0;
        this.isAnimating = false;
    }
    
    setCamera(camera, orbitControls, distance) {
        this.camera = camera;
        this.orbitControls = orbitControls;
        this.cameraDistance = distance;
    }

    initTimeline() {
        console.log("=== SLAB ANIMATION ENGINE v2 ===");
        
        const numLevels = this.layoutEngine.getNumLevels();
        console.log(`Building simplified timeline for ${numLevels} levels`);
        
        // Event 1: Show all leaf clusters
        this.mergeEvents.push({
            type: 'show_leaves',
            level: 0,
            description: 'Show Leaf Clusters'
        });
        
        // Events 2 to N: Merge each level into the next
        for (let level = 0; level < numLevels - 1; level++) {
            this.mergeEvents.push({
                type: 'merge',
                fromLevel: level,
                toLevel: level + 1,
                description: `Merge Level ${level} → Level ${level + 1}`
            });
        }
        
        // Final event: Complete
        this.mergeEvents.push({
            type: 'complete',
            level: numLevels - 1,
            description: 'Reconstruction Complete'
        });
        
        console.log(`Total events: ${this.mergeEvents.length}`);
        this.mergeEvents.forEach((e, i) => {
            console.log(`  ${i + 1}. [${e.type}] ${e.description}`);
        });
        
        return this.mergeEvents;
    }

    /**
     * Apply event state instantly (for jumping/scrubbing)
     */
    applyEventInstant(eventIndex) {
        // Clear all animations
        this.activeAnimations = [];
        this.isAnimating = false;
        
        // Hide all clusters first
        for (const cluster of this.clusters.values()) {
            if (cluster.pointCloud) {
                cluster.pointCloud.visible = false;
                cluster.pointCloud.material.opacity = 1;
                cluster.pointCloud.material.transparent = false;
            }
            // Reset position to slab position
            if (cluster.slabPosition) {
                cluster.group.position.copy(cluster.slabPosition);
            }
        }
        
        // Determine which level should be visible based on events
        let visibleLevel = 0;
        
        for (let i = 0; i <= eventIndex; i++) {
            const event = this.mergeEvents[i];
            if (!event) continue;
            
            if (event.type === 'show_leaves') {
                visibleLevel = 0;
            } else if (event.type === 'merge') {
                visibleLevel = event.toLevel;
            }
        }
        
        // Show clusters at the visible level
        const clustersAtLevel = this.layoutEngine.getClustersAtLevel(visibleLevel);
        for (const cluster of clustersAtLevel) {
            if (cluster.pointCloud) {
                cluster.pointCloud.visible = true;
                cluster.group.position.copy(cluster.slabPosition);
            }
        }
        
        // Position camera at the visible level
        this.positionCameraAtLevel(visibleLevel);
        this.currentLevel = visibleLevel;
        
        console.log(`Applied instant state: Event ${eventIndex + 1}, Level ${visibleLevel}, ${clustersAtLevel.length} clusters visible`);
    }
    
    positionCameraAtLevel(level) {
        if (!this.camera || !this.orbitControls) return;
        
        // Keep camera centered at Y=0 to see all levels
        // Don't move camera - let animation happen in view
        const targetY = 0;
        const centerX = 0;
        
        this.camera.position.set(centerX, targetY, this.cameraDistance);
        this.orbitControls.target.set(centerX, targetY, 0);
        this.orbitControls.update();
    }

    /**
     * Play an event with animation
     */
    playEvent(eventIndex, direction = 1) {
        const event = this.mergeEvents[eventIndex];
        if (!event) return;
        
        if (direction < 0) {
            // Going backward - just apply instant state
            this.applyEventInstant(eventIndex - 1);
            return;
        }
        
        console.log(`Playing event ${eventIndex + 1}: ${event.description}`);
        
        switch (event.type) {
            case 'show_leaves':
                this.animateShowLeaves();
                break;
                
            case 'merge':
                this.animateMerge(event.fromLevel, event.toLevel);
                break;
                
            case 'complete':
                this.animateComplete();
                break;
        }
    }
    
    /**
     * Show all leaf clusters with fade-in animation
     */
    animateShowLeaves() {
        const leafClusters = this.layoutEngine.getClustersAtLevel(0);
        
        console.log(`Showing ${leafClusters.length} leaf clusters`);
        
        for (const cluster of leafClusters) {
            if (!cluster.pointCloud) continue;
            
            cluster.pointCloud.visible = true;
            cluster.pointCloud.material.transparent = true;
            cluster.pointCloud.material.opacity = 0;
            cluster.group.position.copy(cluster.slabPosition);
            
            this.activeAnimations.push({
                type: 'fadeIn',
                target: cluster.pointCloud,
                targetOpacity: 1.0,
                startTime: performance.now(),
                duration: 800
            });
        }
        
        this.currentLevel = 0;
    }
    
    /**
     * Animate merge from one level to the next
     * This is the core animation that shows clusters rising and combining
     */
    animateMerge(fromLevel, toLevel) {
        const fromClusters = this.layoutEngine.getClustersAtLevel(fromLevel);
        const toClusters = this.layoutEngine.getClustersAtLevel(toLevel);
        
        // Calculate Y positions using VISUAL_SPACING (same as layout engine)
        const VISUAL_SPACING = this.layoutEngine.VISUAL_SPACING || 25;
        const totalHeight = this.layoutEngine.maxDepth * VISUAL_SPACING;
        const yOffset = -totalHeight / 2;
        const fromY = fromLevel * VISUAL_SPACING + yOffset;
        const toY = toLevel * VISUAL_SPACING + yOffset;
        
        console.log(`=== MERGE: Level ${fromLevel} (Y=${fromY}) → Level ${toLevel} (Y=${toY}) ===`);
        console.log(`  From: ${fromClusters.length} clusters`);
        console.log(`  To: ${toClusters.length} clusters`);
        
        this.isAnimating = true;
        
        // PHASE 1: Animate children rising and converging
        for (const cluster of fromClusters) {
            if (!cluster.pointCloud) continue;
            
            // Find parent cluster to converge toward
            const parent = cluster.parent;
            let targetX = cluster.slabPosition.x;
            if (parent && parent.slabPosition) {
                targetX = parent.slabPosition.x;
            }
            
            const startPos = cluster.slabPosition.clone();
            const endPos = new THREE.Vector3(targetX, toY, 0);
            
            console.log(`  Child ${cluster.path}: (${startPos.x.toFixed(0)}, ${startPos.y.toFixed(0)}) → (${endPos.x.toFixed(0)}, ${endPos.y.toFixed(0)})`);
            
            // Make sure cluster is visible and at start position
            cluster.pointCloud.visible = true;
            cluster.pointCloud.material.transparent = true;
            cluster.pointCloud.material.opacity = 1;
            cluster.group.position.copy(startPos);
            
            this.activeAnimations.push({
                type: 'mergeRise',
                cluster: cluster,
                startPos: startPos.clone(),
                endPos: endPos.clone(),
                startTime: performance.now(),
                duration: this.MERGE_DURATION,
                onComplete: () => {
                    cluster.pointCloud.visible = false;
                    cluster.group.position.copy(cluster.slabPosition);
                    cluster.pointCloud.material.opacity = 1;
                    cluster.pointCloud.material.transparent = false;
                }
            });
        }
        
        // PHASE 2: Show parent clusters (delayed, starts at 60% of merge)
        const parentShowDelay = this.MERGE_DURATION * 0.6;
        
        setTimeout(() => {
            console.log(`  Showing ${toClusters.length} parent clusters`);
            
            for (const cluster of toClusters) {
                if (!cluster.pointCloud) continue;
                
                cluster.pointCloud.visible = true;
                cluster.pointCloud.material.transparent = true;
                cluster.pointCloud.material.opacity = 0;
                cluster.group.position.copy(cluster.slabPosition);
                
                this.activeAnimations.push({
                    type: 'fadeIn',
                    target: cluster.pointCloud,
                    targetOpacity: 1.0,
                    startTime: performance.now(),
                    duration: 800
                });
            }
        }, parentShowDelay);
        
        // PHASE 3: Move camera to new level (after merge animation)
        setTimeout(() => {
            console.log(`  Moving camera to Level ${toLevel}`);
            this.animateCameraToLevel(toLevel);
            this.currentLevel = toLevel;
            this.isAnimating = false;
        }, this.CAMERA_DELAY);
    }
    
    /**
     * Animate camera panning to a new level
     * Now keeps camera at center (Y=0) so all animation is visible
     */
    animateCameraToLevel(level) {
        // Camera stays fixed at center - no movement needed
        // This ensures all animation happens within view
        console.log(`Camera staying centered (level ${level} animation complete)`);
    }
    
    animateComplete() {
        console.log("=== RECONSTRUCTION COMPLETE ===");
        
        // Zoom in on the final merged building for a better view
        if (!this.camera || !this.orbitControls) return;
        
        const startPos = this.camera.position.clone();
        const startTarget = this.orbitControls.target.clone();
        
        // Get the root cluster position (final merged building)
        const maxLevel = this.layoutEngine.maxDepth;
        const rootClusters = this.layoutEngine.getClustersAtLevel(maxLevel);
        
        let targetX = 0, targetY = 0;
        if (rootClusters.length > 0 && rootClusters[0].slabPosition) {
            targetX = rootClusters[0].slabPosition.x;
            targetY = rootClusters[0].slabPosition.y;
        }
        
        // Zoom in very close - building fills ~80% of screen
        const zoomedDistance = this.cameraDistance * 0.12;
        
        // Position camera for front view (slightly to the side for depth)
        const endPos = new THREE.Vector3(targetX, targetY, zoomedDistance);
        const endTarget = new THREE.Vector3(targetX, targetY, 0);
        
        console.log(`Zooming to final view: distance ${zoomedDistance.toFixed(1)}`);
        
        this.activeAnimations.push({
            type: 'cameraMove',
            startPos: startPos,
            endPos: endPos,
            startTarget: startTarget,
            endTarget: endTarget,
            startTime: performance.now(),
            duration: 1500  // Smooth 1.5 second zoom
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
                        anim.target.material.opacity = eased * anim.targetOpacity;
                    }
                    break;
                    
                case 'fadeOut':
                    if (anim.target && anim.target.material) {
                        anim.target.material.opacity = (1 - eased);
                    }
                    break;
                    
                case 'mergeRise':
                    // Move cluster upward and toward parent
                    if (anim.cluster && anim.cluster.group) {
                        anim.cluster.group.position.lerpVectors(anim.startPos, anim.endPos, eased);
                        
                        // Fade out in the last 40% of animation
                        if (t > 0.6 && anim.cluster.pointCloud) {
                            const fadeT = (t - 0.6) / 0.4;
                            anim.cluster.pointCloud.material.transparent = true;
                            anim.cluster.pointCloud.material.opacity = 1 - fadeT;
                        }
                    }
                    break;
                    
                case 'cameraMove':
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

    easeInOutCubic(t) {
        return t < 0.5 
            ? 4 * t * t * t 
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
}
