import * as THREE from 'three';

/**
 * Centroid Animation Engine
 * 
 * Positions clusters based on where they end up in the final visualization:
 * - Each cluster's point cloud already lives in its final (normalized) coordinate frame.
 * - A cluster's `originalCenter` is the centroid of its points in that final frame.
 *
 * This engine places clusters using their final centroids, optionally "exploded" outward
 * for visibility. Merges move input clusters toward the output cluster's eventual location.
 * 
 * Key Concepts:
 * - Cluster geometry is already in global coordinates; to move a cluster we translate its group.
 * - Final/assembled placement corresponds to group offset (0,0,0).
 * - Exploded placement is a translation offset that pushes the cluster away from the origin
 *   along the direction of its final centroid.
 */
export class CentroidAnimationEngine {
    constructor(clusters, eventEngine) {
        this.clusters = clusters;
        this.eventEngine = eventEngine;
        
        // Explode factor - how far to push clusters outward from their centroid
        // Higher = more spread apart, Lower = closer to actual building shape
        this.EXPLODE_FACTOR = 3.0;  // 3.0 = clusters appear 3x further from center than actual
        
        // Animation timing - SLOWER for better viewing
        this.FADE_DURATION = 1500;      // Fade in duration (was 600)
        this.GLOW_DURATION = 1200;      // Leaf promotion glow (was 400)
        this.IMPLODE_DURATION = 3000;   // Merge implode duration (was 1500)
        this.FINAL_DURATION = 5000;     // Final assembly duration (was 2500)
        
        // Camera reference
        this.camera = null;
        this.orbitControls = null;
        this.cameraDistance = 200;
        
        // State tracking
        this.visibleClusters = new Set();
        this.clusterPositions = new Map();      // Current (exploded) positions
        this.clusterTargetPositions = new Map(); // Target positions for merges
        this.buildingCenter = new THREE.Vector3(0, 0, 0);
        
        // Animation state
        this.activeAnimations = [];
        
        // Focus settings for zooming to individual clusters
        this.FOCUS_DISTANCE = 80;   // Close enough to see detail
        this.FOCUS_DURATION = 1000; // Slower camera movement
        
        // Info callbacks
        this.onInfoUpdate = null;
    }
    
    setCamera(camera, orbitControls, distance) {
        this.camera = camera;
        this.orbitControls = orbitControls;
        this.cameraDistance = distance;
    }
    
    /**
     * Initialize cluster positions using BRANCH-BASED GROUPING (V2)
     * 
     * All clusters in the same TOP-LEVEL BRANCH are grouped together:
     * - C_1 branch clusters -> positioned near C_1/merged centroid
     * - C_2 branch clusters -> positioned near C_2/merged centroid
     * - C_3 branch clusters -> positioned near C_3/merged centroid
     * - C_4 branch clusters -> positioned near C_4/merged centroid
     * - Root ba_output -> positioned near building center
     */
    initializePositions() {
        console.log("=== CENTROID ENGINE V2: BRANCH-BASED GROUPING ===");
        console.log("Total clusters: " + this.clusters.size);

        this.buildingCenter.set(0, 0, 0);

        // Define the top-level branches
        var topLevelBranches = ['C_1', 'C_2', 'C_3', 'C_4', 'ba_output'];
        
        // Helper to get which branch a cluster belongs to
        var getBranch = function(path) {
            if (path === 'ba_output') return 'ba_output';
            if (path === 'merged') return 'ROOT';
            for (var i = 0; i < topLevelBranches.length; i++) {
                var branch = topLevelBranches[i];
                if (path.startsWith(branch + '/') || path === branch) {
                    return branch;
                }
            }
            return 'ROOT';
        };
        
        // Collect clusters by branch
        var branchClusters = new Map();
        for (var entry of this.clusters) {
            var path = entry[0];
            var branch = getBranch(path);
            if (!branchClusters.has(branch)) {
                branchClusters.set(branch, []);
            }
            branchClusters.get(branch).push(path);
        }
        
        console.log("Clusters by branch:");
        for (var branchEntry of branchClusters) {
            console.log("  " + branchEntry[0] + ": " + branchEntry[1].length + " clusters");
        }

        // Get centroids for each top-level merged cluster
        var branchCentroids = new Map();
        for (var i = 0; i < topLevelBranches.length; i++) {
            var branch = topLevelBranches[i];
            var mergedPath = branch === 'ba_output' ? 'ba_output' : (branch + '/merged');
            var cluster = this.clusters.get(mergedPath);
            if (cluster && cluster.originalCenter) {
                branchCentroids.set(branch, cluster.originalCenter.clone());
                console.log("  " + branch + " centroid: (" + cluster.originalCenter.x.toFixed(1) + ", " + cluster.originalCenter.y.toFixed(1) + ", " + cluster.originalCenter.z.toFixed(1) + ")");
            }
        }

        // Compute bounds for normalization
        var minX = Infinity, maxX = -Infinity;
        var minY = Infinity, maxY = -Infinity;
        var minZ = Infinity, maxZ = -Infinity;
        
        for (var centroidEntry of branchCentroids) {
            var centroid = centroidEntry[1];
            minX = Math.min(minX, centroid.x); maxX = Math.max(maxX, centroid.x);
            minY = Math.min(minY, centroid.y); maxY = Math.max(maxY, centroid.y);
            minZ = Math.min(minZ, centroid.z); maxZ = Math.max(maxZ, centroid.z);
        }
        
        var rangeX = maxX - minX || 1;
        var rangeY = maxY - minY || 1;
        var rangeZ = maxZ - minZ || 1;

        // Spread for branches on screen
        var BRANCH_SPREAD_X = 300;
        var BRANCH_SPREAD_Y = 200;
        var BRANCH_SPREAD_Z = 80;
        var CLUSTER_SPREAD = 35;

        // Helper to normalize centroid to screen position
        var normalizeToScreen = function(centroid) {
            var normX = (centroid.x - minX) / rangeX - 0.5;
            var normY = (centroid.y - minY) / rangeY - 0.5;
            var normZ = (centroid.z - minZ) / rangeZ - 0.5;
            return new THREE.Vector3(
                normX * BRANCH_SPREAD_X,
                normY * BRANCH_SPREAD_Y,
                normZ * BRANCH_SPREAD_Z
            );
        };

        // Position each cluster within its branch region
        console.log("Positioning clusters by branch:");
        
        for (var clusterEntry of this.clusters) {
            var path = clusterEntry[0];
            var cluster = clusterEntry[1];
            var assembledOffset = new THREE.Vector3(0, 0, 0);
            var explodedOffset;
            
            if (path === 'merged') {
                explodedOffset = new THREE.Vector3(0, 0, 0);
                console.log("  " + path + ": FINAL at center (0, 0, 0)");
            } else {
                var branch = getBranch(path);
                var branchCentroid = branchCentroids.get(branch);
                var branchMembers = branchClusters.get(branch) || [];
                var memberIndex = branchMembers.indexOf(path);
                var memberCount = branchMembers.length;
                
                var regionCenter;
                if (branchCentroid) {
                    regionCenter = normalizeToScreen(branchCentroid);
                } else {
                    regionCenter = new THREE.Vector3(0, 0, 0);
                }
                
                var clusterOffset = new THREE.Vector3(0, 0, 0);
                if (memberCount > 1 && memberIndex >= 0) {
                    var angle = (memberIndex / memberCount) * Math.PI * 2;
                    var radius = CLUSTER_SPREAD * (1 + memberIndex * 0.15);
                    clusterOffset.x = Math.cos(angle) * radius;
                    clusterOffset.y = Math.sin(angle) * radius * 0.6;
                    clusterOffset.z = (memberIndex % 3 - 1) * 10;
                }
                
                explodedOffset = regionCenter.clone().add(clusterOffset);
                
                console.log("  " + path + ": Branch=" + branch + ", pos=(" + explodedOffset.x.toFixed(0) + ", " + explodedOffset.y.toFixed(0) + ", " + explodedOffset.z.toFixed(0) + ")");
            }

            this.clusterPositions.set(path, explodedOffset.clone());
            this.clusterTargetPositions.set(path, assembledOffset.clone());
            cluster.group.position.copy(explodedOffset);

            if (cluster.pointCloud) {
                cluster.pointCloud.visible = false;
                cluster.pointCloud.material.transparent = true;
                cluster.pointCloud.material.opacity = 1;
            }
        }
        
        console.log("Initialized " + this.clusterPositions.size + " clusters with branch-based layout");
    }
    
    /**
     * Apply event state instantly (for scrubbing/jumping)
     */
    applyEventInstant(eventIndex) {
        // Clear animations
        this.activeAnimations = [];
        
        // Reset all clusters
        for (const [path, cluster] of this.clusters) {
            if (cluster.pointCloud) {
                cluster.pointCloud.visible = false;
                cluster.pointCloud.material.opacity = 1;
            }
            // Reset to exploded position
            const pos = this.clusterPositions.get(path);
            if (pos) cluster.group.position.copy(pos);
        }
        this.visibleClusters.clear();
        
        // Apply all events up to this index
        const events = this.eventEngine.events;
        for (let i = 0; i <= eventIndex; i++) {
            const event = events[i];
            
            if (event.type === 'fade_in') {
                const cluster = this.clusters.get(event.path);
                if (cluster?.pointCloud) {
                    cluster.pointCloud.visible = true;
                    this.visibleClusters.add(event.path);
                }
            } else if (event.type === 'leaf_promotion') {
                // Hide ba_output, show merged (same position)
                for (const inputPath of event.inputs) {
                    const cluster = this.clusters.get(inputPath);
                    if (cluster?.pointCloud) {
                        cluster.pointCloud.visible = false;
                    }
                    this.visibleClusters.delete(inputPath);
                }
                const outCluster = this.clusters.get(event.path);
                if (outCluster?.pointCloud) {
                    outCluster.pointCloud.visible = true;
                    this.visibleClusters.add(event.path);
                }
            } else if (event.type === 'parent_merge' || event.type === 'final_merge') {
                // Hide inputs, show output at its LAYOUT position
                for (const inputPath of event.inputs) {
                    const cluster = this.clusters.get(inputPath);
                    if (cluster?.pointCloud) {
                        cluster.pointCloud.visible = false;
                    }
                    this.visibleClusters.delete(inputPath);
                }
                const outCluster = this.clusters.get(event.path);
                if (outCluster?.pointCloud) {
                    // Use exploded offset derived from final centroid
                    const explodedOffset = this.clusterPositions.get(event.path);
                    if (explodedOffset) outCluster.group.position.copy(explodedOffset);
                    outCluster.pointCloud.visible = true;
                    this.visibleClusters.add(event.path);
                }
            }
        }
        
        this.updateInfo('Jumped', `Event ${eventIndex + 1}`);
    }
    
    /**
     * Play an event with animations
     */
    playEvent(eventIndex, direction = 1) {
        const event = this.eventEngine.events[eventIndex];
        if (!event) return;
        
        console.log(`\n▶ Playing Event ${event.number}: ${event.type} - ${event.path}`);
        
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
     * Phase 1: Fade In - cluster appears at its layout position
     */
    animateFadeIn(event) {
        const cluster = this.clusters.get(event.path);
        if (!cluster?.pointCloud) return;
        
        // Position at exploded offset derived from final centroid
        const offset = this.clusterPositions.get(event.path);
        if (offset) cluster.group.position.copy(offset);
        
        // Focus camera on this cluster
        const focusPos = cluster.originalCenter
            ? cluster.originalCenter.clone().add(cluster.group.position)
            : cluster.group.position.clone();
        this.focusCameraOnPosition(focusPos, this.FOCUS_DISTANCE);
        
        // Fade in
        cluster.pointCloud.visible = true;
        cluster.pointCloud.material.opacity = 0;
        
        this.activeAnimations.push({
            type: 'fadeIn',
            target: cluster.pointCloud,
            startOpacity: 0,
            endOpacity: 1,
            startTime: performance.now(),
            duration: this.FADE_DURATION,
            onComplete: () => {
                cluster.pointCloud.material.opacity = 1;
                this.visibleClusters.add(event.path);
            }
        });
        
        // Get a short name for display
        const shortName = event.path.split('/').slice(-2).join('/');
        this.updateInfo('Appearing', shortName);
    }
    
    /**
     * Phase 2: Leaf Promotion - INSTANT (no animation)
     * Just swaps ba_output for merged without any visual effect
     */
    animateLeafPromotion(event) {
        console.log(`  Leaf Promotion (instant): ${event.path}`);
        
        const baPath = event.inputs.find(p => p.endsWith('ba_output') || p === 'ba_output');
        const baCluster = baPath ? this.clusters.get(baPath) : null;
        const mergedCluster = this.clusters.get(event.path);
        
        if (!mergedCluster?.pointCloud) {
            console.warn('Missing merged cluster for leaf promotion');
            return;
        }
        
        // Keep continuity: merged inherits ba_output's current exploded offset if available
        const baOffset = baPath ? this.clusterPositions.get(baPath) : null;
        const mergedOffset = this.clusterPositions.get(event.path);
        const chosen = baOffset || mergedOffset;
        if (chosen) mergedCluster.group.position.copy(chosen);
        
        // Instant swap: hide ba_output, show merged (no animation)
        if (baCluster?.pointCloud) {
            baCluster.pointCloud.visible = false;
            this.visibleClusters.delete(baPath);
        }
        
        mergedCluster.pointCloud.visible = true;
        mergedCluster.pointCloud.material.opacity = 1;
        this.visibleClusters.add(event.path);
        
        // No animation - just update info
        this.updateInfo('Ready', event.path.split('/').pop());
    }
    
    /**
     * Phase 3: Parent Merge - clusters move toward merge position
     */
    animateParentMerge(event) {
        console.log(`  Parent Merge: ${event.path}`);
        console.log(`    Inputs: ${event.inputs.join(', ')}`);
        
        const mergedCluster = this.clusters.get(event.path);
        if (!mergedCluster?.pointCloud) {
            console.warn('Missing merged cluster for parent merge');
            return;
        }
        
        // Target is the output cluster's exploded offset (derived from its final centroid)
        const mergedOffset = this.clusterPositions.get(event.path) || new THREE.Vector3(0, 0, 0);
        const mergedShownPos = mergedCluster.originalCenter
            ? mergedCluster.originalCenter.clone().add(mergedOffset)
            : mergedOffset.clone();
        console.log(`    Merge target (shown centroid): (${mergedShownPos.x.toFixed(1)}, ${mergedShownPos.y.toFixed(1)}, ${mergedShownPos.z.toFixed(1)})`);
        
        // Collect all visible input clusters
        const inputClusters = [];
        for (const inputPath of event.inputs) {
            const cluster = this.clusters.get(inputPath);
            if (cluster?.pointCloud && cluster.pointCloud.visible) {
                const pos = cluster.group.position.clone();
                inputClusters.push({ cluster, pos, path: inputPath });
                const shown = cluster.originalCenter ? cluster.originalCenter.clone().add(pos) : pos.clone();
                console.log(`    Input: ${inputPath} shown=(${shown.x.toFixed(1)}, ${shown.y.toFixed(1)}, ${shown.z.toFixed(1)})`);
            }
        }
        
        if (inputClusters.length === 0) {
            console.warn('No visible input clusters - showing merged directly');
            mergedCluster.group.position.copy(mergedOffset);
            mergedCluster.pointCloud.visible = true;
            this.visibleClusters.add(event.path);
            this.focusCameraOnPosition(mergedShownPos, this.FOCUS_DISTANCE);
            return;
        }
        
        // Calculate center of all clusters involved for camera
        const allShownPositions = [
            ...inputClusters.map(c => (c.cluster.originalCenter ? c.cluster.originalCenter.clone().add(c.pos) : c.pos.clone())),
            mergedShownPos
        ];
        const focusPoint = allShownPositions.reduce((acc, p) => acc.add(p), new THREE.Vector3(0, 0, 0))
            .multiplyScalar(1 / allShownPositions.length);
        
        // Zoom to see the merge area
        this.focusCameraOnPosition(focusPoint, this.FOCUS_DISTANCE * 1.5);
        
        // Animate each input cluster moving toward merged position
        for (const { cluster, pos, path } of inputClusters) {
            this.activeAnimations.push({
                type: 'implode',
                target: cluster.group,
                material: cluster.pointCloud.material,
                startPos: pos.clone(),
                endPos: mergedOffset.clone(),
                startOpacity: 1,
                endOpacity: 0,
                startTime: performance.now(),
                duration: this.IMPLODE_DURATION,
                onComplete: () => {
                    cluster.pointCloud.visible = false;
                    this.visibleClusters.delete(path);
                }
            });
        }
        
        // After implode, show the merged cluster
        setTimeout(() => {
            mergedCluster.group.position.copy(mergedOffset);
            mergedCluster.pointCloud.visible = true;
            mergedCluster.pointCloud.material.opacity = 0;
            
            // Zoom closer to the result
            this.focusCameraOnPosition(mergedShownPos, this.FOCUS_DISTANCE);
            
            this.activeAnimations.push({
                type: 'fadeIn',
                target: mergedCluster.pointCloud,
                startOpacity: 0,
                endOpacity: 1,
                startTime: performance.now(),
                duration: this.FADE_DURATION,
                onComplete: () => {
                    mergedCluster.pointCloud.material.opacity = 1;
                    this.visibleClusters.add(event.path);
                }
            });
        }, this.IMPLODE_DURATION * 0.7);
        
        const shortName = event.path.split('/').slice(-2).join('/');
        this.updateInfo('Merging', `→ ${shortName}`);
    }
    
    /**
     * Phase 4: Final Merge - grand finale, all clusters converge to center
     */
    animateFinalMerge(event) {
        console.log(`  FINAL MERGE: ${event.path}`);
        
        const mergedCluster = this.clusters.get(event.path);
        if (!mergedCluster?.pointCloud) return;
        
        // Final building appears assembled at origin (group offset = 0)
        const targetOffset = new THREE.Vector3(0, 0, 0);
        console.log(`  Final target (assembled): (0, 0, 0)`);
        
        // Collect all visible clusters for the final assembly
        const inputClusters = [];
        for (const inputPath of event.inputs) {
            const cluster = this.clusters.get(inputPath);
            if (cluster?.pointCloud && cluster.pointCloud.visible) {
                const pos = cluster.group.position.clone();
                inputClusters.push({ cluster, pos, path: inputPath });
                console.log(`    Final input: ${inputPath} at (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})`);
            }
        }
        
        console.log(`  Found ${inputClusters.length} clusters for final merge`);
        
        // Start with wide view to see all converging
        this.focusCameraOnPosition(new THREE.Vector3(0, 0, 0), this.FOCUS_DISTANCE * 4);
        
        // Animate all clusters converging to center
        for (const { cluster, pos, path } of inputClusters) {
            this.activeAnimations.push({
                type: 'implode',
                target: cluster.group,
                material: cluster.pointCloud.material,
                startPos: pos.clone(),
                endPos: targetOffset.clone(),
                startOpacity: 1,
                endOpacity: 0,
                startTime: performance.now(),
                duration: this.FINAL_DURATION,
                onComplete: () => {
                    cluster.pointCloud.visible = false;
                    this.visibleClusters.delete(path);
                }
            });
        }
        
        // After assembly, show the final building
        setTimeout(() => {
            mergedCluster.group.position.copy(targetOffset);
            mergedCluster.pointCloud.visible = true;
            mergedCluster.pointCloud.material.opacity = 0;
            
            // Zoom in for final view
            this.focusCameraOnPosition(new THREE.Vector3(0, 0, 0), this.FOCUS_DISTANCE * 0.6);
            
            this.activeAnimations.push({
                type: 'fadeIn',
                target: mergedCluster.pointCloud,
                startOpacity: 0,
                endOpacity: 1,
                startTime: performance.now(),
                duration: this.FADE_DURATION * 1.5,
                onComplete: () => {
                    mergedCluster.pointCloud.material.opacity = 1;
                    this.visibleClusters.add(event.path);
                    this.updateInfo('Complete!', 'GERRARD HALL');
                    
                    // Start slow rotation around the building
                    this.startFinalRotation();
                }
            });
        }, this.FINAL_DURATION * 0.7);
        
        this.updateInfo('FINAL MERGE', 'Assembling...');
    }
    
    /**
     * Slow rotation after final assembly
     */
    startFinalRotation() {
        this.activeAnimations.push({
            type: 'autoRotate',
            startTime: performance.now(),
            duration: 10000,  // 10 seconds of rotation
            speed: 0.3
        });
    }
    
    /**
     * Focus camera on a position
     */
    focusCameraOnPosition(targetPos, distance = this.FOCUS_DISTANCE) {
        if (!this.camera || !this.orbitControls) return;
        
        const cameraEndPos = new THREE.Vector3(
            targetPos.x,
            targetPos.y,
            targetPos.z + distance
        );
        
        this.activeAnimations.push({
            type: 'cameraFocus',
            startPos: this.camera.position.clone(),
            endPos: cameraEndPos,
            startTarget: this.orbitControls.target.clone(),
            endTarget: targetPos.clone(),
            startTime: performance.now(),
            duration: this.FOCUS_DURATION
        });
    }
    
    /**
     * Cubic easing for smooth animations
     */
    easeInOutCubic(x) {
        return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    }
    
    /**
     * Update info display
     */
    updateInfo(mode, action) {
        if (this.onInfoUpdate) {
            this.onInfoUpdate(mode, action);
        }
    }
    
    /**
     * Animation update loop
     */
    update(dt) {
        const now = performance.now();
        
        for (let i = this.activeAnimations.length - 1; i >= 0; i--) {
            const anim = this.activeAnimations[i];
            const elapsed = now - anim.startTime;
            const progress = Math.min(1, elapsed / anim.duration);
            const eased = this.easeInOutCubic(progress);
            
            switch (anim.type) {
                case 'fadeIn': {
                    const opacity = anim.startOpacity + (anim.endOpacity - anim.startOpacity) * eased;
                    anim.target.material.opacity = opacity;
                    break;
                }
                
                case 'glow': {
                    // Pulse effect: opacity goes 0.3 → 1.2 → 1.0
                    const pulseProgress = Math.sin(progress * Math.PI);
                    const opacity = 0.3 + pulseProgress * 0.9;
                    anim.target.material.opacity = Math.min(1, opacity);
                    
                    // Also pulse the point size slightly
                    const originalSize = 2.0;
                    anim.target.material.size = originalSize * (1 + pulseProgress * 0.3);
                    break;
                }
                
                case 'implode': {
                    // Move toward target
                    anim.target.position.lerpVectors(anim.startPos, anim.endPos, eased);
                    
                    // Fade out in the last 30% of the animation
                    if (progress > 0.7) {
                        const fadeProgress = (progress - 0.7) / 0.3;
                        anim.material.opacity = 1 - fadeProgress;
                    }
                    break;
                }
                
                case 'cameraFocus': {
                    this.camera.position.lerpVectors(anim.startPos, anim.endPos, eased);
                    this.orbitControls.target.lerpVectors(anim.startTarget, anim.endTarget, eased);
                    break;
                }
                
                case 'autoRotate': {
                    // Slowly rotate around the building
                    const angle = elapsed * 0.0001 * anim.speed;
                    const radius = this.FOCUS_DISTANCE * 0.6;
                    this.camera.position.x = Math.sin(angle) * radius;
                    this.camera.position.z = Math.cos(angle) * radius;
                    this.orbitControls.target.set(0, 0, 0);
                    break;
                }
            }
            
            if (progress >= 1 && anim.type !== 'autoRotate') {
                if (anim.onComplete) anim.onComplete();
                this.activeAnimations.splice(i, 1);
            }
        }
    }
}

